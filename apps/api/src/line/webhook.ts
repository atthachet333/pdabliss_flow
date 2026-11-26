/**
 * LINE webhook endpoint (EP01): POST /api/line/webhook
 *
 * Order of operations (nothing happens before the signature is verified):
 *   1. Content type must be JSON; body ≤ 256 KiB; kept as the exact raw bytes.
 *   2. x-line-signature = Base64(HMAC-SHA256(channel secret, raw body)), compared in
 *      constant time. Missing / invalid → 401.
 *   3. Payload shape: { destination: U…, events: [...] } (≤ 100 events) → else 400.
 *   4. destination must equal Sally's bot user ID → else 403.
 *   5. Each event deduplicated by webhookEventId, then recorded as METADATA ONLY.
 *
 * No replies, pushes or other outbound messages are sent. Group joins are recorded as
 * "pending-registration" and never authorised automatically (registration is EP03).
 * Message text, postback data and display names are not stored. IDs are stored only as
 * keyed hashes in logs/metadata.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

export const WEBHOOK_BODY_LIMIT = 256 * 1024;
const MAX_EVENTS = 100;
/** Webhook event ids are kept 7 days in MariaDB (LINE redelivers within that window). */
export const WEBHOOK_DEDUPE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const RECENT_MAX = 100;

export const SUPPORTED_EVENT_TYPES = [
  'follow',
  'unfollow',
  'join',
  'leave',
  'memberJoined',
  'memberLeft',
  'message',
  'postback',
] as const;

export function lineSignature(secret: string, rawBody: Buffer | string): string {
  return createHmac('sha256', secret).update(rawBody).digest('base64');
}

export function verifyLineSignature(
  secret: string,
  rawBody: Buffer,
  header: string | undefined,
): boolean {
  if (!header || header.length > 128) return false;
  const expected = Buffer.from(lineSignature(secret, rawBody), 'base64');
  let provided: Buffer;
  try {
    provided = Buffer.from(header, 'base64');
  } catch {
    return false;
  }
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

const payloadSchema = z.object({
  destination: z.string().regex(/^U[0-9a-f]{32}$/),
  events: z
    .array(
      z
        .object({
          type: z.string().min(1).max(64),
          webhookEventId: z.string().max(64).optional(),
          timestamp: z.number().optional(),
          mode: z.string().optional(),
          source: z
            .object({
              type: z.string(),
              userId: z.string().optional(),
              groupId: z.string().optional(),
              roomId: z.string().optional(),
            })
            .passthrough()
            .optional(),
          deliveryContext: z.object({ isRedelivery: z.boolean() }).passthrough().optional(),
          message: z.object({ type: z.string() }).passthrough().optional(),
        })
        .passthrough(),
    )
    .max(MAX_EVENTS),
});

type WebhookEvent = z.infer<typeof payloadSchema>['events'][number];

export interface RecordedEvent {
  type: string;
  category: 'supported' | 'unknown';
  sourceType: string | null;
  sourceRef: string | null;
  detail: string | null;
  redelivery: boolean;
  receivedAt: string;
}

export interface PendingGroup {
  groupRef: string;
  status: 'pending-registration' | 'bot-removed';
  firstSeenAt: string;
  updatedAt: string;
}

/** In-memory development recorder (EP03 moves destinations into the database). */
export class WebhookRecorder {
  private readonly hashKey = randomBytes(32);
  private readonly recent: RecordedEvent[] = [];
  private readonly groups = new Map<string, PendingGroup>();
  private counts = { received: 0, duplicates: 0, unknown: 0 };

  constructor(private readonly now: () => number = () => Date.now()) {}

  ref(id: string | undefined): string | null {
    return id ? createHmac('sha256', this.hashKey).update(id).digest('hex').slice(0, 12) : null;
  }

  record(event: WebhookEvent): RecordedEvent {
    const supported = (SUPPORTED_EVENT_TYPES as readonly string[]).includes(event.type);
    const src = event.source;
    const sourceId = src?.groupId ?? src?.roomId ?? src?.userId;
    const at = new Date(this.now()).toISOString();
    let detail: string | null = null;

    if (event.type === 'message') detail = event.message?.type ?? null; // type only — never content
    if ((event.type === 'join' || event.type === 'leave') && src?.groupId) {
      const groupRef = this.ref(src.groupId) as string;
      const existing = this.groups.get(groupRef);
      this.groups.set(groupRef, {
        groupRef,
        status: event.type === 'join' ? 'pending-registration' : 'bot-removed',
        firstSeenAt: existing?.firstSeenAt ?? at,
        updatedAt: at,
      });
      detail = event.type === 'join' ? 'pending-registration' : 'bot-removed';
    }

    const rec: RecordedEvent = {
      type: supported ? event.type : 'unknown',
      category: supported ? 'supported' : 'unknown',
      sourceType: src?.type ?? null,
      sourceRef: this.ref(sourceId),
      detail,
      redelivery: event.deliveryContext?.isRedelivery ?? false,
      receivedAt: at,
    };
    this.counts.received += 1;
    if (!supported) this.counts.unknown += 1;
    this.recent.push(rec);
    if (this.recent.length > RECENT_MAX) this.recent.shift();
    return rec;
  }

  countDuplicate(): void {
    this.counts.duplicates += 1;
  }

  groupStatus(groupId: string): PendingGroup | undefined {
    const r = this.ref(groupId);
    return r ? this.groups.get(r) : undefined;
  }

  summary() {
    return {
      ...this.counts,
      pendingGroups: [...this.groups.values()].filter((g) => g.status === 'pending-registration')
        .length,
      recent: this.recent.slice(-10).map((r) => ({
        type: r.type,
        sourceType: r.sourceType,
        detail: r.detail,
        receivedAt: r.receivedAt,
      })),
    };
  }
}

/** EP02: persisted deduplication + group lifecycle (no outbound calls, no message content). */
export interface WebhookPersistence {
  /** Returns 'duplicate' when this webhookEventId was already processed (survives restarts). */
  claim(eventId: string, type: string, sourceType: string): Promise<'new' | 'duplicate'>;
  onGroupEvent(kind: 'join' | 'leave', groupId: string): Promise<void>;
}

export interface WebhookDeps {
  channelSecret: string | null;
  resolveBotUserId: () => Promise<string | null>;
  recorder: WebhookRecorder;
  persistence: WebhookPersistence;
}

export function registerWebhookRoute(app: FastifyInstance, deps: WebhookDeps): void {
  void app.register(async (scope) => {
    // Keep the exact raw bytes for signature verification (scoped to this route only).
    scope.removeContentTypeParser('application/json');
    scope.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer', bodyLimit: WEBHOOK_BODY_LIMIT },
      (_req, body, done) => done(null, body),
    );

    scope.post('/api/line/webhook', { bodyLimit: WEBHOOK_BODY_LIMIT }, async (request, reply) => {
      const err = (code: string, message: string) => ({
        error: { code, message, requestId: request.id },
      });
      if (!deps.channelSecret) {
        return reply.code(503).send(err('WEBHOOK_NOT_CONFIGURED', 'Webhook is not configured'));
      }
      const raw = request.body;
      if (!Buffer.isBuffer(raw))
        return reply.code(415).send(err('UNSUPPORTED_MEDIA_TYPE', 'JSON body required'));

      const header = request.headers['x-line-signature'];
      const signature = typeof header === 'string' ? header : undefined;
      if (!signature) {
        request.log.warn({ outcome: 'signature-missing' }, 'line.webhook');
        return reply.code(401).send(err('SIGNATURE_MISSING', 'Signature required'));
      }
      if (!verifyLineSignature(deps.channelSecret, raw, signature)) {
        request.log.warn({ outcome: 'signature-invalid' }, 'line.webhook');
        return reply.code(401).send(err('SIGNATURE_INVALID', 'Signature verification failed'));
      }

      let json: unknown;
      try {
        json = JSON.parse(raw.toString('utf8'));
      } catch {
        return reply.code(400).send(err('INVALID_PAYLOAD', 'Malformed payload'));
      }
      const parsed = payloadSchema.safeParse(json);
      if (!parsed.success)
        return reply.code(400).send(err('INVALID_PAYLOAD', 'Unexpected payload shape'));

      const expected = await deps.resolveBotUserId();
      if (!expected) {
        request.log.error({ outcome: 'destination-unresolved' }, 'line.webhook');
        return reply.code(503).send(err('DESTINATION_UNRESOLVED', 'Bot identity is not available'));
      }
      if (parsed.data.destination !== expected) {
        request.log.warn({ outcome: 'unexpected-destination' }, 'line.webhook');
        return reply.code(403).send(err('UNEXPECTED_DESTINATION', 'Unexpected destination'));
      }

      let received = 0;
      let duplicates = 0;
      for (const event of parsed.data.events) {
        const eventId = event.webhookEventId;
        if (typeof eventId === 'string' && eventId.length > 0 && eventId.length <= 40) {
          const claimed = await deps.persistence.claim(
            eventId,
            event.type.slice(0, 40),
            (event.source?.type ?? 'unknown').slice(0, 16),
          );
          if (claimed === 'duplicate') {
            duplicates += 1;
            deps.recorder.countDuplicate();
            continue;
          }
        }
        const rec = deps.recorder.record(event);
        const groupId = event.source?.groupId;
        if ((event.type === 'join' || event.type === 'leave') && typeof groupId === 'string')
          await deps.persistence.onGroupEvent(event.type, groupId);
        received += 1;
        request.log.info(
          {
            outcome: 'event',
            type: rec.type,
            source: rec.sourceType,
            ref: rec.sourceRef,
            redelivery: rec.redelivery,
          },
          'line.webhook',
        );
      }
      return reply.code(200).send({ ok: true, received, duplicates });
    });
  });
}

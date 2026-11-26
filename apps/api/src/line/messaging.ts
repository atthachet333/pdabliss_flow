/**
 * Isolated LINE Messaging API adapter — READ-ONLY in EP01.
 *
 * Supported: bot info, monthly quota, monthly consumption. There is deliberately NO
 * send/push/reply/multicast method: outbound delivery is out of scope until EP04 and
 * requires separate owner authorisation.
 *
 * Errors never include the access token or response bodies.
 */
import { z } from 'zod';
import type { FetchLike } from './id-token.js';

export const LINE_API_BASE = 'https://api.line.me';

export type LineApiErrorKind =
  | 'not-configured'
  | 'unauthorized'
  | 'forbidden'
  | 'rate-limited'
  | 'upstream'
  | 'network'
  | 'timeout'
  | 'invalid-response'
  | 'unexpected-status';

export class LineApiError extends Error {
  constructor(
    public readonly kind: LineApiErrorKind,
    public readonly status: number | null,
    public readonly attempts: number,
  ) {
    super(`LINE API request failed (${kind}${status ? `, HTTP ${status}` : ''})`);
    this.name = 'LineApiError';
  }
}

const botInfoSchema = z.object({
  userId: z.string().regex(/^U[0-9a-f]{32}$/),
  basicId: z.string(),
  displayName: z.string(),
  premiumId: z.string().optional(),
  pictureUrl: z.string().optional(),
  chatMode: z.string().optional(),
  markAsReadMode: z.string().optional(),
});
const quotaSchema = z.object({
  type: z.enum(['none', 'limited']),
  value: z.number().int().nonnegative().optional(),
});
const consumptionSchema = z.object({ totalUsage: z.number().int().nonnegative() });

export type BotInfo = z.infer<typeof botInfoSchema>;
export type Quota = z.infer<typeof quotaSchema>;
export type Consumption = z.infer<typeof consumptionSchema>;

export interface LineMessagingReader {
  getBotInfo(): Promise<BotInfo>;
  getQuota(): Promise<Quota>;
  getConsumption(): Promise<Consumption>;
}

export interface MessagingClientOptions {
  accessToken: string | null;
  fetchImpl?: FetchLike;
  baseUrl?: string;
  timeoutMs?: number;
  /** Additional attempts after the first (bounded). */
  maxRetries?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const MAX_RETRY_DELAY_MS = 5000;

export function createLineMessagingReader(opts: MessagingClientOptions): LineMessagingReader {
  const fetchImpl = opts.fetchImpl ?? ((i, init) => fetch(i, init));
  const baseUrl = opts.baseUrl ?? LINE_API_BASE;
  const timeoutMs = opts.timeoutMs ?? 5000;
  const maxRetries = Math.min(Math.max(opts.maxRetries ?? 2, 0), 3);
  const baseDelay = opts.baseDelayMs ?? 300;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

  async function getJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    if (!opts.accessToken) throw new LineApiError('not-configured', null, 0);
    let attempt = 0;
    for (;;) {
      attempt += 1;
      let res: Response | null = null;
      let kind: LineApiErrorKind | null = null;
      try {
        res = await fetchImpl(`${baseUrl}${path}`, {
          method: 'GET',
          headers: { authorization: `Bearer ${opts.accessToken}`, accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        kind =
          err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
            ? 'timeout'
            : 'network';
      }

      if (res) {
        if (res.ok) {
          let body: unknown;
          try {
            body = await res.json();
          } catch {
            throw new LineApiError('invalid-response', res.status, attempt);
          }
          const parsed = schema.safeParse(body);
          if (!parsed.success) throw new LineApiError('invalid-response', res.status, attempt);
          return parsed.data;
        }
        if (res.status === 401) throw new LineApiError('unauthorized', 401, attempt);
        if (res.status === 403) throw new LineApiError('forbidden', 403, attempt);
        if (res.status === 429) kind = 'rate-limited';
        else if (res.status >= 500) kind = 'upstream';
        else throw new LineApiError('unexpected-status', res.status, attempt);
      }

      const retryable =
        kind === 'rate-limited' || kind === 'upstream' || kind === 'network' || kind === 'timeout';
      if (!retryable || attempt > maxRetries) {
        throw new LineApiError(kind ?? 'unexpected-status', res?.status ?? null, attempt);
      }
      const retryAfter = Number(res?.headers.get('retry-after'));
      const delay =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, MAX_RETRY_DELAY_MS)
          : Math.min(baseDelay * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
      await sleep(delay);
    }
  }

  return {
    getBotInfo: () => getJson('/v2/bot/info', botInfoSchema),
    getQuota: () => getJson('/v2/bot/message/quota', quotaSchema),
    getConsumption: () => getJson('/v2/bot/message/quota/consumption', consumptionSchema),
  };
}

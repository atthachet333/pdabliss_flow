/**
 * Application sessions (EP01).
 *
 * DEVELOPMENT STORE ONLY: sessions live in process memory and disappear on restart.
 * This is deliberate for EP01 and is NOT production persistence. EP03 replaces the
 * store with a PostgreSQL-backed implementation behind the same interface.
 *
 * - Session IDs: 32 random bytes (base64url), sent only in an HttpOnly cookie.
 * - Stored key: HMAC-SHA256(SESSION_SECRET, id) — the raw ID is never stored or logged.
 * - Absolute + idle expiry, explicit revocation, tombstones so the UI can say
 *   "expired" / "revoked" instead of a generic "please log in".
 * - CSRF token: 32 random bytes per session, required on state-changing requests.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type SessionRole = 'owner' | 'tester';
export type EndReason = 'expired' | 'revoked' | 'logged-out' | 'replaced';

export interface SessionRecord {
  key: string;
  lineUserId: string;
  role: SessionRole;
  displayName: string | null;
  csrfToken: string;
  createdAt: number;
  lastSeenAt: number;
  absoluteExpiresAt: number;
}

export interface SessionStore {
  put(record: SessionRecord): void;
  get(key: string): SessionRecord | undefined;
  delete(key: string, reason: EndReason): void;
  deleteByUser(lineUserId: string, reason: EndReason): number;
  tombstone(key: string): EndReason | undefined;
  size(): number;
}

const TOMBSTONE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_SESSIONS = 1000;

export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly tombstones = new Map<string, { reason: EndReason; at: number }>();
  constructor(private readonly now: () => number = () => Date.now()) {}

  put(record: SessionRecord): void {
    if (this.sessions.size >= MAX_SESSIONS) {
      const oldest = [...this.sessions.values()].sort((a, b) => a.lastSeenAt - b.lastSeenAt)[0];
      if (oldest) this.delete(oldest.key, 'expired');
    }
    this.sessions.set(record.key, record);
  }
  get(key: string): SessionRecord | undefined {
    return this.sessions.get(key);
  }
  delete(key: string, reason: EndReason): void {
    if (this.sessions.delete(key)) this.tombstones.set(key, { reason, at: this.now() });
    this.sweep();
  }
  deleteByUser(lineUserId: string, reason: EndReason): number {
    let n = 0;
    for (const s of [...this.sessions.values()]) {
      if (s.lineUserId === lineUserId) {
        this.delete(s.key, reason);
        n += 1;
      }
    }
    return n;
  }
  tombstone(key: string): EndReason | undefined {
    const t = this.tombstones.get(key);
    if (!t) return undefined;
    if (this.now() - t.at > TOMBSTONE_TTL_MS) {
      this.tombstones.delete(key);
      return undefined;
    }
    return t.reason;
  }
  size(): number {
    return this.sessions.size;
  }
  private sweep(): void {
    if (this.tombstones.size < 5000) return;
    const cutoff = this.now() - TOMBSTONE_TTL_MS;
    for (const [k, v] of this.tombstones) if (v.at < cutoff) this.tombstones.delete(k);
  }
}

export interface SessionPolicy {
  absoluteMs: number;
  idleMs: number;
}

export class SessionManager {
  constructor(
    private readonly store: SessionStore,
    private readonly secret: string,
    private readonly policy: SessionPolicy,
    private readonly now: () => number = () => Date.now(),
  ) {}

  keyFor(sessionId: string): string {
    return createHmac('sha256', this.secret).update(sessionId).digest('base64url');
  }

  /** Always issues a brand-new identifier (session rotation / fixation defence). */
  create(input: { lineUserId: string; role: SessionRole; displayName: string | null }): {
    sessionId: string;
    record: SessionRecord;
  } {
    const sessionId = randomBytes(32).toString('base64url');
    const t = this.now();
    const record: SessionRecord = {
      key: this.keyFor(sessionId),
      lineUserId: input.lineUserId,
      role: input.role,
      displayName: input.displayName,
      csrfToken: randomBytes(32).toString('base64url'),
      createdAt: t,
      lastSeenAt: t,
      absoluteExpiresAt: t + this.policy.absoluteMs,
    };
    this.store.put(record);
    return { sessionId, record };
  }

  /** Resolve a cookie value. Expired sessions are removed and reported as such. */
  resolve(
    sessionId: string | undefined,
  ): { status: 'active'; record: SessionRecord } | { status: 'none' | EndReason } {
    if (!sessionId || sessionId.length > 128) return { status: 'none' };
    const key = this.keyFor(sessionId);
    const record = this.store.get(key);
    if (!record) {
      const reason = this.store.tombstone(key);
      return { status: reason ?? 'none' };
    }
    const t = this.now();
    if (t >= record.absoluteExpiresAt || t - record.lastSeenAt >= this.policy.idleMs) {
      this.store.delete(key, 'expired');
      return { status: 'expired' };
    }
    record.lastSeenAt = t;
    return { status: 'active', record };
  }

  end(sessionId: string | undefined, reason: EndReason): void {
    if (!sessionId || sessionId.length > 128) return;
    this.store.delete(this.keyFor(sessionId), reason);
  }

  revokeUser(lineUserId: string): number {
    return this.store.deleteByUser(lineUserId, 'revoked');
  }

  expiresAt(record: SessionRecord): number {
    return Math.min(record.absoluteExpiresAt, record.lastSeenAt + this.policy.idleMs);
  }
}

export function safeEqual(a: string | undefined, b: string): boolean {
  if (typeof a !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

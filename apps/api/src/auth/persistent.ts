/**
 * EP02 persistent sessions and rate limits (MariaDB via the Store port).
 *
 * Contract kept from EP01: 32-byte random session id only in the HttpOnly cookie; store key
 * = HMAC(SESSION_SECRET, id); idle + absolute expiry; rotation on login; revocation.
 * New in EP02:
 *  - sessions survive API restarts (persisted);
 *  - sessions carry NO privileges — every request reloads the user and memberships;
 *  - the CSRF token is derived (HMAC(SESSION_SECRET, "csrf:" + id)), so a restored session
 *    gets the same token without storing it.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Clock } from '../core/context.js';
import { newId } from '../core/context.js';
import type { SessionRow, Store } from '../store/types.js';

export interface SessionPolicy {
  absoluteMs: number;
  idleMs: number;
}

export type ResolvedSession =
  | { status: 'active'; session: SessionRow; sessionId: string }
  | { status: 'none' }
  | { status: 'expired' }
  | { status: 'revoked' }
  | { status: 'logged-out' };

export function safeEqual(a: string | undefined, b: string): boolean {
  if (typeof a !== 'string') return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export class PersistentSessions {
  constructor(
    private readonly store: Store,
    private readonly secret: string,
    private readonly policy: SessionPolicy,
    private readonly clock: Clock,
  ) {}

  keyFor(sessionId: string): Uint8Array {
    return createHmac('sha256', this.secret).update(`session:${sessionId}`).digest();
  }

  csrfFor(sessionId: string): string {
    return createHmac('sha256', this.secret).update(`csrf:${sessionId}`).digest('base64url');
  }

  expiresAt(s: SessionRow): Date {
    return new Date(
      Math.min(s.absoluteExpiresAt.getTime(), s.lastSeenAt.getTime() + this.policy.idleMs),
    );
  }

  async create(userId: string): Promise<{ sessionId: string; session: SessionRow }> {
    const sessionId = randomBytes(32).toString('base64url');
    const now = this.clock();
    const session: SessionRow = {
      id: newId(),
      keyHash: this.keyFor(sessionId),
      userId,
      createdAt: now,
      lastSeenAt: now,
      absoluteExpiresAt: new Date(now.getTime() + this.policy.absoluteMs),
      endedAt: null,
      endReason: null,
    };
    await this.store.createSession(session);
    return { sessionId, session };
  }

  async resolve(
    sessionId: string | null,
    opts: { touch?: boolean } = {},
  ): Promise<ResolvedSession> {
    if (!sessionId || sessionId.length > 128) return { status: 'none' };
    const s = await this.store.getSessionByKeyHash(this.keyFor(sessionId));
    if (!s) return { status: 'none' };
    if (s.endedAt) {
      if (s.endReason === 'REVOKED' || s.endReason === 'REPLACED') return { status: 'revoked' };
      if (s.endReason === 'LOGGED_OUT') return { status: 'logged-out' };
      return { status: 'expired' };
    }
    const now = this.clock();
    if (now >= this.expiresAt(s)) {
      await this.store.endSession(s.id, 'EXPIRED', now);
      return { status: 'expired' };
    }
    if (opts.touch !== false && now.getTime() - s.lastSeenAt.getTime() > 30_000) {
      await this.store.touchSession(s.id, now);
      s.lastSeenAt = now;
    }
    return { status: 'active', session: s, sessionId };
  }

  async end(
    sessionId: string | null,
    reason: 'LOGGED_OUT' | 'REPLACED' | 'REVOKED',
  ): Promise<void> {
    if (!sessionId || sessionId.length > 128) return;
    const s = await this.store.getSessionByKeyHash(this.keyFor(sessionId));
    if (s && !s.endedAt) await this.store.endSession(s.id, reason, this.clock());
  }

  async revokeUser(userId: string): Promise<number> {
    return this.store.endUserSessions(userId, 'REVOKED', this.clock());
  }
}

/**
 * Fixed-window limiter persisted in MariaDB. Keys are HMACs (client addresses are never
 * stored in clear). Returns seconds to wait (0 = allowed).
 */
export class PersistentRateLimiter {
  constructor(
    private readonly store: Store,
    private readonly secret: string,
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly clock: Clock,
  ) {}

  async check(key: string): Promise<number> {
    const now = this.clock();
    const hash = createHmac('sha256', this.secret).update(`rate:${key}`).digest();
    const { count, windowEnd } = await this.store.hitRateLimit(hash, this.windowMs, now);
    if (count <= this.limit) return 0;
    return Math.max(1, Math.ceil((windowEnd.getTime() - now.getTime()) / 1000));
  }
}

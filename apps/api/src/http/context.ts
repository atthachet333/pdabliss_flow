/** Per-request identity resolution for /api/v1 (EP02). Sessions carry no privileges. */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '../core/context.js';
import type { PersistentSessions } from '../auth/persistent.js';
import type { Actor } from '../domain/policy.js';
import type { Store } from '../store/types.js';
import { type CookieSettings, readSessionCookie } from './security.js';

export interface RequestAuth {
  actor: Actor;
  sessionId: string;
  csrfToken: string;
  expiresAt: Date;
}

export async function loadActor(store: Store, userId: string): Promise<Actor | null> {
  const user = await store.getUser(userId);
  if (!user) return null;
  const memberships = new Map<string, Actor['memberships'] extends Map<string, infer V> ? V : never>();
  if (user.status === 'ACTIVE') {
    const rows = await store.listMembershipsForUser(user.id, ['ACTIVE']);
    const workspaces = rows.length
      ? await store.listWorkspaces({ ids: rows.map((r) => r.workspaceId), statuses: ['ACTIVE'], limit: rows.length })
      : [];
    const byId = new Map(workspaces.map((w) => [w.id, w]));
    for (const m of rows) {
      const ws = byId.get(m.workspaceId);
      if (ws) memberships.set(ws.id, { workspace: ws, role: m.role });
    }
  }
  return { user, memberships };
}

export function sessionStateCode(status: 'none' | 'expired' | 'revoked' | 'logged-out'): string {
  return status === 'expired' ? 'expired' : status === 'revoked' ? 'revoked' : 'unauthenticated';
}

/** Resolves the session cookie to an Actor or throws 401 with a state the SPA understands. */
export async function authenticate(
  request: FastifyRequest,
  deps: { store: Store; sessions: PersistentSessions; cookie: CookieSettings },
): Promise<RequestAuth> {
  const sessionId = readSessionCookie(request, deps.cookie) ?? null;
  const resolved = await deps.sessions.resolve(sessionId);
  if (resolved.status !== 'active')
    throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in required', { state: sessionStateCode(resolved.status) });
  const actor = await loadActor(deps.store, resolved.session.userId);
  if (!actor) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in required', { state: 'unauthenticated' });
  return {
    actor,
    sessionId: resolved.sessionId,
    csrfToken: deps.sessions.csrfFor(resolved.sessionId),
    expiresAt: deps.sessions.expiresAt(resolved.session),
  };
}

/** Application endpoints require an ACTIVE account; other states get a precise 403. */
export function requireActive(auth: RequestAuth): void {
  const s = auth.actor.user.status;
  if (s !== 'ACTIVE') throw new ApiError(403, `ACCOUNT_${s}`, 'Account is not active', { state: s.toLowerCase() });
}

export function sendApiError(reply: FastifyReply, request: FastifyRequest, err: ApiError) {
  return reply.code(err.status).send({
    error: {
      code: err.code,
      message: err.message,
      requestId: request.id,
      ...(err.details ? { details: err.details } : {}),
    },
  });
}

/**
 * Authentication routes (EP01 contract, EP02 persistence).
 *
 *   GET  /api/auth/config   public: whether auth is configured + LIFF ID
 *   POST /api/auth/line     LIFF ID token → LINE verification → user row → new session
 *   GET  /api/auth/session  current session + fresh account state (+ CSRF token)
 *   POST /api/auth/logout   end session (Origin + CSRF; body none or `{}`)
 *   GET  /api/line/status   owner only: read-only bot info, quota, consumption
 *
 * EP02 changes: every verified LINE user gets a session (so a NEW/PENDING user can file an
 * access request in-app); the session grants nothing by itself — /api/v1 checks the account
 * state and memberships on every request. Sessions and rate limits persist in MariaDB.
 * Ordering kept from EP01: Origin is enforced in onRequest, before body parsing.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { IntegrationConfig } from '../env.js';
import { isAuthConfigured } from '../env.js';
import { IdentityService } from '../domain/identity.js';
import { type Actor, isOwner } from '../domain/policy.js';
import { loadActor } from '../http/context.js';
import {
  clearSessionCookie,
  clientAddress,
  type CookieSettings,
  originAllowed,
  readSessionCookie,
  setSessionCookie,
} from '../http/security.js';
import type { IdTokenVerifier } from '../line/id-token.js';
import { LineApiError, type LineMessagingReader } from '../line/messaging.js';
import type { Store, UserRow } from '../store/types.js';
import type { PersistentRateLimiter, PersistentSessions } from './persistent.js';
import { safeEqual } from './persistent.js';

export interface AuthDeps {
  config: IntegrationConfig | undefined;
  allowedOrigins: ReadonlySet<string>;
  verifier: IdTokenVerifier | null;
  sessions: PersistentSessions | null;
  store: Store;
  identity: IdentityService | null;
  cookie: CookieSettings;
  loginLimiter: PersistentRateLimiter | null;
  sessionLimiter: PersistentRateLimiter | null;
  messaging: LineMessagingReader | null;
  webhookSummary: () => Promise<Record<string, unknown>>;
}

type ErrFn = (code: string, message: string) => { error: { code: string; message: string; requestId: string } };

const loginBody = z.object({ idToken: z.string().min(1).max(4096) }).strict();
/** Logout carries no data: no body at all, or an empty JSON object. */
const logoutBody = z.union([z.undefined(), z.object({}).strict()]);

export type AccountState = 'approved' | 'new' | 'pending' | 'rejected' | 'suspended' | 'revoked';

export function accountState(u: UserRow): AccountState {
  switch (u.status) {
    case 'ACTIVE':
      return 'approved';
    case 'NEW':
      return 'new';
    case 'PENDING':
      return 'pending';
    case 'REJECTED':
      return 'rejected';
    case 'SUSPENDED':
      return 'suspended';
    default:
      return 'revoked';
  }
}

function sessionView(actor: Actor, csrfToken: string, expiresAt: Date) {
  return {
    state: accountState(actor.user),
    user: {
      id: actor.user.id,
      displayName: actor.user.displayName,
      status: actor.user.status,
      globalRole: actor.user.globalRole,
    },
    session: { expiresAt: expiresAt.toISOString() },
    csrfToken,
  };
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthDeps): void {
  const ready =
    isAuthConfigured(deps.config) && deps.verifier !== null && deps.sessions !== null && deps.identity !== null;

  const notConfigured = (reply: FastifyReply, err: ErrFn) =>
    reply.code(503).send(err('AUTH_NOT_CONFIGURED', 'Authentication is not configured'));

  /** onRequest guard: runs before content-type parsing (EP01 G09 ordering). */
  const requireAllowedOrigin = async (request: FastifyRequest, reply: FastifyReply) => {
    if (originAllowed(request, deps.allowedOrigins)) return;
    request.log.info({ outcome: 'origin-denied' }, 'auth.origin');
    return reply.code(403).send({
      error: { code: 'ORIGIN_DENIED', message: 'Request origin is not allowed', requestId: request.id },
    });
  };

  const limited = async (
    limiter: PersistentRateLimiter | null,
    key: string,
    reply: FastifyReply,
    err: ErrFn,
  ): Promise<boolean> => {
    if (!limiter) return false;
    const wait = await limiter.check(key);
    if (wait <= 0) return false;
    await reply.header('retry-after', String(wait)).code(429).send(err('RATE_LIMITED', 'Too many requests'));
    return true;
  };

  app.get('/api/auth/config', async () => ({
    authConfigured: ready,
    liffId: ready ? (deps.config?.line.liffId ?? null) : null,
  }));

  app.post('/api/auth/line', { onRequest: requireAllowedOrigin }, async (request, reply) => {
    const err: ErrFn = (code, message) => ({ error: { code, message, requestId: request.id } });
    if (!ready || !deps.verifier || !deps.sessions || !deps.identity || !deps.config)
      return notConfigured(reply, err);
    if (await limited(deps.loginLimiter, `login:${clientAddress(request)}`, reply, err)) return reply;
    const parsed = loginBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(err('VALIDATION_ERROR', 'Request validation failed'));

    // Session fixation defence: any session presented with a login attempt is ended.
    await deps.sessions.end(readSessionCookie(request, deps.cookie) ?? null, 'REPLACED');

    const result = await deps.verifier.verify(parsed.data.idToken);
    if (!result.ok) {
      request.log.info({ outcome: `id-token-${result.reason}` }, 'auth.login');
      clearSessionCookie(reply, deps.cookie);
      if (result.reason === 'upstream')
        return reply.code(503).send(err('LINE_UNAVAILABLE', 'LINE verification is temporarily unavailable'));
      if (result.reason === 'expired') return reply.code(401).send(err('ID_TOKEN_EXPIRED', 'Login has expired'));
      return reply.code(401).send(err('ID_TOKEN_INVALID', 'Login could not be verified'));
    }
    const user = await deps.identity.upsertFromVerifiedLogin(
      result.identity.sub,
      result.identity.name,
      deps.config.line.loginChannelId as string,
    );
    const actor = (await loadActor(deps.store, user.id)) as Actor;
    const { sessionId, session } = await deps.sessions.create(user.id);
    const expiresAt = deps.sessions.expiresAt(session);
    setSessionCookie(reply, deps.cookie, sessionId, (expiresAt.getTime() - session.createdAt.getTime()) / 1000);
    request.log.info({ outcome: accountState(user) }, 'auth.login');
    return reply.code(200).send(sessionView(actor, deps.sessions.csrfFor(sessionId), expiresAt));
  });

  app.get('/api/auth/session', async (request, reply) => {
    const err: ErrFn = (code, message) => ({ error: { code, message, requestId: request.id } });
    if (!ready || !deps.sessions) return notConfigured(reply, err);
    if (await limited(deps.sessionLimiter, `session:${clientAddress(request)}`, reply, err)) return reply;
    const cookie = readSessionCookie(request, deps.cookie) ?? null;
    const resolved = await deps.sessions.resolve(cookie);
    if (resolved.status !== 'active') {
      if (resolved.status !== 'none') clearSessionCookie(reply, deps.cookie);
      const state = resolved.status === 'expired' ? 'expired' : resolved.status === 'revoked' ? 'revoked' : 'unauthenticated';
      return reply.code(401).send({ state });
    }
    const actor = await loadActor(deps.store, resolved.session.userId);
    if (!actor) {
      clearSessionCookie(reply, deps.cookie);
      return reply.code(401).send({ state: 'unauthenticated' });
    }
    return reply
      .code(200)
      .send(sessionView(actor, deps.sessions.csrfFor(resolved.sessionId), deps.sessions.expiresAt(resolved.session)));
  });

  app.post('/api/auth/logout', { onRequest: requireAllowedOrigin }, async (request, reply) => {
    const err: ErrFn = (code, message) => ({ error: { code, message, requestId: request.id } });
    if (!ready || !deps.sessions) return notConfigured(reply, err);
    if (!logoutBody.safeParse(request.body).success)
      return reply.code(400).send(err('VALIDATION_ERROR', 'Request validation failed'));
    const cookie = readSessionCookie(request, deps.cookie) ?? null;
    const resolved = await deps.sessions.resolve(cookie, { touch: false });
    if (resolved.status === 'active') {
      const header = request.headers['x-flow-csrf'];
      if (!safeEqual(typeof header === 'string' ? header : undefined, deps.sessions.csrfFor(resolved.sessionId)))
        return reply.code(403).send(err('CSRF_INVALID', 'Request could not be verified'));
      await deps.sessions.end(cookie, 'LOGGED_OUT');
    }
    clearSessionCookie(reply, deps.cookie);
    return reply.code(200).send({ state: 'logged-out' });
  });

  app.get('/api/line/status', async (request, reply) => {
    const err: ErrFn = (code, message) => ({ error: { code, message, requestId: request.id } });
    if (!ready || !deps.sessions) return notConfigured(reply, err);
    const resolved = await deps.sessions.resolve(readSessionCookie(request, deps.cookie) ?? null);
    if (resolved.status !== 'active') return reply.code(401).send({ state: 'unauthenticated' });
    const actor = await loadActor(deps.store, resolved.session.userId);
    if (!actor || !isOwner(actor)) return reply.code(403).send(err('FORBIDDEN', 'Owner access is required'));
    if (!deps.messaging)
      return reply.code(503).send(err('LINE_NOT_CONFIGURED', 'Messaging API access token is not configured'));
    try {
      const [bot, quota, consumption] = await Promise.all([
        deps.messaging.getBotInfo(),
        deps.messaging.getQuota(),
        deps.messaging.getConsumption(),
      ]);
      return reply.code(200).send({
        bot: { basicId: bot.basicId, displayName: bot.displayName },
        quota: { type: quota.type, value: quota.value ?? null },
        consumption: { totalUsage: consumption.totalUsage },
        webhook: await deps.webhookSummary(),
        outboundMessaging: 'disabled',
        checkedAt: new Date().toISOString(),
      });
    } catch (e) {
      const kind = e instanceof LineApiError ? e.kind : 'unexpected';
      request.log.warn({ outcome: `line-api-${kind}` }, 'line.status');
      return reply.code(502).send(err(`LINE_API_${kind.toUpperCase().replace(/-/g, '_')}`, 'LINE API request failed'));
    }
  });
}

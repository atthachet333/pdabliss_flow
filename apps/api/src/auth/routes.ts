/**
 * EP01 authentication routes.
 *
 *   GET  /api/auth/config   public, non-secret: whether auth is configured + LIFF ID
 *   POST /api/auth/line     LIFF ID token → verified identity → access decision → session
 *   GET  /api/auth/session  current session state (+ CSRF token for this session)
 *   POST /api/auth/logout   revoke session (CSRF + origin protected; body: none or `{}`)
 *   GET  /api/line/status   owner only: read-only bot info, quota, consumption
 *
 * Fail closed: without LINE Login + LIFF + SESSION_SECRET every auth route answers 503.
 *
 * Ordering (G09 fix): the Origin allow-list for state-changing routes runs in `onRequest`,
 * i.e. BEFORE Fastify's content-type parsing. A cross-origin POST is therefore always
 * answered 403 ORIGIN_DENIED, whatever its Content-Type or body; it can never reach body
 * parsing, configuration checks, rate limiting, token verification or session handling.
 * Requests from an allowed origin with an unsupported media type still get Fastify's 415.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { IntegrationConfig } from '../env.js';
import { isAuthConfigured } from '../env.js';
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
import type { WebhookRecorder } from '../line/webhook.js';
import { type AccessStore, maskUserId } from './access.js';
import type { RateLimiter } from './rate-limit.js';
import { safeEqual, type SessionManager, type SessionRecord } from './sessions.js';

export interface AuthDeps {
  config: IntegrationConfig | undefined;
  allowedOrigins: ReadonlySet<string>;
  verifier: IdTokenVerifier | null;
  sessions: SessionManager | null;
  access: AccessStore;
  cookie: CookieSettings;
  loginLimiter: RateLimiter;
  sessionLimiter: RateLimiter;
  messaging: LineMessagingReader | null;
  webhook: WebhookRecorder;
}

type ErrFn = (
  code: string,
  message: string,
) => { error: { code: string; message: string; requestId: string } };

const loginBody = z.object({ idToken: z.string().min(1).max(4096) }).strict();
/** Logout carries no data: no body at all, or an empty JSON object. */
const logoutBody = z.union([z.undefined(), z.object({}).strict()]);

function sessionView(sessions: SessionManager, record: SessionRecord) {
  return {
    state: 'approved' as const,
    user: { displayName: record.displayName, role: record.role },
    session: { expiresAt: new Date(sessions.expiresAt(record)).toISOString() },
    csrfToken: record.csrfToken,
  };
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthDeps): void {
  const ready = isAuthConfigured(deps.config) && deps.verifier !== null && deps.sessions !== null;

  const notConfigured = (reply: FastifyReply, err: ErrFn) =>
    reply.code(503).send(err('AUTH_NOT_CONFIGURED', 'Authentication is not configured'));

  app.get('/api/auth/config', async () => ({
    authConfigured: ready,
    liffId: ready ? (deps.config?.line.liffId ?? null) : null,
  }));

  /** onRequest guard: runs before content-type parsing (see header comment). */
  const requireAllowedOrigin = async (request: FastifyRequest, reply: FastifyReply) => {
    if (originAllowed(request, deps.allowedOrigins)) return;
    request.log.info({ outcome: 'origin-denied' }, 'auth.origin');
    return reply.code(403).send({
      error: {
        code: 'ORIGIN_DENIED',
        message: 'Request origin is not allowed',
        requestId: request.id,
      },
    });
  };

  app.post('/api/auth/line', { onRequest: requireAllowedOrigin }, async (request, reply) => {
    const err: ErrFn = (code, message) => ({ error: { code, message, requestId: request.id } });
    if (!ready || !deps.verifier || !deps.sessions) return notConfigured(reply, err);
    // Defence in depth: the onRequest guard has already enforced this.
    if (!originAllowed(request, deps.allowedOrigins)) {
      return reply.code(403).send(err('ORIGIN_DENIED', 'Request origin is not allowed'));
    }
    const wait = deps.loginLimiter.check(`login:${clientAddress(request)}`);
    if (wait > 0) {
      return reply
        .header('retry-after', String(wait))
        .code(429)
        .send(err('RATE_LIMITED', 'Too many attempts'));
    }
    const parsed = loginBody.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send(err('VALIDATION_ERROR', 'Request validation failed'));

    // Session fixation defence: any session presented with a login attempt is ended.
    const previous = readSessionCookie(request, deps.cookie);
    if (previous) deps.sessions.end(previous, 'replaced');

    const result = await deps.verifier.verify(parsed.data.idToken);
    if (!result.ok) {
      request.log.info({ outcome: `id-token-${result.reason}` }, 'auth.login');
      clearSessionCookie(reply, deps.cookie);
      if (result.reason === 'upstream') {
        return reply
          .code(503)
          .send(err('LINE_UNAVAILABLE', 'LINE verification is temporarily unavailable'));
      }
      if (result.reason === 'expired') {
        return reply.code(401).send(err('ID_TOKEN_EXPIRED', 'Login has expired'));
      }
      return reply.code(401).send(err('ID_TOKEN_INVALID', 'Login could not be verified'));
    }

    const { sub, name } = result.identity;
    const decision = deps.access.decide(sub);
    request.log.info({ outcome: decision.state, user: maskUserId(sub) }, 'auth.login');

    if (decision.state === 'approved') {
      const { sessionId, record } = deps.sessions.create({
        lineUserId: sub,
        role: decision.role,
        displayName: name,
      });
      setSessionCookie(
        reply,
        deps.cookie,
        sessionId,
        (deps.sessions.expiresAt(record) - Date.now()) / 1000,
      );
      return reply.code(200).send(sessionView(deps.sessions, record));
    }
    clearSessionCookie(reply, deps.cookie);
    if (decision.state === 'revoked') return reply.code(403).send({ state: 'revoked' });
    const enrollmentRef = deps.access.recordPending(sub);
    return reply.code(403).send({ state: 'not-approved', enrollmentRef });
  });

  app.get('/api/auth/session', async (request, reply) => {
    const err: ErrFn = (code, message) => ({ error: { code, message, requestId: request.id } });
    if (!ready || !deps.sessions) return notConfigured(reply, err);
    const wait = deps.sessionLimiter.check(`session:${clientAddress(request)}`);
    if (wait > 0) {
      return reply
        .header('retry-after', String(wait))
        .code(429)
        .send(err('RATE_LIMITED', 'Too many requests'));
    }
    const resolved = deps.sessions.resolve(readSessionCookie(request, deps.cookie));
    if (resolved.status !== 'active') {
      if (resolved.status !== 'none') clearSessionCookie(reply, deps.cookie);
      const state =
        resolved.status === 'expired'
          ? 'expired'
          : resolved.status === 'revoked'
            ? 'revoked'
            : 'unauthenticated';
      return reply.code(401).send({ state });
    }
    const record = resolved.record;
    const decision = deps.access.decide(record.lineUserId);
    if (decision.state !== 'approved') {
      deps.sessions.revokeUser(record.lineUserId);
      clearSessionCookie(reply, deps.cookie);
      request.log.info(
        { outcome: 'access-revoked', user: maskUserId(record.lineUserId) },
        'auth.session',
      );
      return reply.code(401).send({ state: 'revoked' });
    }
    record.role = decision.role;
    return reply.code(200).send(sessionView(deps.sessions, record));
  });

  app.post('/api/auth/logout', { onRequest: requireAllowedOrigin }, async (request, reply) => {
    const err: ErrFn = (code, message) => ({ error: { code, message, requestId: request.id } });
    if (!ready || !deps.sessions) return notConfigured(reply, err);
    // Defence in depth: the onRequest guard has already enforced this.
    if (!originAllowed(request, deps.allowedOrigins)) {
      return reply.code(403).send(err('ORIGIN_DENIED', 'Request origin is not allowed'));
    }
    if (!logoutBody.safeParse(request.body).success) {
      return reply.code(400).send(err('VALIDATION_ERROR', 'Request validation failed'));
    }
    const cookieValue = readSessionCookie(request, deps.cookie);
    const resolved = deps.sessions.resolve(cookieValue);
    if (resolved.status === 'active') {
      const header = request.headers['x-flow-csrf'];
      if (!safeEqual(typeof header === 'string' ? header : undefined, resolved.record.csrfToken)) {
        return reply.code(403).send(err('CSRF_INVALID', 'Request could not be verified'));
      }
      deps.sessions.end(cookieValue, 'logged-out');
    }
    clearSessionCookie(reply, deps.cookie);
    return reply.code(200).send({ state: 'logged-out' });
  });

  app.get('/api/line/status', async (request, reply) => {
    const err: ErrFn = (code, message) => ({ error: { code, message, requestId: request.id } });
    if (!ready || !deps.sessions) return notConfigured(reply, err);
    const resolved = deps.sessions.resolve(readSessionCookie(request, deps.cookie));
    if (resolved.status !== 'active') return reply.code(401).send({ state: 'unauthenticated' });
    const decision = deps.access.decide(resolved.record.lineUserId);
    if (decision.state !== 'approved' || decision.role !== 'owner') {
      return reply.code(403).send(err('FORBIDDEN', 'Owner access is required'));
    }
    if (!deps.messaging) {
      return reply
        .code(503)
        .send(err('LINE_NOT_CONFIGURED', 'Messaging API access token is not configured'));
    }
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
        webhook: deps.webhook.summary(),
        outboundMessaging: 'disabled',
        checkedAt: new Date().toISOString(),
      });
    } catch (e) {
      const kind = e instanceof LineApiError ? e.kind : 'unexpected';
      request.log.warn({ outcome: `line-api-${kind}` }, 'line.status');
      return reply
        .code(502)
        .send(err(`LINE_API_${kind.toUpperCase().replace(/-/g, '_')}`, 'LINE API request failed'));
    }
  });
}

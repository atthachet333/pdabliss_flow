/**
 * Fastify application factory. No network listening happens here — server.ts does that —
 * so tests can build the app and use app.inject() without opening ports.
 *
 * EP00: env-driven config, structured logging with redaction, request IDs, consistent
 * error envelope, security headers, restricted CORS, GET /health.
 * EP01: LINE ID-token login exchange, in-memory development sessions, private access
 * list, CSRF/origin checks, rate limiting, signed LINE webhook, read-only Messaging API
 * status. No endpoint sends LINE messages.
 */
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { type AccessStore, FileAccessStore } from './auth/access.js';
import { RateLimiter } from './auth/rate-limit.js';
import { registerAuthRoutes } from './auth/routes.js';
import { MemorySessionStore, SessionManager } from './auth/sessions.js';
import type { AppEnv } from './env.js';
import { isAuthConfigured } from './env.js';
import { cookieSettings } from './http/security.js';
import {
  createLineIdTokenVerifier,
  type FetchLike,
  type IdTokenVerifier,
} from './line/id-token.js';
import { createLineMessagingReader, type LineMessagingReader } from './line/messaging.js';
import { registerWebhookRoute, WebhookRecorder } from './line/webhook.js';

export const SERVICE_NAME = 'pdabliss-flow-api';
export const SERVICE_VERSION = '0.1.0-ep01';

/** Log paths redacted everywhere (headers and common secret-bearing fields). */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-line-signature"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.secret',
  '*.token',
  '*.accessToken',
  '*.idToken',
  '*.channelSecret',
  '*.channelAccessToken',
  '*.description',
  '*.csrfToken',
  '*.sessionSecret',
  'req.headers["x-flow-csrf"]',
];

export interface ErrorBody {
  error: { code: string; message: string; requestId: string };
}

export interface BuildAppOptions {
  env: AppEnv;
  /** Optional log destination (tests capture output to verify redaction). */
  logStream?: { write(msg: string): void };
  /** Test seams — production code uses the real LINE-backed implementations. */
  deps?: {
    fetchImpl?: FetchLike;
    verifier?: IdTokenVerifier | null;
    messaging?: LineMessagingReader | null;
    access?: AccessStore;
    now?: () => number;
    loginLimit?: { limit: number; windowMs: number };
  };
}

const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'cross-origin-resource-policy': 'same-site',
  'cache-control': 'no-store',
};

export function buildApp({ env, logStream, deps = {} }: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logger:
      env.logLevel === 'silent' && !logStream
        ? false
        : {
            level: env.logLevel,
            redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
            ...(logStream ? { stream: logStream } : {}),
          },
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    trustProxy: false,
    bodyLimit: 64 * 1024,
  });

  const allowedOrigins = new Set(env.corsOrigins);
  const integration = env.integration;
  const now = deps.now ?? (() => Date.now());

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
    const origin = request.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
      reply.header('access-control-allow-origin', origin);
      reply.header('vary', 'Origin');
    }
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) reply.header(name, value);
    return payload;
  });

  // CORS preflight: only for allowed origins; everything else is refused.
  app.options('/*', async (request, reply) => {
    const origin = request.headers.origin;
    if (!origin || !allowedOrigins.has(origin)) {
      return reply
        .code(403)
        .send(errorBody('CORS_ORIGIN_DENIED', 'Origin not allowed', request.id));
    }
    reply
      .header('access-control-allow-methods', 'GET, POST, OPTIONS')
      .header('access-control-allow-headers', 'content-type, authorization, x-flow-csrf')
      .header('access-control-max-age', '600');
    return reply.code(204).send();
  });

  const healthOptions = {
    schema: {
      response: {
        200: {
          type: 'object',
          additionalProperties: false,
          required: ['status', 'service', 'version', 'time'],
          properties: {
            status: { type: 'string', enum: ['ok'] },
            service: { type: 'string' },
            version: { type: 'string' },
            time: { type: 'string' },
          },
        },
      },
    },
  };
  // Liveness only: deliberately independent of database/LINE, and exposes no host,
  // path, environment or dependency details. /api/health is the gateway-visible alias.
  const health = async () => ({
    status: 'ok' as const,
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    time: new Date().toISOString(),
  });
  app.get('/health', healthOptions, health);
  app.get('/api/health', healthOptions, health);

  // ---------------------------------------------------------------- EP01 wiring
  const verifier =
    deps.verifier !== undefined
      ? deps.verifier
      : isAuthConfigured(integration)
        ? createLineIdTokenVerifier({
            channelId: integration.line.loginChannelId,
            ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
          })
        : null;
  const messaging =
    deps.messaging !== undefined
      ? deps.messaging
      : integration?.line.channelAccessToken
        ? createLineMessagingReader({
            accessToken: integration.line.channelAccessToken,
            ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
          })
        : null;
  const sessions = isAuthConfigured(integration)
    ? new SessionManager(
        new MemorySessionStore(now),
        integration.sessionSecret,
        {
          absoluteMs: integration.sessionAbsoluteMinutes * 60_000,
          idleMs: integration.sessionIdleMinutes * 60_000,
        },
        now,
      )
    : null;
  const access =
    deps.access ??
    new FileAccessStore({
      dir: integration?.secretDir ?? null,
      envTesters: integration?.allowedLineUserIds ?? [],
      now,
    });
  const recorder = new WebhookRecorder(now);
  const loginLimit = deps.loginLimit ?? { limit: 10, windowMs: 5 * 60_000 };

  let botUserId: string | null = integration?.line.botUserId ?? null;
  const resolveBotUserId = async (): Promise<string | null> => {
    if (botUserId || !messaging) return botUserId;
    try {
      botUserId = (await messaging.getBotInfo()).userId;
    } catch {
      return null;
    }
    return botUserId;
  };

  registerAuthRoutes(app, {
    config: integration,
    allowedOrigins,
    verifier,
    sessions,
    access,
    cookie: cookieSettings(integration?.publicBaseUrl ?? null),
    loginLimiter: new RateLimiter(loginLimit.limit, loginLimit.windowMs, now),
    sessionLimiter: new RateLimiter(120, 60_000, now),
    messaging,
    webhook: recorder,
  });
  registerWebhookRoute(app, {
    channelSecret: integration?.line.messagingChannelSecret ?? null,
    resolveBotUserId,
    recorder,
  });

  app.setNotFoundHandler(async (request, reply) => {
    return reply.code(404).send(errorBody('NOT_FOUND', 'Resource not found', request.id));
  });

  app.setErrorHandler(async (error: FastifyError, request, reply) => {
    if (error.validation) {
      return reply
        .code(400)
        .send(errorBody('VALIDATION_ERROR', 'Request validation failed', request.id));
    }
    const status =
      typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500
        ? error.statusCode
        : 500;
    if (status >= 500) {
      request.log.error({ err: error }, 'Unhandled error');
      return reply
        .code(500)
        .send(errorBody('INTERNAL_ERROR', 'An unexpected error occurred', request.id));
    }
    return reply
      .code(status)
      .send(errorBody(error.code ?? 'REQUEST_ERROR', 'Request could not be processed', request.id));
  });

  return app;
}

export function errorBody(code: string, message: string, requestId: string): ErrorBody {
  return { error: { code, message, requestId } };
}

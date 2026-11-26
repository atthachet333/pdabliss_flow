/**
 * Fastify application factory. No network listening happens here — server.ts does that —
 * so tests can build the app and use app.inject() without opening ports.
 *
 * EP00: env-driven config, structured logging with redaction, request IDs, consistent
 * error envelope, security headers, restricted CORS, GET /health.
 * EP01: LINE ID-token login exchange, CSRF/origin checks, rate limiting, signed LINE
 * webhook, read-only Messaging API status.
 * EP02: everything persistent goes through the Store port (MariaDB in dev/test/prod,
 * MemoryStore in unit tests): sessions, rate limits, users, workspaces, appointments,
 * webhook dedupe. /api/v1 serves the application. No endpoint sends LINE messages.
 * Without a store (no database configured) every auth/app route fails closed (503).
 */
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { PersistentRateLimiter, PersistentSessions } from './auth/persistent.js';
import { registerAuthRoutes } from './auth/routes.js';
import { ApiError, type Clock } from './core/context.js';
import { AppointmentService } from './domain/appointments.js';
import { DestinationService } from './domain/destinations.js';
import { IdentityService } from './domain/identity.js';
import { InvitationService } from './domain/invitations.js';
import { WorkspaceService } from './domain/workspaces.js';
import type { AppEnv } from './env.js';
import { registerV1Routes } from './http/v1.js';
import { sendApiError } from './http/context.js';
import type { Store } from './store/types.js';
import { isAuthConfigured } from './env.js';
import { cookieSettings } from './http/security.js';
import {
  createLineIdTokenVerifier,
  type FetchLike,
  type IdTokenVerifier,
} from './line/id-token.js';
import { createLineMessagingReader, type LineMessagingReader } from './line/messaging.js';
import {
  registerWebhookRoute,
  WEBHOOK_DEDUPE_RETENTION_MS,
  WebhookRecorder,
} from './line/webhook.js';

export const SERVICE_NAME = 'pdabliss-flow-api';
export const SERVICE_VERSION = '0.2.0-ep02';

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
  /** Persistence. Absent → auth and application routes answer 503 (fail closed). */
  store?: Store | null;
  /** Optional log destination (tests capture output to verify redaction). */
  logStream?: { write(msg: string): void };
  /** Test seams — production code uses the real LINE-backed implementations. */
  deps?: {
    fetchImpl?: FetchLike;
    verifier?: IdTokenVerifier | null;
    messaging?: LineMessagingReader | null;
    now?: () => number;
    loginLimit?: { limit: number; windowMs: number };
    apiLimit?: { limit: number; windowMs: number };
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

export function buildApp({
  env,
  logStream,
  deps = {},
  store = null,
}: BuildAppOptions): FastifyInstance {
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
      .header('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
      .header(
        'access-control-allow-headers',
        'content-type, authorization, x-flow-csrf, idempotency-key',
      )
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
  const clock: Clock = () => new Date(now());
  const secret = isAuthConfigured(integration) ? integration.sessionSecret : null;
  const sessions =
    store && secret
      ? new PersistentSessions(
          store,
          secret,
          {
            absoluteMs: (integration?.sessionAbsoluteMinutes ?? 480) * 60_000,
            idleMs: (integration?.sessionIdleMinutes ?? 120) * 60_000,
          },
          clock,
        )
      : null;
  const loginLimit = deps.loginLimit ?? { limit: 10, windowMs: 5 * 60_000 };
  const apiLimit = deps.apiLimit ?? { limit: 240, windowMs: 60_000 };
  const limiter = (l: { limit: number; windowMs: number }) =>
    store && secret ? new PersistentRateLimiter(store, secret, l.limit, l.windowMs, clock) : null;
  const identity = store ? new IdentityService(store, clock, sessions) : null;
  const destinations = store ? new DestinationService(store, clock) : null;
  const recorder = new WebhookRecorder(now);

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
  const cookie = cookieSettings(integration?.publicBaseUrl ?? null);

  registerAuthRoutes(app, {
    config: integration,
    allowedOrigins,
    verifier,
    sessions,
    store: store as Store,
    identity,
    cookie,
    loginLimiter: limiter(loginLimit),
    sessionLimiter: limiter({ limit: 120, windowMs: 60_000 }),
    messaging,
    webhookSummary: async () => ({
      ...recorder.summary(),
      ...(destinations ? await destinations.counts() : {}),
    }),
  });
  registerWebhookRoute(app, {
    channelSecret: store ? (integration?.line.messagingChannelSecret ?? null) : null,
    resolveBotUserId,
    recorder,
    persistence: {
      claim: async (eventId, type, sourceType) => {
        const at = clock();
        return (store as Store).recordWebhookEvent({
          eventId,
          type,
          sourceType,
          receivedAt: at,
          expiresAt: new Date(at.getTime() + WEBHOOK_DEDUPE_RETENTION_MS),
        });
      },
      onGroupEvent: async (kind, groupId) => destinations?.onGroupEvent(kind, groupId),
    },
  });
  if (store && sessions && identity && destinations) {
    registerV1Routes(app, {
      store,
      sessions,
      cookie,
      allowedOrigins,
      limiter: limiter(apiLimit),
      identity,
      workspaces: new WorkspaceService(store, clock),
      invitations: new InvitationService(store, clock),
      destinations,
      appointments: new AppointmentService(store, clock, integration?.publicBaseUrl ?? null),
      messaging,
      publicBaseUrl: integration?.publicBaseUrl ?? null,
      clock,
    });
  } else {
    app.all('/api/v1/*', async (request, reply) =>
      reply
        .code(503)
        .send(errorBody('SERVICE_NOT_CONFIGURED', 'The application is not configured', request.id)),
    );
  }

  app.setNotFoundHandler(async (request, reply) => {
    return reply.code(404).send(errorBody('NOT_FOUND', 'Resource not found', request.id));
  });

  app.setErrorHandler(async (error: FastifyError, request, reply) => {
    if (error instanceof ApiError) return sendApiError(reply, request, error);
    if (error.validation) {
      return reply
        .code(400)
        .send(errorBody('VALIDATION_ERROR', 'Request validation failed', request.id));
    }
    const status =
      typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500
        ? error.statusCode
        : 500;
    const failureCode = databaseFailureCode(error);
    if (failureCode) {
      request.log.error({ code: failureCode }, 'Database unavailable');
      return reply
        .code(503)
        .header('retry-after', '30')
        .send(
          errorBody('DATABASE_UNAVAILABLE', 'The service is temporarily unavailable', request.id),
        );
    }
    if (status >= 500) {
      // Driver and application errors can contain SQL or appointment content.
      request.log.error('Unhandled error');
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

const DATABASE_UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ER_GET_CONNECTION_TIMEOUT',
  'ER_CON_COUNT_ERROR',
  'ER_CONNECTION_ALREADY_CLOSED',
  'ER_CMD_CONNECTION_CLOSED',
  'ER_CONNECTION_TIMEOUT',
  'ER_CONNECTION_KILLED',
  'ER_SOCKET_UNEXPECTED_CLOSE',
  'ER_SOCKET_TIMEOUT',
  'P1001',
  'P1002',
  'P1008',
  'P1017',
  'P2024',
  'P2037',
]);

/** Accept only known connection failures, including MariaDB's adapter-wrapped errors. */
export function databaseFailureCode(error: {
  code?: unknown;
  errorCode?: unknown;
  cause?: unknown;
  meta?: unknown;
}): string | undefined {
  const meta = error.meta as { driverAdapterError?: { cause?: unknown } } | undefined;
  for (const candidate of [error, error.cause, meta?.driverAdapterError?.cause]) {
    if (typeof candidate !== 'object' || candidate === null) continue;
    const { code, errorCode, kind } = candidate as Record<string, unknown>;
    for (const value of [code, errorCode]) {
      if (typeof value === 'string' && DATABASE_UNAVAILABLE_CODES.has(value)) return value;
    }
    if (
      typeof kind === 'string' &&
      ['ConnectionClosed', 'SocketTimeout', 'TooManyConnections', 'DatabaseNotReachable'].includes(
        kind,
      )
    )
      return kind;
  }
  return undefined;
}

export function errorBody(code: string, message: string, requestId: string): ErrorBody {
  return { error: { code, message, requestId } };
}

/**
 * Fastify application factory. No network listening happens here — server.ts does that —
 * so tests can build the app and use app.inject() without opening ports.
 *
 * Implemented in EP00: env-driven config, structured logging with redaction, request IDs,
 * consistent error envelope, security headers, restricted CORS, GET /health.
 * NOT implemented (planned, see docs/SECURITY-AND-PRIVACY.md): authentication,
 * authorization, rate limiting, webhooks. No endpoint sends LINE messages.
 */
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { AppEnv } from './env.js';

export const SERVICE_NAME = 'pdabliss-flow-api';
export const SERVICE_VERSION = '0.0.0-ep00';

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
];

export interface ErrorBody {
  error: { code: string; message: string; requestId: string };
}

export interface BuildAppOptions {
  env: AppEnv;
  /** Optional log destination (tests capture output to verify redaction). */
  logStream?: { write(msg: string): void };
}

const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'cross-origin-resource-policy': 'same-site',
  'cache-control': 'no-store',
};

export function buildApp({ env, logStream }: BuildAppOptions): FastifyInstance {
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
      .header('access-control-allow-headers', 'content-type, authorization')
      .header('access-control-max-age', '600');
    return reply.code(204).send();
  });

  app.get(
    '/health',
    {
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
    },
    // Liveness only: deliberately independent of database/LINE (not used in EP00),
    // and exposes no host, path, environment or dependency details.
    async () => ({
      status: 'ok' as const,
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      time: new Date().toISOString(),
    }),
  );

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

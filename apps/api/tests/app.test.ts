import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp, SERVICE_NAME } from '../src/app.js';
import { EnvError, loadEnv, type AppEnv } from '../src/env.js';

const env: AppEnv = {
  nodeEnv: 'test',
  host: '127.0.0.1',
  port: 0,
  logLevel: 'silent',
  corsOrigins: ['http://127.0.0.1:6767'],
};

describe('environment validation', () => {
  it('applies safe loopback defaults', () => {
    const e = loadEnv({});
    assert.equal(e.host, '127.0.0.1');
    assert.equal(e.port, 6768);
    assert.equal(e.nodeEnv, 'development');
    assert.deepEqual(e.corsOrigins, ['http://localhost:6767', 'http://127.0.0.1:6767']);
  });

  it('refuses non-loopback binding in development unless explicitly allowed', () => {
    assert.throws(() => loadEnv({ API_HOST: '0.0.0.0' }), EnvError);
    assert.equal(loadEnv({ API_HOST: '0.0.0.0', ALLOW_NON_LOOPBACK: 'true' }).host, '0.0.0.0');
  });

  it('rejects wildcard or malformed CORS origins and invalid ports', () => {
    assert.throws(() => loadEnv({ CORS_ORIGINS: '*' }), EnvError);
    assert.throws(() => loadEnv({ CORS_ORIGINS: 'http://a.test/path' }), EnvError);
    assert.throws(() => loadEnv({ API_PORT: '70000' }), EnvError);
  });

  it('never echoes variable values in error messages', () => {
    try {
      loadEnv({ API_PORT: 'super-secret-value' });
      assert.fail('expected EnvError');
    } catch (err) {
      assert.ok(err instanceof EnvError);
      assert.ok(!err.message.includes('super-secret-value'));
    }
  });
});

describe('API application', () => {
  let app: FastifyInstance;
  before(async () => {
    app = buildApp({ env });
    app.get('/__test/boom', async () => {
      throw new Error('database password is hunter2');
    });
    await app.ready();
  });
  after(async () => {
    await app.close();
  });

  it('GET /health returns minimal liveness information', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.service, SERVICE_NAME);
    assert.deepEqual(Object.keys(body).sort(), ['service', 'status', 'time', 'version']);
    // No host/environment/system details
    assert.ok(!/hostname|pid|env|memory|uptime|path/i.test(res.body));
  });

  it('sets security headers and a request id', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-frame-options'], 'DENY');
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.match(String(res.headers['content-security-policy']), /default-src 'none'/);
    assert.match(String(res.headers['x-request-id']), /^[0-9a-f-]{36}$/);
  });

  it('returns a consistent error envelope for unknown routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/does-not-exist' });
    assert.equal(res.statusCode, 404);
    const body = res.json();
    assert.equal(body.error.code, 'NOT_FOUND');
    assert.equal(typeof body.error.requestId, 'string');
  });

  it('hides internal error details from clients', async () => {
    const res = await app.inject({ method: 'GET', url: '/__test/boom' });
    assert.equal(res.statusCode, 500);
    assert.equal(res.json().error.code, 'INTERNAL_ERROR');
    assert.ok(!res.body.includes('hunter2'));
  });

  it('allows CORS only for configured origins', async () => {
    const ok = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://127.0.0.1:6767' },
    });
    assert.equal(ok.headers['access-control-allow-origin'], 'http://127.0.0.1:6767');
    const denied = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://evil.example' },
    });
    assert.equal(denied.headers['access-control-allow-origin'], undefined);
  });

  it('answers preflight for allowed origins and refuses others', async () => {
    const ok = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: { origin: 'http://127.0.0.1:6767', 'access-control-request-method': 'GET' },
    });
    assert.equal(ok.statusCode, 204);
    const denied = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: { origin: 'https://evil.example' },
    });
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.json().error.code, 'CORS_ORIGIN_DENIED');
  });

  it('exposes no endpoint that sends notifications', () => {
    const routes = app.printRoutes({ commonPrefix: false });
    // EP01 adds receive-only LINE routes (webhook, status); nothing may send messages.
    assert.ok(!/notif|send|push|reply|multicast|broadcast|narrowcast/i.test(routes), routes);
  });
});

describe('log redaction', () => {
  it('censors secrets and appointment descriptions in structured logs', async () => {
    const lines: string[] = [];
    const app = buildApp({
      env: { ...env, logLevel: 'info' },
      logStream: { write: (m: string) => void lines.push(m) },
    });
    await app.ready();
    app.log.info(
      {
        payload: {
          token: 'tkn-123',
          channelSecret: 'sec-456',
          description: 'นัดหาหมอเรื่องส่วนตัว',
          title: 'ok',
        },
      },
      'test',
    );
    await app.close();
    const out = lines.join('\n');
    assert.ok(out.includes('[REDACTED]'));
    assert.ok(!out.includes('tkn-123'));
    assert.ok(!out.includes('sec-456'));
    assert.ok(!out.includes('นัดหาหมอ'));
  });
});

import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  loadSecretFile,
  parseEnvText,
  SecretFileError,
  unsafeSecretLocationReasons,
} from '../src/config/secret-file.js';
import { EnvError, isAuthConfigured, isWebhookConfigured, loadEnv } from '../src/env.js';
import { API_ALLOWLIST, createGateway } from '../src/gateway.js';
import { tempDir } from './helpers.js';

const VALID = {
  LINE_LOGIN_CHANNEL_ID: '1000000001',
  LINE_MESSAGING_CHANNEL_ID: '1000000002',
  LINE_LIFF_ID: '1000000001-AbCdEfGh',
  LINE_MESSAGING_CHANNEL_SECRET: '0123456789abcdef'.repeat(2),
  SESSION_SECRET: 's'.repeat(48),
  PUBLIC_BASE_URL: 'https://flow-test.example/',
};

describe('integration configuration', () => {
  it('is disabled (fail closed) when nothing is configured', () => {
    const e = loadEnv({});
    assert.equal(isAuthConfigured(e.integration), false);
    assert.equal(isWebhookConfigured(e.integration), false);
  });

  it('accepts a complete configuration and adds PUBLIC_BASE_URL to allowed origins', () => {
    const e = loadEnv(VALID);
    assert.equal(isAuthConfigured(e.integration), true);
    assert.equal(isWebhookConfigured(e.integration), true);
    assert.ok(e.corsOrigins.includes('https://flow-test.example'));
  });

  it('rejects malformed values without echoing them', () => {
    const cases: Record<string, string>[] = [
      { LINE_MESSAGING_CHANNEL_SECRET: 'TOPSECRET-not-hex-value-1234567890' },
      { SESSION_SECRET: 'short-secret' },
      { LINE_LIFF_ID: 'bad' },
      { PUBLIC_BASE_URL: 'http://flow-test.example' },
      { FLOW_ALLOWED_LINE_USER_IDS: 'Uabc,not-an-id' },
      { LINE_LOGIN_CHANNEL_ID: '1000000001', LINE_LIFF_ID: '2000000002-AbCdEfGh' },
    ];
    for (const c of cases) {
      try {
        loadEnv(c);
        assert.fail(`expected EnvError for ${Object.keys(c).join(',')}`);
      } catch (err) {
        assert.ok(err instanceof EnvError);
        for (const v of Object.values(c)) assert.ok(!err.message.includes(v), 'value echoed');
      }
    }
  });

  it('production refuses to start without auth configuration and https base URL', () => {
    assert.throws(() => loadEnv({ NODE_ENV: 'production' }), EnvError);
    assert.doesNotThrow(() => loadEnv({ ...VALID, NODE_ENV: 'production' }));
  });
});

describe('external secret file', () => {
  const projectRoot = 'D:\\One Drive\\OneDrive\\Desktop\\project\\pdabliss_flow'.replace(
    /\\/g,
    '/',
  );

  it('refuses locations inside the project or a synchronised folder', () => {
    assert.ok(
      unsafeSecretLocationReasons(`${projectRoot}/.secrets`, { projectRoot, env: {} }).length > 0,
    );
    assert.ok(
      unsafeSecretLocationReasons('/home/u/OneDrive/flow', { projectRoot, env: {} }).length > 0,
    );
    assert.ok(
      unsafeSecretLocationReasons('/home/u/One Drive/x', { projectRoot, env: {} }).length > 0,
    );
    assert.ok(
      unsafeSecretLocationReasons('/home/u/Dropbox/flow', { projectRoot, env: {} }).length > 0,
    );
    assert.ok(
      unsafeSecretLocationReasons('/sync-root/flow', {
        projectRoot,
        env: { OneDriveConsumer: '/sync-root' },
      }).length > 0,
    );
    assert.deepEqual(
      unsafeSecretLocationReasons('/home/u/.pdabliss/flow', { projectRoot, env: {} }),
      [],
    );
  });

  it('loads KEY=VALUE files, tolerating BOM, comments and quotes', () => {
    const v = parseEnvText(
      '\uFEFF# comment\nSESSION_SECRET="abc def"\nLINE_LIFF_ID=1000000001-AbCdEfGh\n\nbad line\nlower=ignored\n',
    );
    assert.deepEqual(v, { SESSION_SECRET: 'abc def', LINE_LIFF_ID: '1000000001-AbCdEfGh' });
  });

  it('missing file → empty values; unsafe FLOW_ENV_FILE → error', () => {
    const dir = tempDir();
    const r = loadSecretFile({
      projectRoot: '/nonexistent-project',
      env: { FLOW_ENV_FILE: join(dir, 'dev.env') },
    });
    assert.equal(r.file, null);
    assert.deepEqual(r.values, {});
    writeFileSync(join(dir, 'dev.env'), 'SESSION_SECRET=' + 'z'.repeat(40) + '\n');
    assert.equal(
      loadSecretFile({
        projectRoot: '/nonexistent-project',
        env: { FLOW_ENV_FILE: join(dir, 'dev.env') },
      }).values.SESSION_SECRET?.length,
      40,
    );
    assert.throws(
      () => loadSecretFile({ projectRoot: dir, env: { FLOW_ENV_FILE: join(dir, 'dev.env') } }),
      SecretFileError,
    );
  });
});

describe('development gateway', () => {
  let upstream: Server;
  let gateway: Server;
  let base: string;
  const seen: string[] = [];

  before(async () => {
    const dist = tempDir();
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>FLOW</title>');
    writeFileSync(join(dist, 'assets', 'app-abc.js'), 'console.log(1)');
    writeFileSync(join(dist, 'assets', 'app-abc.js.map'), '{}');
    writeFileSync(join(dist, '.env'), 'SECRET=1');
    upstream = createServer((req, res) => {
      seen.push(
        `${req.method} ${req.url} ip=${String(req.headers['x-flow-client-ip'])} xff=${String(req.headers['x-forwarded-for'])} fwd=${String(req.headers.forwarded)} real=${String(req.headers['x-real-ip'])}`,
      );
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
    gateway = createGateway({
      webDist: dist,
      apiHost: '127.0.0.1',
      apiPort: (upstream.address() as AddressInfo).port,
    });
    await new Promise<void>((r) => gateway.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
  });
  after(async () => {
    await new Promise((r) => gateway.close(r));
    await new Promise((r) => upstream.close(r));
  });

  function hit(
    method: string,
    path: string,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
    return new Promise((resolve, reject) => {
      const req = request(`${base}${path}`, { method, headers }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      });
      req.on('error', reject);
      req.end();
    });
  }

  it('forwards only allow-listed API routes', async () => {
    for (const [m, p] of API_ALLOWLIST) assert.equal((await hit(m, p)).status, 200, `${m} ${p}`);
    for (const [m, p] of [
      ['GET', '/health'],
      ['GET', '/api/line/webhook'],
      ['DELETE', '/api/auth/session'],
      ['GET', '/api/admin'],
      ['POST', '/api/auth/enroll'],
    ]) {
      assert.equal((await hit(m as string, p as string)).status, 404, `${m} ${p}`);
    }
  });

  it('never exposes dev routes, source maps, dotfiles or tooling paths', async () => {
    for (const p of [
      '/dev/design-showcase',
      '/dev/auth-states',
      '/assets/app-abc.js.map',
      '/.env',
      '/src/main.tsx',
      '/@vite/client',
      '/node_modules/x',
      '/../package.json',
      '/%2e%2e/package.json',
      '/random-page',
    ]) {
      assert.equal((await hit('GET', p)).status, 404, p);
    }
  });

  it('serves the SPA for app routes with a CSP, and hashed assets as immutable', async () => {
    const page = await hit('GET', '/today');
    assert.equal(page.status, 200);
    assert.match(String(page.headers['content-security-policy']), /default-src 'self'/);
    assert.equal(page.headers['cache-control'], 'no-store');
    const asset = await hit('GET', '/assets/app-abc.js');
    assert.equal(asset.status, 200);
    assert.match(String(asset.headers['cache-control']), /immutable/);
  });

  it('passes the tunnel client address but never a client-forged one', async () => {
    seen.length = 0;
    await hit('GET', '/api/health', {
      'cf-connecting-ip': '203.0.113.7',
      'x-flow-client-ip': '1.1.1.1',
    });
    assert.match(seen[0] ?? '', /ip=203\.0\.113\.7/);
  });

  it('F05: distinct Cloudflare clients get distinct identities; forged forwarding headers are dropped', async () => {
    seen.length = 0;
    await hit('GET', '/api/health', { 'cf-connecting-ip': '198.51.100.1' });
    await hit('GET', '/api/health', { 'cf-connecting-ip': '2001:db8::7' });
    await hit('GET', '/api/health', {
      'cf-connecting-ip': '198.51.100.2',
      'x-forwarded-for': '10.9.9.9',
      forwarded: 'for=10.9.9.9',
      'x-real-ip': '10.9.9.9',
    });
    assert.match(seen[0] ?? '', /ip=198\.51\.100\.1 /);
    assert.match(seen[1] ?? '', /ip=2001:db8::7 /);
    assert.match(seen[2] ?? '', /ip=198\.51\.100\.2 xff=undefined fwd=undefined real=undefined/);
  });

  it('F05: a malformed CF-Connecting-IP never becomes an identity (falls back to the peer)', async () => {
    seen.length = 0;
    for (const bad of ['evil', '1.1.1.1, 2.2.2.2', 'x'.repeat(60), '999.1.1.1'])
      await hit('GET', '/api/health', { 'cf-connecting-ip': bad });
    assert.equal(seen.length, 4);
    for (const line of seen) assert.match(line, /ip=127\.0\.0\.1 /);
  });
  it('EP02: /api/v1 is proxied for API methods only; SPA deep links incl. invitations are served', async () => {
    for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
      assert.equal((await hit(m, '/api/v1/appointments')).status, 200, m);
    assert.equal((await hit('OPTIONS', '/api/v1/appointments')).status, 404);
    assert.equal((await hit('GET', '/api/v1//appointments')).status, 404);
    assert.equal((await hit('GET', '/api/v2/anything')).status, 404);
    for (const p of [
      '/owner',
      '/owner/requests',
      '/search',
      '/privacy',
      `/invite/${'A'.repeat(43)}`,
      '/appointments/0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b/edit',
      '/groups/0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b',
    ])
      assert.equal((await hit('GET', p)).status, 200, p);
    for (const p of ['/invite/short', '/groups/not-a-uuid', '/owner/secret', '/appointments/x/edit'])
      assert.equal((await hit('GET', p)).status, 404, p);
  });
});

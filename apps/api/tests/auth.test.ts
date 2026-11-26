import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { FileAccessStore } from '../src/auth/access.js';
import type { IdTokenResult, IdTokenVerifier } from '../src/line/id-token.js';
import {
  integration,
  ORIGIN,
  OWNER_ID,
  STRANGER_ID,
  tempDir,
  TESTER_ID,
  testEnv,
} from './helpers.js';

/** Token string → verification result. Real verification is covered in line-clients.test.ts. */
function fakeVerifier(map: Record<string, IdTokenResult>): IdTokenVerifier {
  return {
    async verify(t) {
      return map[t] ?? { ok: false, reason: 'invalid' };
    },
  };
}
const ok = (sub: string, name = 'Synthetic User'): IdTokenResult => ({
  ok: true,
  identity: { sub, name, exp: 0, iat: 0, amr: [] },
});
const TOKENS: Record<string, IdTokenResult> = {
  'tok.owner.sig': ok(OWNER_ID, 'Owner (synthetic)'),
  'tok.tester.sig': ok(TESTER_ID, 'Tester (synthetic)'),
  'tok.stranger.sig': ok(STRANGER_ID, 'Stranger (synthetic)'),
  'tok.expired.sig': { ok: false, reason: 'expired' },
  'tok.audience.sig': { ok: false, reason: 'wrong-audience' },
  'tok.malformed': { ok: false, reason: 'malformed' },
  'tok.upstream.sig': { ok: false, reason: 'upstream' },
};

function writeAccess(dir: string, users: object[]) {
  // write via the store API surface used by the CLI
  const store = new FileAccessStore({ dir });
  for (const u of users as {
    lineUserId: string;
    role: 'owner' | 'tester';
    status?: 'active' | 'revoked';
  }[]) {
    const ref = store.recordPending(u.lineUserId) as string;
    assert.equal(store.approve(ref, u.role, { allowAdditionalOwner: true }).ok, true);
    if (u.status === 'revoked') assert.equal(store.revoke(u.lineUserId.slice(-8)).ok, true);
  }
}

interface Ctx {
  app: FastifyInstance;
  dir: string;
  clock: { t: number };
}

async function setup(
  opts: { users?: object[]; envTesters?: string[]; loginLimit?: number } = {},
): Promise<Ctx> {
  const dir = tempDir();
  writeAccess(dir, opts.users ?? [{ lineUserId: OWNER_ID, role: 'owner' }]);
  const clock = { t: Date.UTC(2026, 10, 26, 4, 0, 0) };
  const app = buildApp({
    env: testEnv(integration({ secretDir: dir, allowedLineUserIds: opts.envTesters ?? [] })),
    deps: {
      verifier: fakeVerifier(TOKENS),
      messaging: null,
      now: () => clock.t,
      access: new FileAccessStore({ dir, envTesters: opts.envTesters ?? [], now: () => clock.t }),
      loginLimit: { limit: opts.loginLimit ?? 50, windowMs: 60_000 },
    },
  });
  await app.ready();
  return { app, dir, clock };
}

function cookieOf(res: { headers: Record<string, unknown> }): string | undefined {
  const raw = res.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : raw;
  return typeof first === 'string' ? first.split(';')[0] : undefined;
}

async function login(
  app: FastifyInstance,
  idToken: string,
  extra: { cookie?: string; origin?: string | null; body?: object } = {},
) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/line',
    headers: {
      'content-type': 'application/json',
      ...(extra.origin === null ? {} : { origin: extra.origin ?? ORIGIN }),
      ...(extra.cookie ? { cookie: extra.cookie } : {}),
    },
    payload: extra.body ?? { idToken },
  });
}

describe('auth configuration', () => {
  it('fails closed (503) when LINE Login is not configured', async () => {
    const app = buildApp({
      env: testEnv(integration({ line: { ...integration().line, loginChannelId: null } })),
    });
    await app.ready();
    assert.equal(
      (await app.inject({ method: 'GET', url: '/api/auth/config' })).json().authConfigured,
      false,
    );
    assert.equal((await login(app, 'tok.owner.sig')).statusCode, 503);
    assert.equal((await app.inject({ method: 'GET', url: '/api/auth/session' })).statusCode, 503);
    await app.close();
  });

  it('exposes only non-secret config (LIFF ID) when configured', async () => {
    const { app } = await setup();
    const body = (await app.inject({ method: 'GET', url: '/api/auth/config' })).json();
    assert.deepEqual(body, {
      authConfigured: true,
      liffId: `${integration().line.loginChannelId}-AbCdEfGh`,
    });
    await app.close();
  });
});

describe('login exchange', () => {
  it('approved owner gets an HttpOnly, Secure, SameSite=Lax __Host- session cookie', async () => {
    const { app } = await setup();
    const res = await login(app, 'tok.owner.sig');
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.state, 'approved');
    assert.equal(body.user.role, 'owner');
    assert.equal(typeof body.csrfToken, 'string');
    const setCookie = String(res.headers['set-cookie']);
    assert.match(setCookie, /^__Host-flow_session=[A-Za-z0-9_-]{43};/);
    for (const attr of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/'])
      assert.ok(setCookie.includes(attr), attr);
    assert.ok(!setCookie.includes('Domain='));
    assert.ok(
      !JSON.stringify(body).includes(OWNER_ID),
      'LINE user ID never returned to the client',
    );
    await app.close();
  });

  it('approved tester (access file) and env-listed tester are accepted', async () => {
    const { app } = await setup({
      users: [
        { lineUserId: OWNER_ID, role: 'owner' },
        { lineUserId: TESTER_ID, role: 'tester' },
      ],
    });
    assert.equal((await login(app, 'tok.tester.sig')).json().user.role, 'tester');
    await app.close();
    const env = await setup({ envTesters: [STRANGER_ID] });
    assert.equal((await login(env.app, 'tok.stranger.sig')).json().user.role, 'tester');
    await env.app.close();
  });

  it('unknown user is denied by default and given an enrollment reference — no session', async () => {
    const { app, dir } = await setup();
    const res = await login(app, 'tok.stranger.sig');
    assert.equal(res.statusCode, 403);
    const body = res.json();
    assert.equal(body.state, 'not-approved');
    assert.match(body.enrollmentRef, /^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    assert.match(
      String(res.headers['set-cookie']),
      /^__Host-flow_session=;.*Max-Age=0/,
      'no session issued',
    );
    const pending = JSON.parse(readFileSync(join(dir, 'pending-enrollments.json'), 'utf8'));
    assert.equal(pending.pending[0].reference, body.enrollmentRef);
    // same user again → same reference (no unbounded growth)
    assert.equal((await login(app, 'tok.stranger.sig')).json().enrollmentRef, body.enrollmentRef);
    await app.close();
  });

  it('revoked user is told access was revoked', async () => {
    const { app } = await setup({
      users: [
        { lineUserId: OWNER_ID, role: 'owner' },
        { lineUserId: TESTER_ID, role: 'tester', status: 'revoked' },
      ],
    });
    const res = await login(app, 'tok.tester.sig');
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().state, 'revoked');
    await app.close();
  });

  it('rejects invalid, expired, wrong-audience and malformed tokens; upstream failure is 503', async () => {
    const { app } = await setup();
    assert.equal((await login(app, 'garbage.token.x')).json().error.code, 'ID_TOKEN_INVALID');
    assert.equal((await login(app, 'tok.expired.sig')).json().error.code, 'ID_TOKEN_EXPIRED');
    assert.equal((await login(app, 'tok.audience.sig')).json().error.code, 'ID_TOKEN_INVALID');
    assert.equal((await login(app, 'tok.malformed')).statusCode, 401);
    const up = await login(app, 'tok.upstream.sig');
    assert.equal(up.statusCode, 503);
    assert.equal(up.json().error.code, 'LINE_UNAVAILABLE');
    await app.close();
  });

  it('rejects client-supplied identity or role fields (no escalation)', async () => {
    const { app } = await setup({
      users: [
        { lineUserId: OWNER_ID, role: 'owner' },
        { lineUserId: TESTER_ID, role: 'tester' },
      ],
    });
    for (const extra of [
      { role: 'owner' },
      { lineUserId: OWNER_ID },
      { userId: OWNER_ID },
      { isAdmin: true },
    ]) {
      const res = await login(app, '', { body: { idToken: 'tok.tester.sig', ...extra } });
      assert.equal(res.statusCode, 400, JSON.stringify(extra));
    }
    assert.equal((await login(app, 'tok.tester.sig')).json().user.role, 'tester');
    await app.close();
  });

  it('rejects missing or foreign Origin (CSRF on login)', async () => {
    const { app } = await setup();
    assert.equal((await login(app, 'tok.owner.sig', { origin: null })).statusCode, 403);
    const evil = await login(app, 'tok.owner.sig', { origin: 'https://evil.example' });
    assert.equal(evil.statusCode, 403);
    assert.equal(evil.json().error.code, 'ORIGIN_DENIED');
    await app.close();
  });

  it('rate-limits login attempts per client', async () => {
    const { app } = await setup({ loginLimit: 3 });
    const codes: number[] = [];
    for (let i = 0; i < 5; i += 1) codes.push((await login(app, 'garbage.token.x')).statusCode);
    assert.deepEqual(codes, [401, 401, 401, 429, 429]);
    await app.close();
  });
});

describe('sessions', () => {
  it('session endpoint returns the approved state and a CSRF token', async () => {
    const { app } = await setup();
    const cookie = cookieOf(await login(app, 'tok.owner.sig')) as string;
    const s = await app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie } });
    assert.equal(s.statusCode, 200);
    assert.equal(s.json().state, 'approved');
    assert.equal(
      (await app.inject({ method: 'GET', url: '/api/auth/session' })).json().state,
      'unauthenticated',
    );
    await app.close();
  });

  it('prevents session fixation: logging in rotates to a new ID and kills the presented one', async () => {
    const { app } = await setup();
    const first = cookieOf(await login(app, 'tok.owner.sig')) as string;
    const second = cookieOf(await login(app, 'tok.owner.sig', { cookie: first })) as string;
    assert.notEqual(first, second);
    assert.equal(
      (await app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie: first } }))
        .statusCode,
      401,
    );
    assert.equal(
      (await app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie: second } }))
        .statusCode,
      200,
    );
    // An attacker-chosen session value is never adopted
    const planted = '__Host-flow_session=attacker-chosen-value';
    const res = await login(app, 'tok.owner.sig', { cookie: planted });
    assert.ok(!String(res.headers['set-cookie']).includes('attacker-chosen-value'));
    await app.close();
  });

  it('expires after idle time and reports "expired"', async () => {
    const { app, clock } = await setup();
    const cookie = cookieOf(await login(app, 'tok.owner.sig')) as string;
    clock.t += 121 * 60_000;
    const res = await app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie } });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().state, 'expired');
    await app.close();
  });

  it('expires at the absolute limit even when active', async () => {
    const { app, clock } = await setup();
    const cookie = cookieOf(await login(app, 'tok.owner.sig')) as string;
    for (let i = 0; i < 9; i += 1) {
      clock.t += 60 * 60_000;
      await app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie } });
    }
    assert.equal(
      (await app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie } })).json()
        .state,
      'expired',
    );
    await app.close();
  });

  it('revoking access in the access file ends active sessions on the next request', async () => {
    const { app, dir } = await setup({
      users: [
        { lineUserId: OWNER_ID, role: 'owner' },
        { lineUserId: TESTER_ID, role: 'tester' },
      ],
    });
    const cookie = cookieOf(await login(app, 'tok.tester.sig')) as string;
    assert.equal(new FileAccessStore({ dir }).revoke(TESTER_ID.slice(-6)).ok, true);
    const res = await app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie } });
    assert.equal(res.json().state, 'revoked');
    assert.equal(
      (await app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie } })).json()
        .state,
      'revoked',
    );
    await app.close();
  });

  it('logout requires origin + CSRF token, then the session is unusable', async () => {
    const { app } = await setup();
    const res = await login(app, 'tok.owner.sig');
    const cookie = cookieOf(res) as string;
    const csrf = res.json().csrfToken as string;
    const noCsrf = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie, origin: ORIGIN },
    });
    assert.equal(noCsrf.statusCode, 403);
    assert.equal(noCsrf.json().error.code, 'CSRF_INVALID');
    const wrongCsrf = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie, origin: ORIGIN, 'x-flow-csrf': 'x'.repeat(43) },
    });
    assert.equal(wrongCsrf.statusCode, 403);
    const foreign = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie, origin: 'https://evil.example', 'x-flow-csrf': csrf },
    });
    assert.equal(foreign.statusCode, 403);
    const out = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie, origin: ORIGIN, 'x-flow-csrf': csrf },
    });
    assert.equal(out.statusCode, 200);
    assert.match(String(out.headers['set-cookie']), /Max-Age=0/);
    assert.equal(
      (await app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie } }))
        .statusCode,
      401,
    );
    await app.close();
  });

  it('owner-only LINE status: testers are forbidden, unauthenticated is 401, missing token is 503', async () => {
    const { app } = await setup({
      users: [
        { lineUserId: OWNER_ID, role: 'owner' },
        { lineUserId: TESTER_ID, role: 'tester' },
      ],
    });
    assert.equal((await app.inject({ method: 'GET', url: '/api/line/status' })).statusCode, 401);
    const tester = cookieOf(await login(app, 'tok.tester.sig')) as string;
    assert.equal(
      (await app.inject({ method: 'GET', url: '/api/line/status', headers: { cookie: tester } }))
        .statusCode,
      403,
    );
    const owner = cookieOf(await login(app, 'tok.owner.sig')) as string;
    const s = await app.inject({
      method: 'GET',
      url: '/api/line/status',
      headers: { cookie: owner },
    });
    assert.equal(s.statusCode, 503);
    assert.equal(s.json().error.code, 'LINE_NOT_CONFIGURED');
    await app.close();
  });
});

describe('access store (local owner bootstrap)', () => {
  it('denies by default; approve requires a live reference; second owner needs explicit flag', () => {
    const dir = tempDir();
    const store = new FileAccessStore({ dir });
    assert.deepEqual(store.decide(OWNER_ID), { state: 'not-approved' });
    assert.equal(store.approve('ZZZZ-ZZZZ', 'owner').ok, false);
    const ref = store.recordPending(OWNER_ID) as string;
    assert.equal(
      store.approve(ref.toLowerCase().replace('-', ''), 'owner').ok,
      true,
      'references are case/format tolerant',
    );
    assert.deepEqual(store.decide(OWNER_ID), { state: 'approved', role: 'owner' });
    const ref2 = store.recordPending(STRANGER_ID) as string;
    const second = store.approve(ref2, 'owner');
    assert.equal(second.ok, false);
    assert.equal(store.approve(ref2, 'tester').ok, true);
    assert.ok(existsSync(join(dir, 'access.json')));
  });

  it('pending references expire after 15 minutes', () => {
    const dir = tempDir();
    let t = 0;
    const store = new FileAccessStore({ dir, now: () => t });
    const ref = store.recordPending(OWNER_ID) as string;
    t += 16 * 60_000;
    assert.equal(store.approve(ref, 'owner').ok, false);
  });

  it('a corrupted access file grants nothing', async () => {
    const dir = tempDir();
    const { writeFileSync } = await import('node:fs');
    writeFileSync(
      join(dir, 'access.json'),
      '{"version":1,"users":[{"lineUserId":"' +
        OWNER_ID +
        '","role":"superuser","status":"active","addedAt":"x"}]}',
    );
    assert.deepEqual(new FileAccessStore({ dir }).decide(OWNER_ID), { state: 'not-approved' });
  });
});

/**
 * G09 regression (Windows smoke, 2026-11-26): Windows PowerShell 5.1 `Invoke-WebRequest -Method POST`
 * without -ContentType sends `Content-Type: application/x-www-form-urlencoded` with an empty body.
 * Fastify parsed the content type BEFORE the route handler's Origin check and answered 415.
 * The Origin allow-list now runs in onRequest, before parsing.
 */
describe('G09 regression: origin check precedes body parsing; logout contract', () => {
  const FORM = 'application/x-www-form-urlencoded';
  const EVIL = 'https://evil.example';

  async function post(
    app: FastifyInstance,
    url: string,
    headers: Record<string, string>,
    payload?: string,
  ) {
    return app.inject({
      method: 'POST',
      url,
      headers,
      ...(payload === undefined ? {} : { payload }),
    });
  }
  async function sessionState(app: FastifyInstance, cookie: string) {
    return (await app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie } }))
      .statusCode;
  }

  it('foreign-origin POSTs are 403 ORIGIN_DENIED whatever the Content-Type (configured)', async () => {
    const { app } = await setup();
    for (const url of ['/api/auth/logout', '/api/auth/line']) {
      for (const [headers, payload] of [
        [{ origin: EVIL, 'content-type': FORM }, ''],
        [{ origin: EVIL, 'content-type': 'text/xml' }, '<x/>'],
        [{ origin: EVIL, 'content-type': 'application/json' }, '{}'],
        [{ origin: EVIL }, undefined],
        [{ 'content-type': FORM }, ''], // no Origin header at all
      ] as [Record<string, string>, string | undefined][]) {
        const res = await post(app, url, headers, payload);
        assert.equal(res.statusCode, 403, `${url} ${JSON.stringify(headers)}`);
        assert.equal(res.json().error.code, 'ORIGIN_DENIED');
      }
    }
    await app.close();
  });

  it('foreign-origin POSTs are 403 even when auth is not configured; allowed origin gets 503', async () => {
    const app = buildApp({
      env: testEnv(integration({ line: { ...integration().line, loginChannelId: null } })),
    });
    await app.ready();
    const foreign = await post(app, '/api/auth/logout', { origin: EVIL, 'content-type': FORM }, '');
    assert.equal(foreign.statusCode, 403);
    assert.equal(foreign.json().error.code, 'ORIGIN_DENIED');
    const allowed = await post(app, '/api/auth/logout', { origin: ORIGIN });
    assert.equal(allowed.statusCode, 503);
    assert.equal(allowed.json().error.code, 'AUTH_NOT_CONFIGURED');
    await app.close();
  });

  it('unsupported media type from an allowed origin is a separate 415 (no state change)', async () => {
    const { app } = await setup();
    const res = await login(app, 'tok.owner.sig');
    const cookie = cookieOf(res) as string;
    const csrf = res.json().csrfToken as string;
    for (const url of ['/api/auth/logout', '/api/auth/line']) {
      const r = await post(
        app,
        url,
        { origin: ORIGIN, cookie, 'x-flow-csrf': csrf, 'content-type': FORM },
        '',
      );
      assert.equal(r.statusCode, 415, url);
    }
    assert.equal(await sessionState(app, cookie), 200, 'session untouched by rejected requests');
    await app.close();
  });

  it('logout matrix in configured mode: invalid origin, missing/invalid CSRF never end the session', async () => {
    const { app } = await setup();
    const res = await login(app, 'tok.owner.sig');
    const cookie = cookieOf(res) as string;
    const csrf = res.json().csrfToken as string;
    const json = { 'content-type': 'application/json' };

    const badOrigin = await post(
      app,
      '/api/auth/logout',
      { ...json, origin: EVIL, cookie, 'x-flow-csrf': csrf },
      '{}',
    );
    assert.equal(badOrigin.statusCode, 403);
    assert.equal(badOrigin.json().error.code, 'ORIGIN_DENIED');
    assert.equal(await sessionState(app, cookie), 200);

    const missing = await post(app, '/api/auth/logout', { ...json, origin: ORIGIN, cookie }, '{}');
    assert.equal(missing.statusCode, 403);
    assert.equal(missing.json().error.code, 'CSRF_INVALID');
    assert.equal(await sessionState(app, cookie), 200);

    const invalid = await post(
      app,
      '/api/auth/logout',
      { ...json, origin: ORIGIN, cookie, 'x-flow-csrf': `${csrf.slice(0, -1)}x` },
      '{}',
    );
    assert.equal(invalid.statusCode, 403);
    assert.equal(invalid.json().error.code, 'CSRF_INVALID');
    assert.equal(await sessionState(app, cookie), 200);

    const extra = await post(
      app,
      '/api/auth/logout',
      { ...json, origin: ORIGIN, cookie, 'x-flow-csrf': csrf },
      '{"all":true}',
    );
    assert.equal(extra.statusCode, 400, 'logout accepts no data');
    assert.equal(await sessionState(app, cookie), 200);

    const valid = await post(
      app,
      '/api/auth/logout',
      { ...json, origin: ORIGIN, cookie, 'x-flow-csrf': csrf },
      '{}',
    );
    assert.equal(valid.statusCode, 200);
    assert.equal(valid.json().state, 'logged-out');
    assert.match(String(valid.headers['set-cookie']), /Max-Age=0/);
    assert.equal(await sessionState(app, cookie), 401, 'session ended');
    await app.close();
  });

  it('logout without a session (allowed origin, no body) is idempotent: 200 and cookie cleared', async () => {
    const { app } = await setup();
    const res = await post(app, '/api/auth/logout', { origin: ORIGIN });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().state, 'logged-out');
    assert.match(String(res.headers['set-cookie']), /Max-Age=0/);
    await app.close();
  });
});

describe('F05: rate-limit identity behind the dev gateway (no unrestricted trustProxy)', () => {
  async function attempt(
    app: FastifyInstance,
    remoteAddress: string,
    headers: Record<string, string> = {},
  ) {
    return (
      await app.inject({
        method: 'POST',
        url: '/api/auth/line',
        remoteAddress,
        headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
        payload: { idToken: 'garbage.token.x' },
      })
    ).statusCode;
  }

  it('distinct trusted client identities (from the loopback gateway) get separate buckets', async () => {
    const { app } = await setup({ loginLimit: 2 });
    const a = { 'x-flow-client-ip': '198.51.100.1' };
    const b = { 'x-flow-client-ip': '2001:db8::2' };
    assert.deepEqual(
      [
        await attempt(app, '127.0.0.1', a),
        await attempt(app, '127.0.0.1', a),
        await attempt(app, '127.0.0.1', a),
      ],
      [401, 401, 429],
    );
    assert.equal(await attempt(app, '127.0.0.1', b), 401, 'client B is not blocked by client A');
    await app.close();
  });

  it('429 carries a Retry-After header and the RATE_LIMITED code', async () => {
    const { app } = await setup({ loginLimit: 1 });
    await attempt(app, '127.0.0.1');
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/line',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      payload: { idToken: 'garbage.token.x' },
    });
    assert.equal(res.statusCode, 429);
    assert.equal(res.json().error.code, 'RATE_LIMITED');
    const wait = Number(res.headers['retry-after']);
    assert.ok(Number.isInteger(wait) && wait >= 1 && wait <= 300, `retry-after=${String(wait)}`);
    await app.close();
  });

  it('forged headers cannot escape the bucket: X-Forwarded-For, Forwarded, junk x-flow-client-ip', async () => {
    const { app } = await setup({ loginLimit: 2 });
    const forged: Record<string, string>[] = [
      { 'x-forwarded-for': '10.0.0.1' },
      { forwarded: 'for=10.0.0.2' },
      { 'x-flow-client-ip': 'not-an-ip' },
      { 'x-flow-client-ip': '10.0.0.3, 10.0.0.4' },
    ];
    const codes: number[] = [];
    for (const h of forged) codes.push(await attempt(app, '127.0.0.1', h));
    assert.deepEqual(codes, [401, 401, 429, 429], 'all share the peer bucket');
    await app.close();
  });

  it('x-flow-client-ip from a non-loopback peer is ignored (cannot be spoofed remotely)', async () => {
    const { app } = await setup({ loginLimit: 2 });
    const codes: number[] = [];
    for (let i = 1; i <= 3; i += 1)
      codes.push(await attempt(app, '203.0.113.50', { 'x-flow-client-ip': `198.51.100.${i}` }));
    assert.deepEqual(codes, [401, 401, 429]);
    await app.close();
  });
});

describe('F07 + section 6: session lifecycle around logout and enrollment', () => {
  it('logout revokes the server session; the old cookie cannot be reused anywhere', async () => {
    const { app } = await setup();
    const res = await login(app, 'tok.owner.sig');
    const oldCookie = cookieOf(res) as string;
    const csrf = res.json().csrfToken as string;
    const out = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: oldCookie, origin: ORIGIN, 'x-flow-csrf': csrf },
    });
    assert.equal(out.statusCode, 200);
    const session = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie: oldCookie },
    });
    assert.equal(session.statusCode, 401);
    assert.notEqual(session.json().state, 'approved');
    assert.equal(session.json().csrfToken, undefined);
    const status = await app.inject({
      method: 'GET',
      url: '/api/line/status',
      headers: { cookie: oldCookie },
    });
    assert.equal(status.statusCode, 401);
    // Replaying the old cookie + old CSRF token does not resurrect anything.
    await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: oldCookie, origin: ORIGIN, 'x-flow-csrf': csrf },
    });
    assert.equal(
      (
        await app.inject({
          method: 'GET',
          url: '/api/auth/session',
          headers: { cookie: oldCookie },
        })
      ).statusCode,
      401,
    );
    await app.close();
  });

  it('a subsequent LINE login creates a NEW valid session; membership survives logout (no re-enrollment)', async () => {
    const { app, dir } = await setup();
    const first = await login(app, 'tok.owner.sig');
    const oldCookie = cookieOf(first) as string;
    await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: {
        cookie: oldCookie,
        origin: ORIGIN,
        'x-flow-csrf': first.json().csrfToken as string,
      },
    });
    const second = await login(app, 'tok.owner.sig');
    assert.equal(second.statusCode, 200);
    assert.equal(second.json().state, 'approved');
    assert.equal(second.json().user.role, 'owner');
    const newCookie = cookieOf(second) as string;
    assert.notEqual(newCookie, oldCookie, 'a fresh session ID is issued');
    assert.notEqual(second.json().csrfToken, first.json().csrfToken, 'and a fresh CSRF token');
    assert.equal(
      (
        await app.inject({
          method: 'GET',
          url: '/api/auth/session',
          headers: { cookie: newCookie },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          method: 'GET',
          url: '/api/auth/session',
          headers: { cookie: oldCookie },
        })
      ).statusCode,
      401,
    );
    const store = new FileAccessStore({ dir });
    assert.equal(store.decide(OWNER_ID).state, 'approved', 'logout did not touch the access list');
    assert.equal(store.listPending().length, 0, 'no new enrollment was created');
    await app.close();
  });

  it('session restoration: reopening with the cookie returns the same approved session (no new login)', async () => {
    const { app, clock } = await setup();
    const res = await login(app, 'tok.owner.sig');
    const cookie = cookieOf(res) as string;
    clock.t += 30 * 60_000; // reopened 30 minutes later (inside the 2 h idle limit)
    const again = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie },
    });
    assert.equal(again.statusCode, 200);
    assert.equal(again.json().state, 'approved');
    assert.equal(again.json().csrfToken, res.json().csrfToken, 'same session, same CSRF token');
    assert.equal(again.headers['set-cookie'], undefined, 'no new session cookie');
    await app.close();
  });

  it('pending users get no session, cannot reach protected endpoints and see no private data', async () => {
    const { app } = await setup();
    const res = await login(app, 'tok.stranger.sig');
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().state, 'not-approved');
    assert.match(String(res.json().enrollmentRef), /^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    const raw = res.body;
    for (const secret of [STRANGER_ID, OWNER_ID, 'Stranger (synthetic)', 'Owner (synthetic)'])
      assert.ok(!raw.includes(secret), 'no user IDs or display names in the pending response');
    for (const c of [res.headers['set-cookie'] ?? []].flat())
      assert.match(String(c), /Max-Age=0/, 'only a cookie-clearing header, never a session');
    assert.equal((await app.inject({ method: 'GET', url: '/api/line/status' })).statusCode, 401);
    assert.equal((await app.inject({ method: 'GET', url: '/api/auth/session' })).statusCode, 401);
    await app.close();
  });

  it('the same pending user gets the same reference (no reference spam); unknown/expired references are rejected', async () => {
    const { app, dir, clock } = await setup();
    const a = (await login(app, 'tok.stranger.sig')).json().enrollmentRef as string;
    const b = (await login(app, 'tok.stranger.sig')).json().enrollmentRef as string;
    assert.equal(a, b);
    const store = () => new FileAccessStore({ dir, now: () => clock.t });
    assert.deepEqual(store().approve('ZZZZ-ZZZZ', 'tester'), {
      ok: false,
      reason: 'unknown-reference',
    });
    clock.t += 16 * 60_000;
    assert.equal(store().approve(a, 'tester').ok, false, 'expired reference cannot be approved');
    await app.close();
  });
});

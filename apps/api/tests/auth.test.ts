/**
 * Authentication & session security — the 34 EP01 cases migrated one-to-one to the EP02
 * persistent store (MariaDB in production, MemoryStore here; the same flows run against the
 * TEST database in tests-db/). Where EP02 deliberately changed the contract, the test keeps
 * the EP01 name's intent and asserts the new behaviour; see docs/TEST-MATRIX.md §auth.
 *
 *   EP01 access file + reference codes  →  in-app access request + Owner Console
 *   EP01 env allow-list testers          →  retired (no approval path outside the console)
 *   EP01 pending = no session            →  pending users get a session with zero access
 */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { buildApp } from '../src/app.js';
import { FileAccessStore } from '../src/auth/access.js';
import { importOwner, IdentityService } from '../src/domain/identity.js';
import { MemoryStore } from '../src/store/memory.js';
import { integration, ORIGIN, OWNER_ID, tempDir, testEnv } from './helpers.js';
import {
  createHarness,
  fakeVerifier,
  lineId,
  seedUser,
  tokenFor,
  type Harness,
} from './support/harness.js';

const FORM = 'application/x-www-form-urlencoded';
const EVIL = 'https://evil.example';
const CHANNEL = integration().line.loginChannelId as string;
const JSON_CT = { origin: ORIGIN, 'content-type': 'application/json' };

const raw = (h: Harness, url: string, headers: Record<string, string>, payload = '{}') =>
  h.app.inject({ method: 'POST', url, headers, payload });

const attempt = (h: Harness, remoteAddress: string, headers: Record<string, string> = {}) =>
  h.app.inject({
    method: 'POST',
    url: '/api/auth/line',
    remoteAddress,
    headers: { ...JSON_CT, ...headers },
    payload: { idToken: 'garbage' },
  });

describe('auth: configuration', () => {
  it('fails closed (503) when LINE Login is not configured', async () => {
    const app = buildApp({
      env: testEnv(integration({ line: { ...integration().line, loginChannelId: null } })),
      store: new MemoryStore(),
    });
    await app.ready();
    assert.equal(
      (await app.inject({ method: 'GET', url: '/api/auth/config' })).json().authConfigured,
      false,
    );
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/line',
      headers: JSON_CT,
      payload: { idToken: 'a.b.c' },
    });
    assert.equal(r.statusCode, 503);
    assert.equal((await app.inject({ method: 'GET', url: '/api/auth/session' })).statusCode, 503);
    await app.close();
    // EP02: without a database the application API fails closed too.
    const noStore = buildApp({ env: testEnv(integration()), store: null });
    await noStore.ready();
    assert.equal(
      (await noStore.inject({ method: 'GET', url: '/api/v1/today' })).json().error.code,
      'SERVICE_NOT_CONFIGURED',
    );
    assert.equal(
      (
        await noStore.inject({
          method: 'POST',
          url: '/api/auth/line',
          headers: JSON_CT,
          payload: { idToken: 'a.b.c' },
        })
      ).statusCode,
      503,
    );
    await noStore.close();
  });

  it('exposes only non-secret config (LIFF ID) when configured', async () => {
    const h = await createHarness();
    assert.deepEqual((await h.client().get('/api/auth/config')).json(), {
      authConfigured: true,
      liffId: `${CHANNEL}-AbCdEfGh`,
    });
    await h.close();
  });
});

describe('auth: login outcomes', () => {
  it('approved owner gets an HttpOnly, Secure, SameSite=Lax __Host- session cookie', async () => {
    const h = await createHarness();
    const owner = await seedUser(h.store, 1, { globalRole: 'OWNER' });
    const res = await h.client().login(owner.token);
    assert.equal(res.statusCode, 200);
    const cookie = String(res.headers['set-cookie']);
    assert.match(cookie, /^__Host-flow_session=[A-Za-z0-9_-]{43};/);
    for (const attr of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/'])
      assert.ok(cookie.includes(attr), attr);
    assert.ok(!/Domain=/i.test(cookie));
    assert.match(cookie, /Max-Age=7200/, 'cookie lifetime follows the idle limit (test clock)');
    assert.equal(res.json().state, 'approved');
    assert.equal(res.json().user.globalRole, 'OWNER');
    assert.ok(!res.body.includes(owner.line), 'the LINE user id is never returned');
    await h.close();
  });

  it('approved users come from the database; the EP01 env allow-list no longer approves anyone', async () => {
    const h = await createHarness();
    const member = await seedUser(h.store, 2);
    assert.equal((await h.client().login(member.token)).json().state, 'approved');
    await h.close();
    // An id EP01 would have approved via FLOW_ALLOWED_LINE_USER_IDS is now just a new user.
    const app = buildApp({
      env: testEnv(integration({ allowedLineUserIds: [lineId(3)] })),
      store: new MemoryStore(),
      deps: { verifier: fakeVerifier, messaging: null },
    });
    await app.ready();
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/line',
      headers: JSON_CT,
      payload: { idToken: tokenFor(lineId(3)) },
    });
    assert.equal(r.json().state, 'new');
    await app.close();
  });

  it('unknown user is denied by default — a session with no access and no reference code', async () => {
    const h = await createHarness();
    const c = h.client();
    const r = await c.login(tokenFor(lineId(50)));
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().state, 'new');
    assert.ok(!/reference/i.test(r.body), 'no enrollment reference is issued in EP02');
    for (const url of [
      '/api/v1/today',
      '/api/v1/workspaces',
      '/api/v1/appointments',
      '/api/v1/admin/summary',
    ])
      assert.equal((await c.get(url)).statusCode, 403, url);
    await h.close();
  });

  it('revoked user is told access was revoked', async () => {
    const h = await createHarness();
    const u = await seedUser(h.store, 9, { status: 'REVOKED' });
    const c = h.client();
    assert.equal((await c.login(u.token)).json().state, 'revoked');
    assert.equal((await c.get('/api/v1/today')).json().error.code, 'ACCOUNT_REVOKED');
    await h.close();
  });

  it('rejects invalid, expired, wrong-audience and malformed tokens; upstream failure is 503', async () => {
    const h = await createHarness();
    const c = h.client();
    assert.equal((await c.login('nope')).json().error.code, 'ID_TOKEN_INVALID');
    assert.equal((await c.login('tok:expired')).json().error.code, 'ID_TOKEN_EXPIRED');
    assert.equal((await c.login('tok:audience')).json().error.code, 'ID_TOKEN_INVALID');
    assert.equal((await c.login('tok:malformed')).json().error.code, 'ID_TOKEN_INVALID');
    assert.equal((await c.login('tok:upstream')).statusCode, 503);
    assert.equal(c.cookie, null);
    assert.equal(await h.store.countUsers({}), 0, 'failed logins create nothing');
    await h.close();
  });

  it('rejects client-supplied identity or role fields (no escalation)', async () => {
    const h = await createHarness();
    for (const extra of [
      { lineUserId: lineId(2) },
      { role: 'OWNER' },
      { globalRole: 'OWNER' },
      { status: 'ACTIVE' },
    ]) {
      const r = await raw(
        h,
        '/api/auth/line',
        JSON_CT,
        JSON.stringify({ idToken: tokenFor(lineId(1)), ...extra }),
      );
      assert.equal(r.statusCode, 400, JSON.stringify(extra));
    }
    assert.equal(await h.store.countUsers({}), 0);
    await h.close();
  });

  it('rejects missing or foreign Origin (CSRF on login)', async () => {
    const h = await createHarness();
    const body = JSON.stringify({ idToken: tokenFor(lineId(1)) });
    assert.equal(
      (await raw(h, '/api/auth/line', { 'content-type': 'application/json' }, body)).statusCode,
      403,
    );
    assert.equal(
      (await raw(h, '/api/auth/line', { origin: EVIL, 'content-type': 'application/json' }, body))
        .statusCode,
      403,
    );
    assert.equal(await h.store.countUsers({}), 0);
    await h.close();
  });

  it('rate-limits login attempts per client', async () => {
    const h = await createHarness({ loginLimit: 3 });
    const ip = { 'x-flow-client-ip': '198.51.100.9' };
    const codes: number[] = [];
    for (let i = 0; i < 4; i += 1) codes.push((await attempt(h, '127.0.0.1', ip)).statusCode);
    assert.deepEqual(codes, [401, 401, 401, 429]);
    h.clock.t += 301_000; // login window is 5 minutes
    assert.equal((await attempt(h, '127.0.0.1', ip)).statusCode, 401, 'window resets');
    await h.close();
  });
});

describe('auth: session lifecycle (persistent)', () => {
  it('session endpoint returns the approved state and a CSRF token', async () => {
    const h = await createHarness();
    const u = await seedUser(h.store, 1);
    const c = h.client();
    await c.login(u.token);
    const s = (await c.get('/api/auth/session')).json();
    assert.equal(s.state, 'approved');
    assert.match(s.csrfToken, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(s.csrfToken, c.csrf);
    await h.close();
  });

  it('prevents session fixation: logging in rotates to a new ID and kills the presented one', async () => {
    const h = await createHarness();
    const u = await seedUser(h.store, 1);
    const c = h.client();
    await c.login(u.token);
    const first = c.cookie;
    await c.login(u.token);
    assert.ok(c.cookie && first && c.cookie !== first);
    const old = h.client();
    old.cookie = first;
    const r = await old.get('/api/auth/session');
    assert.equal(r.statusCode, 401);
    assert.equal(r.json().state, 'revoked');
    await h.close();
  });

  it('expires after idle time and reports "expired"', async () => {
    const h = await createHarness();
    const u = await seedUser(h.store, 1);
    const c = h.client();
    await c.login(u.token);
    h.clock.t += 121 * 60_000;
    const r = await c.get('/api/auth/session');
    assert.equal(r.statusCode, 401);
    assert.equal(r.json().state, 'expired');
    await h.close();
  });

  it('expires at the absolute limit even when active', async () => {
    const h = await createHarness();
    const u = await seedUser(h.store, 1);
    const c = h.client();
    await c.login(u.token);
    for (let i = 0; i < 8; i += 1) {
      h.clock.t += 59 * 60_000;
      assert.equal((await c.get('/api/auth/session')).statusCode, 200, `step ${i + 1}`);
    }
    h.clock.t += 60 * 60_000;
    assert.equal((await c.get('/api/auth/session')).json().state, 'expired', '8 h absolute limit');
    await h.close();
  });

  it('revoking access (Owner Console) ends active sessions on the next request', async () => {
    const h = await createHarness();
    const owner = await seedUser(h.store, 1, { globalRole: 'OWNER' });
    const u = await seedUser(h.store, 2);
    const oc = h.client();
    await oc.login(owner.token);
    const uc = h.client();
    await uc.login(u.token);
    assert.equal(
      (await oc.post(`/api/v1/admin/users/${u.id}/status`, { action: 'revoke' })).statusCode,
      200,
    );
    assert.equal((await uc.get('/api/auth/session')).json().state, 'revoked');
    assert.equal((await uc.get('/api/v1/today')).statusCode, 401);
    await h.close();
  });

  it('logout requires origin + CSRF token, then the session is unusable', async () => {
    const h = await createHarness();
    const u = await seedUser(h.store, 1);
    const c = h.client();
    await c.login(u.token);
    c.origin = EVIL;
    assert.equal((await c.post('/api/auth/logout')).statusCode, 403);
    c.origin = ORIGIN;
    const csrf = c.csrf;
    c.csrf = null;
    assert.equal((await c.post('/api/auth/logout')).json().error.code, 'CSRF_INVALID');
    c.csrf = csrf;
    assert.equal((await c.post('/api/auth/logout')).statusCode, 200);
    assert.equal((await c.get('/api/auth/session')).statusCode, 401);
    await h.close();
  });

  it('owner-only LINE status: non-owners are forbidden, unauthenticated is 401, missing token is 503', async () => {
    const h = await createHarness();
    const owner = await seedUser(h.store, 1, { globalRole: 'OWNER' });
    const admin = await seedUser(h.store, 2, { globalRole: 'ADMIN' });
    assert.equal((await h.client().get('/api/line/status')).statusCode, 401);
    const ac = h.client();
    await ac.login(admin.token);
    assert.equal((await ac.get('/api/line/status')).statusCode, 403, 'even a global admin');
    const oc = h.client();
    await oc.login(owner.token);
    assert.equal((await oc.get('/api/line/status')).json().error.code, 'LINE_NOT_CONFIGURED');
    await h.close();
  });
});

describe('auth: approvals and owner import (replaces the EP01 access file)', () => {
  it('denies by default; approve requires a live request; second owner needs explicit flag', async () => {
    const s = new MemoryStore();
    const now = new Date(Date.UTC(2026, 10, 26));
    const u = await seedUser(s, 5, { status: 'NEW' });
    const first = await importOwner(
      s,
      {
        lineUserId: OWNER_ID,
        displayName: 'เจ้าของ',
        loginChannelId: CHANNEL,
        allowAdditionalOwner: false,
      },
      now,
    );
    assert.equal(first.outcome, 'created');
    const owner = (await s.getUser(first.userId))!;
    const ids = new IdentityService(s, () => now, null);
    const actor = { user: owner, memberships: [] } as never;
    await assert.rejects(
      ids.approveRequest(actor, '00000000-0000-4000-8000-000000000000', []),
      (e: { status?: number }) => e.status === 404,
    );
    assert.equal(
      (
        await importOwner(
          s,
          {
            lineUserId: OWNER_ID,
            displayName: null,
            loginChannelId: CHANNEL,
            allowAdditionalOwner: false,
          },
          now,
        )
      ).outcome,
      'unchanged',
      'idempotent',
    );
    await assert.rejects(
      importOwner(
        s,
        {
          lineUserId: u.line,
          displayName: null,
          loginChannelId: CHANNEL,
          allowAdditionalOwner: false,
        },
        now,
      ),
      (e: { code?: string }) => e.code === 'OWNER_EXISTS',
    );
    assert.equal(
      (
        await importOwner(
          s,
          {
            lineUserId: u.line,
            displayName: null,
            loginChannelId: CHANNEL,
            allowAdditionalOwner: true,
          },
          now,
        )
      ).outcome,
      'promoted',
    );
  });

  it('access requests are bound to the signed-in account (nothing to leak or expire like EP01 references)', async () => {
    const h = await createHarness();
    assert.equal((await h.client().post('/api/v1/access-requests', {})).statusCode, 401);
    const c = h.client();
    await c.login(tokenFor(lineId(60)));
    const r = await c.post('/api/v1/access-requests', { message: 'สวัสดีค่ะ' });
    assert.equal(r.statusCode, 201);
    assert.ok(!/U[0-9a-f]{32}/.test(r.body) && !/reference/i.test(r.body));
    h.clock.t += 24 * 3_600_000; // still pending a day later; nothing expired
    await c.login(tokenFor(lineId(60)));
    assert.equal((await c.get('/api/v1/me')).json().access.requestStatus, 'pending');
    await h.close();
  });

  it('a corrupted EP01 access file grants nothing (owner import finds no owner)', () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, 'access.json'),
      '{"version":1,"users":[{"lineUserId":"' +
        OWNER_ID +
        '","role":"superuser","status":"active","addedAt":"x"}]}',
    );
    const owners = new FileAccessStore({ dir })
      .listUsers()
      .filter((u) => u.role === 'owner' && u.status === 'active');
    assert.equal(owners.length, 0);
  });
});

describe('auth: Origin before parsing (EP01 G09)', () => {
  it('foreign-origin POSTs are 403 ORIGIN_DENIED whatever the Content-Type (configured)', async () => {
    const h = await createHarness();
    for (const url of ['/api/auth/logout', '/api/auth/line', '/api/v1/workspaces'])
      for (const ct of [
        FORM,
        'application/json',
        'text/plain',
        'multipart/form-data; boundary=x',
      ]) {
        const r = await raw(h, url, { origin: EVIL, 'content-type': ct }, '');
        assert.equal(r.statusCode, 403, `${url} ${ct}`);
        assert.equal(r.json().error.code, 'ORIGIN_DENIED');
      }
    await h.close();
  });

  it('foreign-origin POSTs are 403 even when auth is not configured; allowed origin gets 503', async () => {
    const app = buildApp({
      env: testEnv(integration({ line: { ...integration().line, loginChannelId: null } })),
      store: new MemoryStore(),
    });
    await app.ready();
    const evil = await app.inject({
      method: 'POST',
      url: '/api/auth/line',
      headers: { origin: EVIL, 'content-type': FORM },
      payload: '',
    });
    assert.equal(evil.statusCode, 403);
    const good = await app.inject({
      method: 'POST',
      url: '/api/auth/line',
      headers: JSON_CT,
      payload: '{"idToken":"a.b.c"}',
    });
    assert.equal(good.statusCode, 503);
    await app.close();
  });

  it('unsupported media type from an allowed origin is a separate 415 (no state change)', async () => {
    const h = await createHarness();
    const u = await seedUser(h.store, 1);
    const c = h.client();
    await c.login(u.token);
    const r = await raw(
      h,
      '/api/auth/logout',
      {
        origin: ORIGIN,
        'content-type': FORM,
        cookie: c.cookie as string,
        'x-flow-csrf': c.csrf as string,
      },
      '',
    );
    assert.equal(r.statusCode, 415);
    assert.equal((await c.get('/api/auth/session')).statusCode, 200, 'session untouched');
    await h.close();
  });

  it('logout matrix in configured mode: invalid origin, missing/invalid CSRF never end the session', async () => {
    const h = await createHarness();
    const u = await seedUser(h.store, 1);
    const c = h.client();
    await c.login(u.token);
    const csrf = c.csrf as string;
    const cookie = c.cookie as string;
    const cases: Record<string, string>[] = [
      { origin: EVIL, 'x-flow-csrf': csrf },
      { 'x-flow-csrf': csrf },
      { origin: ORIGIN },
      { origin: ORIGIN, 'x-flow-csrf': `${csrf.slice(0, -1)}${csrf.endsWith('A') ? 'B' : 'A'}` },
      { origin: ORIGIN, 'x-flow-csrf': 'short' },
    ];
    for (const extra of cases) {
      const r = await raw(h, '/api/auth/logout', {
        'content-type': 'application/json',
        cookie,
        ...extra,
      });
      assert.equal(r.statusCode, 403, JSON.stringify(Object.keys(extra)));
    }
    const body = await raw(
      h,
      '/api/auth/logout',
      { ...JSON_CT, cookie, 'x-flow-csrf': csrf },
      '{"all":true}',
    );
    assert.equal(body.statusCode, 400);
    assert.equal(
      (await c.get('/api/auth/session')).statusCode,
      200,
      'still active after every refused logout',
    );
    await h.close();
  });

  it('logout without a session (allowed origin, no body) is idempotent: 200 and cookie cleared', async () => {
    const h = await createHarness();
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { origin: ORIGIN },
    });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().state, 'logged-out');
    assert.match(String(r.headers['set-cookie']), /Max-Age=0/);
    await h.close();
  });
});

describe('auth: rate limiting per trusted client identity (EP01 F05, persisted)', () => {
  it('distinct trusted client identities (from the loopback gateway) get separate buckets', async () => {
    const h = await createHarness({ loginLimit: 2 });
    const a = { 'x-flow-client-ip': '198.51.100.1' };
    for (let i = 0; i < 2; i += 1) await attempt(h, '127.0.0.1', a);
    assert.equal((await attempt(h, '127.0.0.1', a)).statusCode, 429);
    assert.equal(
      (await attempt(h, '127.0.0.1', { 'x-flow-client-ip': '2001:db8::2' })).statusCode,
      401,
    );
    await h.close();
  });

  it('429 carries a Retry-After header and the RATE_LIMITED code', async () => {
    const h = await createHarness({ loginLimit: 1 });
    await attempt(h, '127.0.0.1');
    const r = await attempt(h, '127.0.0.1');
    assert.equal(r.statusCode, 429);
    assert.equal(r.json().error.code, 'RATE_LIMITED');
    const wait = Number(r.headers['retry-after']);
    assert.ok(Number.isInteger(wait) && wait >= 1 && wait <= 300, String(wait));
    await h.close();
  });

  it('forged headers cannot escape the bucket: X-Forwarded-For, Forwarded, junk x-flow-client-ip', async () => {
    const h = await createHarness({ loginLimit: 2 });
    const forged: Record<string, string>[] = [
      { 'x-forwarded-for': '10.0.0.1' },
      { forwarded: 'for=10.0.0.2' },
      { 'x-flow-client-ip': 'not-an-ip' },
      { 'x-flow-client-ip': '10.0.0.3, 10.0.0.4' },
    ];
    const codes: number[] = [];
    for (const f of forged) codes.push((await attempt(h, '127.0.0.1', f)).statusCode);
    assert.deepEqual(codes, [401, 401, 429, 429]);
    await h.close();
  });

  it('x-flow-client-ip from a non-loopback peer is ignored (cannot be spoofed remotely)', async () => {
    const h = await createHarness({ loginLimit: 2 });
    const codes: number[] = [];
    for (let i = 1; i <= 3; i += 1)
      codes.push(
        (await attempt(h, '203.0.113.50', { 'x-flow-client-ip': `198.51.100.${i}` })).statusCode,
      );
    assert.deepEqual(codes, [401, 401, 429]);
    await h.close();
  });
});

describe('auth: logout, re-login and restoration', () => {
  it('logout revokes the server session; the old cookie cannot be reused anywhere', async () => {
    const h = await createHarness();
    const u = await seedUser(h.store, 1);
    const c = h.client();
    await c.login(u.token);
    const old = { cookie: c.cookie, csrf: c.csrf };
    assert.equal((await c.post('/api/auth/logout')).statusCode, 200);
    const replay = h.client();
    replay.cookie = old.cookie;
    replay.csrf = old.csrf;
    for (const url of ['/api/auth/session', '/api/v1/me', '/api/v1/today'])
      assert.equal((await replay.get(url)).statusCode, 401, url);
    assert.equal(
      (await replay.post('/api/v1/workspaces', { name: 'x', kind: 'CUSTOM' })).statusCode,
      401,
    );
    await h.restart();
    assert.equal(
      (await replay.get('/api/auth/session')).statusCode,
      401,
      'still dead after a restart',
    );
    await h.close();
  });

  it('a subsequent LINE login creates a NEW valid session; membership survives logout (no re-enrollment)', async () => {
    const h = await createHarness();
    const u = await seedUser(h.store, 1);
    const c = h.client();
    await c.login(u.token);
    const before = c.cookie;
    await c.post('/api/auth/logout');
    const again = await c.login(u.token);
    assert.equal(again.json().state, 'approved');
    assert.notEqual(c.cookie, before);
    assert.equal((await c.get('/api/v1/me')).json().workspaces.length, 1);
    await h.close();
  });

  it('session restoration: reopening with the cookie returns the same session — also after an API restart', async () => {
    const h = await createHarness();
    const u = await seedUser(h.store, 1);
    const c = h.client();
    const csrf = (await c.login(u.token)).json().csrfToken;
    h.clock.t += 30 * 60_000;
    const again = await c.get('/api/auth/session');
    assert.equal(again.json().csrfToken, csrf);
    assert.equal(again.headers['set-cookie'], undefined, 'no new cookie');
    await h.restart();
    assert.equal(
      (await c.get('/api/auth/session')).json().csrfToken,
      csrf,
      'persisted across restart',
    );
    await h.close();
  });

  it('pending users have a session but cannot reach protected endpoints and see no private data', async () => {
    const h = await createHarness();
    const owner = await seedUser(h.store, 1, { globalRole: 'OWNER' });
    const p = await seedUser(h.store, 2, { status: 'PENDING' });
    const c = h.client();
    assert.equal((await c.login(p.token)).json().state, 'pending');
    for (const url of [
      '/api/v1/today',
      '/api/v1/calendar?from=2026-12-01&to=2026-12-31',
      '/api/v1/admin/users',
      '/api/line/status',
    ])
      assert.equal((await c.get(url)).statusCode, 403, url);
    const me = (await c.get('/api/v1/me')).json();
    assert.deepEqual(me.workspaces, []);
    assert.ok(!JSON.stringify(me).includes(owner.id));
    await h.close();
  });

  it('the same pending user cannot open duplicate requests (no request spam); the owner sees one', async () => {
    const h = await createHarness();
    const owner = await seedUser(h.store, 1, { globalRole: 'OWNER' });
    const c = h.client();
    await c.login(tokenFor(lineId(70)));
    assert.equal((await c.post('/api/v1/access-requests', {})).statusCode, 201);
    const [a, b] = await Promise.all([
      c.post('/api/v1/access-requests', {}),
      c.post('/api/v1/access-requests', {}),
    ]);
    assert.deepEqual([a.statusCode, b.statusCode], [409, 409]);
    const oc = h.client();
    await oc.login(owner.token);
    assert.equal((await oc.get('/api/v1/admin/access-requests')).json().items.length, 1);
    await h.close();
  });
});

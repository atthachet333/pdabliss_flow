import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiRequestError, FlowApiClient } from '../src/auth/api-client.js';
import {
  AuthController,
  type GuardStorage,
  LoginGuard,
  RETRY_COOLDOWN_MS,
} from '../src/auth/flow.js';
import {
  ApiNetworkError,
  ApiRateLimitedError,
  DEFAULT_RETRY_AFTER_SECONDS,
  MAX_RETRY_AFTER_SECONDS,
  parseRetryAfter,
  type AuthApiPort,
  type AuthView,
  type ExchangeResult,
  type LiffPort,
  type SessionResult,
  type SessionUser,
} from '../src/auth/types.js';

const TOKEN = 'synthetic.id-token.for-tests';
const LIFF_ID = '1000000001-AbCdEfGh';
const NOW = Date.UTC(2026, 10, 26, 4, 0, 0);
const SIM_USER: SessionUser = {
  id: '00000000-0000-4000-8000-000000000001',
  displayName: 'ผู้ทดสอบ (จำลอง)',
  status: 'ACTIVE',
  globalRole: 'OWNER',
};
const APPROVED = {
  state: 'approved' as const,
  user: SIM_USER,
  expiresAt: '2026-11-26T12:00:00.000Z',
};
const limited = (state: 'new' | 'pending' | 'rejected' | 'suspended' | 'account-revoked') => ({
  state,
  user: {
    ...SIM_USER,
    globalRole: 'USER' as const,
    status: (
      {
        new: 'NEW',
        pending: 'PENDING',
        rejected: 'REJECTED',
        suspended: 'SUSPENDED',
        'account-revoked': 'REVOKED',
      } as const
    )[state],
  },
  expiresAt: '2026-11-26T12:00:00.000Z',
});
const PENDING = limited('pending');

class MemStorage implements GuardStorage {
  readonly writes: string[] = [];
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.writes.push(`${k}=${v}`);
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

function fakeLiff(
  o: Partial<{
    inClient: boolean;
    loggedIn: boolean;
    token: string | null;
    exp: number | null;
    initFails: boolean;
  }> = {},
) {
  const calls: string[] = [];
  const liff: LiffPort = {
    async init(id) {
      calls.push(`init:${id}`);
      if (o.initFails) throw new Error('INIT_FAILED');
    },
    isInClient: () => o.inClient ?? false,
    isLoggedIn: () => o.loggedIn ?? true,
    login: (uri) => void calls.push(`login:${uri}`),
    logout: () => void calls.push('logout'),
    getIDToken: () => (o.token === undefined ? TOKEN : o.token),
    getIdTokenExp: () => (o.exp === undefined ? Math.floor(NOW / 1000) + 600 : o.exp),
  };
  return { liff, calls };
}

function fakeApi(
  o: Partial<{
    configured: boolean;
    session: SessionResult | Error;
    exchange: ExchangeResult | Error;
    logoutFails: boolean;
  }> = {},
) {
  const calls: string[] = [];
  const api: AuthApiPort = {
    async getConfig() {
      calls.push('config');
      return {
        authConfigured: o.configured ?? true,
        liffId: (o.configured ?? true) ? LIFF_ID : null,
      };
    },
    async getSession() {
      calls.push('session');
      const s = o.session ?? { state: 'unauthenticated' };
      if (s instanceof Error) throw s;
      return s;
    },
    async exchange(t) {
      calls.push(`exchange:${t}`);
      const r = o.exchange ?? APPROVED;
      if (r instanceof Error) throw r;
      return r;
    },
    async logout() {
      calls.push('logout');
      if (o.logoutFails) throw new ApiNetworkError();
    },
    async lineStatus() {
      throw new Error('not used');
    },
  };
  return { api, calls };
}

function controller(
  liff: LiffPort,
  api: AuthApiPort,
  storage = new MemStorage(),
  clock = { t: NOW },
) {
  const c = new AuthController({
    api,
    loadLiff: async () => liff,
    guard: new LoginGuard(storage, () => clock.t),
    location: { origin: 'https://flow-test.example', pathname: '/today' },
    now: () => clock.t,
  });
  const seen: AuthView['kind'][] = [];
  c.subscribe((v) => seen.push(v.kind));
  return { c, seen, storage, clock };
}

describe('EP01 auth flow', () => {
  it('shows loading, then restores an existing session without a LINE round-trip', async () => {
    const l = fakeLiff();
    const a = fakeApi({ session: APPROVED });
    const { c, seen } = controller(l.liff, a.api);
    assert.equal(c.getView().kind, 'initializing');
    await c.start();
    assert.equal(c.getView().kind, 'approved');
    assert.deepEqual(seen, ['initializing', 'approved']);
    assert.ok(!a.calls.some((x) => x.startsWith('exchange')));
    assert.deepEqual(l.calls, [`init:${LIFF_ID}`]);
  });

  it('initializes LIFF before anything that could change the URL', async () => {
    const l = fakeLiff({ loggedIn: false });
    const { c } = controller(l.liff, fakeApi().api);
    await c.start();
    await c.login();
    assert.equal(l.calls[0], `init:${LIFF_ID}`);
    assert.ok(
      l.calls.indexOf(`init:${LIFF_ID}`) < l.calls.findIndex((x) => x.startsWith('login:')),
    );
  });

  it('reports LIFF initialization failure as LINE unavailable', async () => {
    const { c } = controller(fakeLiff({ initFails: true }).liff, fakeApi().api);
    await c.start();
    assert.deepEqual(c.getView(), { kind: 'unavailable', cause: 'line' });
  });

  it('reports missing server configuration (fail closed)', async () => {
    const { c } = controller(fakeLiff().liff, fakeApi({ configured: false }).api);
    await c.start();
    assert.deepEqual(c.getView(), { kind: 'unavailable', cause: 'config' });
  });

  it('external browser: login required → liff.login with a clean redirect, loop-guarded', async () => {
    const l = fakeLiff({ loggedIn: false });
    const { c } = controller(l.liff, fakeApi().api);
    await c.start();
    assert.deepEqual(c.getView(), { kind: 'login-required' });
    await c.login();
    assert.equal(c.getView().kind, 'authenticating');
    assert.ok(l.calls.includes('login:https://flow-test.example/today'));
    await c.login();
    await c.login();
    assert.deepEqual(c.getView(), { kind: 'unavailable', cause: 'login-loop' });
    assert.equal(l.calls.filter((x) => x.startsWith('login:')).length, 2);
  });

  it('logged in: exchanges the ID token once and shows the approved landing', async () => {
    const l = fakeLiff();
    const a = fakeApi();
    const { c, seen } = controller(l.liff, a.api);
    await c.start();
    assert.equal(c.getView().kind, 'approved');
    assert.deepEqual(seen, ['initializing', 'authenticating', 'approved']);
    assert.deepEqual(
      a.calls.filter((x) => x.startsWith('exchange')),
      [`exchange:${TOKEN}`],
    );
  });

  it('never calls liff.login inside the LINE app (automatic login there)', async () => {
    const l = fakeLiff({ inClient: true, exp: Math.floor(NOW / 1000) - 5 });
    const { c } = controller(l.liff, fakeApi().api);
    await c.start();
    assert.deepEqual(c.getView(), { kind: 'expired', inClient: true });
    assert.ok(!l.calls.some((x) => x.startsWith('login:')));
  });

  it('unknown user → in-app access request screen (EP02: no enrollment reference)', async () => {
    const n = limited('new');
    const { c } = controller(fakeLiff().liff, fakeApi({ exchange: n }).api);
    await c.start();
    assert.deepEqual(c.getView(), { kind: 'account', account: 'new', user: n.user });
    assert.ok(!JSON.stringify(c.getView()).includes('enrollment'));
  });

  it('EP02 account states map to their own screens (pending, rejected, suspended)', async () => {
    for (const st of ['pending', 'rejected', 'suspended'] as const) {
      const { c } = controller(fakeLiff().liff, fakeApi({ session: limited(st) }).api);
      await c.start();
      assert.equal(c.getView().kind, 'account', st);
      assert.equal((c.getView() as { account: string }).account, st);
    }
  });

  it('revoked access → denied (from login or from an existing session)', async () => {
    const a = controller(fakeLiff().liff, fakeApi({ exchange: limited('account-revoked') }).api);
    await a.c.start();
    assert.deepEqual(a.c.getView(), { kind: 'denied', reason: 'revoked' });
    const b = controller(fakeLiff().liff, fakeApi({ session: limited('account-revoked') }).api);
    await b.c.start();
    assert.deepEqual(b.c.getView(), { kind: 'denied', reason: 'revoked' });
  });

  it('a session ended by the server (401 revoked) re-checks the account with one LINE exchange', async () => {
    const a = fakeApi({ session: { state: 'revoked' }, exchange: limited('suspended') });
    const { c } = controller(fakeLiff().liff, a.api);
    await c.start();
    assert.equal(a.calls.filter((x) => x.startsWith('exchange')).length, 1);
    assert.equal((c.getView() as { account?: string }).account, 'suspended');
  });

  it('refresh() re-reads the session once (after an access request or invitation)', async () => {
    const a = fakeApi({ exchange: limited('new') });
    const { c } = controller(fakeLiff().liff, a.api);
    await c.start();
    (a.api as { getSession: AuthApiPort['getSession'] }).getSession = async () => PENDING;
    await Promise.all([c.refresh(), c.refresh()]);
    assert.equal((c.getView() as { account?: string }).account, 'pending');
  });

  it('expired session in an external browser → session-expired screen, then login', async () => {
    const l = fakeLiff({ loggedIn: false });
    const { c } = controller(l.liff, fakeApi({ session: { state: 'expired' } }).api);
    await c.start();
    assert.deepEqual(c.getView(), { kind: 'expired', inClient: false });
    await c.login();
    assert.ok(l.calls.some((x) => x.startsWith('login:')));
  });

  it('server says the ID token expired → one guarded re-login in external browsers', async () => {
    const l = fakeLiff();
    const { c } = controller(l.liff, fakeApi({ exchange: { state: 'token-expired' } }).api);
    await c.start();
    assert.ok(l.calls.includes('logout'));
    assert.ok(l.calls.some((x) => x.startsWith('login:')));
  });

  it('network failure → unavailable; retry shows the retry state, then recovers', async () => {
    const api = fakeApi({ session: new ApiNetworkError() });
    const { c, seen, clock } = controller(fakeLiff().liff, api.api);
    await c.start();
    assert.deepEqual(c.getView(), { kind: 'unavailable', cause: 'network' });
    (api.api as { getSession: AuthApiPort['getSession'] }).getSession = async () => APPROVED;
    clock.t += RETRY_COOLDOWN_MS;
    await c.retry();
    assert.equal(c.getView().kind, 'approved');
    assert.ok(seen.includes('retrying'));
  });

  it('logout clears the server session and the external-browser LINE login', async () => {
    const l = fakeLiff();
    const a = fakeApi();
    const { c } = controller(l.liff, a.api);
    await c.start();
    await c.logout();
    assert.deepEqual(c.getView(), { kind: 'logged-out' });
    assert.ok(a.calls.includes('logout'));
    assert.ok(l.calls.includes('logout'));
  });

  it('logout still completes locally if the network fails', async () => {
    const { c } = controller(fakeLiff().liff, fakeApi({ logoutFails: true }).api);
    await c.start();
    await c.logout();
    assert.deepEqual(c.getView(), { kind: 'logged-out' });
  });

  it('never persists the ID token (storage holds only the login-attempt counter)', async () => {
    const l = fakeLiff({ loggedIn: false });
    const { c, storage } = controller(l.liff, fakeApi().api);
    await c.start();
    await c.login();
    const fresh = controller(fakeLiff().liff, fakeApi().api, storage);
    await fresh.c.start();
    assert.ok(storage.writes.length > 0);
    for (const w of storage.writes) {
      assert.ok(!w.includes(TOKEN), 'token written to storage');
      assert.match(w, /^flow\.loginAttempts=\{"count":\d,"firstAt":\d+\}$/);
    }
    assert.ok(
      !JSON.stringify(fresh.c.getView()).includes(TOKEN),
      'token exposed in the view model',
    );
  });
});

describe('FlowApiClient', () => {
  function fetchStub(responses: Record<string, { status: number; body: unknown }>) {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fn = async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const r = responses[`${init?.method ?? 'GET'} ${url}`] ?? { status: 404, body: {} };
      return new Response(JSON.stringify(r.body), {
        status: r.status,
        headers: { 'content-type': 'application/json' },
      });
    };
    return { fn, calls };
  }

  it('sends the ID token only in the POST body and the CSRF token only as a header', async () => {
    const f = fetchStub({
      'POST /api/auth/line': {
        status: 200,
        body: {
          state: 'approved',
          user: APPROVED.user,
          session: { expiresAt: APPROVED.expiresAt },
          csrfToken: 'csrf-123',
        },
      },
      'POST /api/auth/logout': { status: 200, body: { state: 'logged-out' } },
    });
    const client = new FlowApiClient(f.fn);
    assert.equal((await client.exchange(TOKEN)).state, 'approved');
    await client.logout();
    const [ex, out] = f.calls;
    assert.equal(ex?.url, '/api/auth/line');
    assert.ok(!ex?.url.includes(TOKEN));
    assert.equal(JSON.parse(String(ex?.init?.body)).idToken, TOKEN);
    assert.equal(ex?.init?.credentials, 'same-origin');
    assert.equal((out?.init?.headers as Record<string, string>)['x-flow-csrf'], 'csrf-123');
  });

  it('maps server outcomes to flow states', async () => {
    const f = fetchStub({
      'POST /api/auth/line': { status: 401, body: { error: { code: 'ID_TOKEN_EXPIRED' } } },
      'GET /api/auth/session': { status: 401, body: { state: 'expired' } },
    });
    const client = new FlowApiClient(f.fn);
    assert.deepEqual(await client.exchange(TOKEN), { state: 'token-expired' });
    assert.deepEqual(await client.getSession(), { state: 'expired' });
  });

  it('EP02: a 200 login for a non-active account is a signed-in state, not an error', async () => {
    const f = fetchStub({
      'POST /api/auth/line': {
        status: 200,
        body: {
          state: 'revoked',
          user: { ...SIM_USER, status: 'REVOKED' },
          session: { expiresAt: APPROVED.expiresAt },
          csrfToken: 'c',
        },
      },
    });
    const r = await new FlowApiClient(f.fn).exchange(TOKEN);
    assert.equal(
      r.state,
      'account-revoked',
      'an account revocation is distinct from a revoked session',
    );
  });

  it('EP02 /api/v1 requests: CSRF on mutations, Idempotency-Key when given, typed errors, no raw bodies', async () => {
    const f = fetchStub({
      'POST /api/auth/line': {
        status: 200,
        body: {
          state: 'approved',
          user: SIM_USER,
          session: { expiresAt: APPROVED.expiresAt },
          csrfToken: 'csrf-9',
        },
      },
      'GET /api/v1/today': { status: 200, body: { today: [] } },
      'POST /api/v1/appointments': {
        status: 409,
        body: { error: { code: 'VERSION_CONFLICT', message: 'x' } },
      },
    });
    const client = new FlowApiClient(f.fn);
    await client.exchange(TOKEN);
    assert.deepEqual(await client.request('/today'), { today: [] });
    const get = f.calls[1]?.init?.headers as Record<string, string>;
    assert.equal(get['x-flow-csrf'], undefined, 'no CSRF header on GET');
    await assert.rejects(
      client.request('/appointments', { method: 'POST', body: { a: 1 }, idempotencyKey: 'k-1' }),
      (e: unknown) =>
        e instanceof ApiRequestError && e.status === 409 && e.code === 'VERSION_CONFLICT',
    );
    const post = f.calls[2]?.init?.headers as Record<string, string>;
    assert.equal(post['x-flow-csrf'], 'csrf-9');
    assert.equal(post['idempotency-key'], 'k-1');
  });

  it('EP02: a failed write is never queued or replayed (no offline replay)', async () => {
    let n = 0;
    const client = new FlowApiClient(async () => {
      n += 1;
      throw new TypeError('Failed to fetch');
    });
    await assert.rejects(
      client.request('/appointments', { method: 'POST', body: {} }),
      ApiNetworkError,
    );
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(n, 1);
  });

  it('turns fetch failures into network errors', async () => {
    const client = new FlowApiClient(async () => {
      throw new TypeError('Failed to fetch');
    });
    await assert.rejects(client.getConfig(), ApiNetworkError);
  });
});

describe('EP01 findings F01–F04: rate limiting, single flight, retry discipline', () => {
  const count = (calls: string[], prefix: string) =>
    calls.filter((x) => x.startsWith(prefix)).length;

  it('parseRetryAfter honours valid values and rejects invalid ones', () => {
    assert.equal(parseRetryAfter('120', NOW), 120);
    assert.equal(parseRetryAfter(' 7 ', NOW), 7);
    assert.equal(parseRetryAfter('0', NOW), 1);
    assert.equal(parseRetryAfter('999999', NOW), MAX_RETRY_AFTER_SECONDS);
    assert.equal(parseRetryAfter(new Date(NOW + 90_000).toUTCString(), NOW), 90);
    assert.equal(parseRetryAfter(new Date(NOW - 90_000).toUTCString(), NOW), 1);
    for (const bad of [null, undefined, '', 'abc', '-5', '1.5', '12abc'])
      assert.equal(parseRetryAfter(bad, NOW), null, String(bad));
  });

  it('F01: HTTP 429 on login is a dedicated rate-limited state, never "unavailable"', async () => {
    const a = fakeApi({ exchange: { state: 'rate-limited', retryAfterSeconds: 120 } });
    const { c } = controller(fakeLiff().liff, a.api);
    await c.start();
    assert.deepEqual(c.getView(), { kind: 'rate-limited', retryAt: NOW + 120_000 });
  });

  it('F01: HTTP 429 on the session check is also the rate-limited state', async () => {
    const a = fakeApi({ session: new ApiRateLimitedError(30) });
    const { c } = controller(fakeLiff().liff, a.api);
    await c.start();
    assert.deepEqual(c.getView(), { kind: 'rate-limited', retryAt: NOW + 30_000 });
  });

  it('F02: missing or invalid Retry-After falls back to a safe wait', async () => {
    const a = fakeApi({ exchange: { state: 'rate-limited', retryAfterSeconds: null } });
    const { c } = controller(fakeLiff().liff, a.api);
    await c.start();
    assert.deepEqual(c.getView(), {
      kind: 'rate-limited',
      retryAt: NOW + DEFAULT_RETRY_AFTER_SECONDS * 1000,
    });
  });

  it('F02/F03: retry is refused before the permitted time and allowed after it; no auto retry', async () => {
    const a = fakeApi({ exchange: { state: 'rate-limited', retryAfterSeconds: 60 } });
    const { c, clock } = controller(fakeLiff().liff, a.api);
    await c.start();
    const before = a.calls.length;
    clock.t += 59_000;
    await c.retry();
    await c.retry();
    assert.equal(a.calls.length, before, 'no request before Retry-After');
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(a.calls.length, before, 'nothing retries automatically');
    (a.api as { exchange: AuthApiPort['exchange'] }).exchange = async () => APPROVED;
    clock.t += 1_000;
    await c.retry();
    assert.equal(c.getView().kind, 'approved');
  });

  it('F03: rapid retry taps within the cooldown send one request sequence', async () => {
    const a = fakeApi({ exchange: PENDING });
    const { c, clock } = controller(fakeLiff().liff, a.api);
    await c.start();
    assert.equal(count(a.calls, 'exchange'), 1);
    clock.t += RETRY_COOLDOWN_MS;
    await c.retry();
    for (let i = 0; i < 5; i += 1) {
      clock.t += 300;
      await c.retry();
    }
    assert.equal(count(a.calls, 'exchange'), 2, 'taps inside the cooldown are ignored');
    clock.t += RETRY_COOLDOWN_MS;
    await c.retry();
    assert.equal(count(a.calls, 'exchange'), 3);
  });

  it('F04: concurrent start/retry/login calls share one in-flight sequence (single flight)', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const a = fakeApi();
    const slow = a.api.exchange.bind(a.api);
    (a.api as { exchange: AuthApiPort['exchange'] }).exchange = async (t) => {
      await gate;
      return slow(t);
    };
    const { c, clock } = controller(fakeLiff().liff, a.api);
    const p1 = c.start();
    const p2 = c.start();
    clock.t += RETRY_COOLDOWN_MS * 2;
    const p3 = c.retry();
    const p4 = c.login();
    assert.equal(c.isBusy(), true);
    await new Promise((r) => setTimeout(r, 10));
    release();
    await Promise.all([p1, p2, p3, p4]);
    assert.equal(count(a.calls, 'config'), 1);
    assert.equal(count(a.calls, 'session'), 1);
    assert.equal(count(a.calls, 'exchange'), 1);
    assert.equal(c.getView().kind, 'approved');
    assert.equal(c.isBusy(), false);
  });

  it('recovery after owner approval: pending → (cooldown) → retry → approved, no re-enrollment', async () => {
    const a = fakeApi({ exchange: PENDING });
    const { c, clock } = controller(fakeLiff().liff, a.api);
    await c.start();
    assert.equal(c.getView().kind, 'account');
    (a.api as { exchange: AuthApiPort['exchange'] }).exchange = async () => APPROVED;
    clock.t += RETRY_COOLDOWN_MS;
    await c.retry();
    assert.equal(c.getView().kind, 'approved');
  });

  it('application logout inside the LINE app keeps the LINE identity; signing in again is one exchange', async () => {
    const l = fakeLiff({ inClient: true });
    const a = fakeApi();
    const { c } = controller(l.liff, a.api);
    await c.start();
    await c.logout();
    assert.deepEqual(c.getView(), { kind: 'logged-out' });
    assert.ok(!l.calls.includes('logout'), 'LINE itself is not logged out');
    await c.login();
    assert.equal(c.getView().kind, 'approved');
    assert.equal(count(a.calls, 'exchange'), 2);
    assert.ok(!l.calls.some((x) => x.startsWith('login:')), 'no LINE Login redirect needed');
  });
});

describe('FlowApiClient: HTTP 429', () => {
  const res429 = (headers: Record<string, string> = {}) =>
    new Response(JSON.stringify({ error: { code: 'RATE_LIMITED' } }), {
      status: 429,
      headers: { 'content-type': 'application/json', ...headers },
    });

  it('login 429 → rate-limited with the validated Retry-After', async () => {
    const client = new FlowApiClient(
      async () => res429({ 'retry-after': '42' }),
      () => NOW,
    );
    assert.deepEqual(await client.exchange(TOKEN), {
      state: 'rate-limited',
      retryAfterSeconds: 42,
    });
  });

  it('login 429 with an invalid Retry-After → rate-limited with null (caller waits the default)', async () => {
    const client = new FlowApiClient(
      async () => res429({ 'retry-after': 'soon' }),
      () => NOW,
    );
    assert.deepEqual(await client.exchange(TOKEN), {
      state: 'rate-limited',
      retryAfterSeconds: null,
    });
  });

  it('session 429 → ApiRateLimitedError (not a generic server error)', async () => {
    const client = new FlowApiClient(
      async () => res429(),
      () => NOW,
    );
    await assert.rejects(
      client.getSession(),
      (e) => e instanceof ApiRateLimitedError && e.retryAfterSeconds === null,
    );
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createLineIdTokenVerifier, LINE_ISSUER, VERIFY_URL } from '../src/line/id-token.js';
import { createLineMessagingReader, LineApiError } from '../src/line/messaging.js';
import { FAKE_TOKEN, jsonResponse, LOGIN_CHANNEL, mockFetch, OWNER_ID } from './helpers.js';

const NOW = Date.UTC(2026, 10, 26, 4, 0, 0);
const nowS = Math.floor(NOW / 1000);
const goodClaims = {
  iss: LINE_ISSUER,
  sub: OWNER_ID,
  aud: LOGIN_CHANNEL,
  exp: nowS + 600,
  iat: nowS - 10,
  name: 'Owner',
  amr: ['linesso'],
};

function verifierWith(handler: Parameters<typeof mockFetch>[0]) {
  const m = mockFetch(handler);
  return {
    v: createLineIdTokenVerifier({ channelId: LOGIN_CHANNEL, fetchImpl: m.fn, now: () => NOW }),
    calls: m.calls,
  };
}

describe('LINE ID token verifier', () => {
  it('accepts a valid token and derives identity only from verified claims', async () => {
    const { v, calls } = verifierWith(() => jsonResponse(200, goodClaims));
    const r = await v.verify(FAKE_TOKEN);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.identity.sub, OWNER_ID);
      assert.equal(r.identity.name, 'Owner');
    }
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, VERIFY_URL);
    const body = new URLSearchParams(String(calls[0]?.init?.body));
    assert.equal(body.get('client_id'), LOGIN_CHANNEL);
    assert.equal(body.get('id_token'), FAKE_TOKEN);
  });

  it('rejects malformed tokens without calling LINE', async () => {
    const { v, calls } = verifierWith(() => jsonResponse(200, goodClaims));
    for (const bad of ['', 'abc', 'a.b', 'a.b.c.d', 'x'.repeat(5000), 'a.b.c<script>']) {
      const r = await v.verify(bad);
      assert.deepEqual(r, { ok: false, reason: 'malformed' });
    }
    assert.equal(calls.length, 0);
  });

  it('maps LINE error descriptions (invalid / expired / audience / issuer)', async () => {
    const cases: [string, string][] = [
      ['Invalid IdToken.', 'invalid'],
      ['IdToken expired.', 'expired'],
      ['Invalid IdToken Audience.', 'wrong-audience'],
      ['Invalid IdToken Issuer.', 'wrong-issuer'],
    ];
    for (const [desc, reason] of cases) {
      const { v } = verifierWith(() =>
        jsonResponse(400, { error: 'invalid_request', error_description: desc }),
      );
      assert.deepEqual(await v.verify(FAKE_TOKEN), { ok: false, reason });
    }
  });

  it('re-checks claims locally: wrong audience, issuer, expired, bad subject', async () => {
    const variants: [Record<string, unknown>, string][] = [
      [{ ...goodClaims, aud: '9999999999' }, 'wrong-audience'],
      [{ ...goodClaims, iss: 'https://evil.example' }, 'wrong-issuer'],
      [{ ...goodClaims, exp: nowS - 1 }, 'expired'],
      [{ ...goodClaims, sub: 'not-a-line-id' }, 'invalid'],
      [{ ...goodClaims, iat: nowS + 3600 }, 'invalid'],
      [{ sub: OWNER_ID }, 'invalid'],
    ];
    for (const [claims, reason] of variants) {
      const { v } = verifierWith(() => jsonResponse(200, claims));
      assert.deepEqual(await v.verify(FAKE_TOKEN), { ok: false, reason });
    }
  });

  it('reports upstream failure for network errors, 5xx and 429', async () => {
    for (const h of [
      () => {
        throw new TypeError('fetch failed');
      },
      () => jsonResponse(503, { message: 'unavailable' }),
      () => jsonResponse(429, { message: 'slow down' }),
      () => new Response('<html>', { status: 502 }),
    ]) {
      const { v } = verifierWith(h);
      assert.deepEqual(await v.verify(FAKE_TOKEN), { ok: false, reason: 'upstream' });
    }
  });
});

const TOKEN = 'T'.repeat(120);

function reader(handler: Parameters<typeof mockFetch>[0], maxRetries = 2) {
  const m = mockFetch(handler);
  const sleeps: number[] = [];
  const r = createLineMessagingReader({
    accessToken: TOKEN,
    fetchImpl: m.fn,
    maxRetries,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { r, calls: m.calls, sleeps };
}

describe('LINE Messaging API adapter (read-only)', () => {
  it('parses bot info, quota and consumption with a bearer token', async () => {
    const { r, calls } = reader((url) => {
      if (url.endsWith('/v2/bot/info'))
        return jsonResponse(200, {
          userId: OWNER_ID,
          basicId: '@000test',
          displayName: 'Sally',
          chatMode: 'bot',
        });
      if (url.endsWith('/quota')) return jsonResponse(200, { type: 'limited', value: 300 });
      return jsonResponse(200, { totalUsage: 12 });
    });
    assert.equal((await r.getBotInfo()).basicId, '@000test');
    assert.deepEqual(await r.getQuota(), { type: 'limited', value: 300 });
    assert.deepEqual(await r.getConsumption(), { totalUsage: 12 });
    assert.equal(new Headers(calls[0]?.init?.headers).get('authorization'), `Bearer ${TOKEN}`);
    assert.ok(calls.every((c) => c.init?.method === 'GET'));
  });

  it('accepts an unlimited quota ("none") without a value', async () => {
    const { r } = reader(() => jsonResponse(200, { type: 'none' }));
    assert.deepEqual(await r.getQuota(), { type: 'none' });
  });

  it('fails fast as not-configured without a token (no network call)', async () => {
    const m = mockFetch(() => jsonResponse(200, {}));
    const r = createLineMessagingReader({ accessToken: null, fetchImpl: m.fn });
    await assert.rejects(
      r.getQuota(),
      (e: unknown) => e instanceof LineApiError && e.kind === 'not-configured',
    );
    assert.equal(m.calls.length, 0);
  });

  it('does not retry 401 / 403', async () => {
    for (const [status, kind] of [
      [401, 'unauthorized'],
      [403, 'forbidden'],
    ] as const) {
      const { r, calls } = reader(() => jsonResponse(status, { message: 'Authentication failed' }));
      await assert.rejects(
        r.getBotInfo(),
        (e: unknown) => e instanceof LineApiError && e.kind === kind,
      );
      assert.equal(calls.length, 1);
    }
  });

  it('retries 429 with Retry-After, bounded by maxRetries', async () => {
    const { r, calls, sleeps } = reader(
      () => jsonResponse(429, { message: 'rate' }, { 'retry-after': '2' }),
      2,
    );
    await assert.rejects(
      r.getQuota(),
      (e: unknown) => e instanceof LineApiError && e.kind === 'rate-limited' && e.attempts === 3,
    );
    assert.equal(calls.length, 3);
    assert.deepEqual(sleeps, [2000, 2000]);
  });

  it('retries 5xx then succeeds', async () => {
    let n = 0;
    const { r, calls } = reader(() =>
      ++n < 3 ? jsonResponse(500, {}) : jsonResponse(200, { totalUsage: 1 }),
    );
    assert.deepEqual(await r.getConsumption(), { totalUsage: 1 });
    assert.equal(calls.length, 3);
  });

  it('maps timeouts and network errors, with exponential capped backoff', async () => {
    const timeout = () => {
      const e = new Error('The operation was aborted due to timeout');
      e.name = 'TimeoutError';
      throw e;
    };
    const { r, sleeps } = reader(timeout, 3);
    await assert.rejects(
      r.getBotInfo(),
      (e: unknown) => e instanceof LineApiError && e.kind === 'timeout',
    );
    assert.deepEqual(sleeps, [300, 600, 1200]);
    const net = reader(() => {
      throw new TypeError('fetch failed');
    }, 0);
    await assert.rejects(
      net.r.getBotInfo(),
      (e: unknown) => e instanceof LineApiError && e.kind === 'network',
    );
  });

  it('rejects unexpected response formats', async () => {
    const { r } = reader(() => jsonResponse(200, { type: 'weird' }));
    await assert.rejects(
      r.getQuota(),
      (e: unknown) => e instanceof LineApiError && e.kind === 'invalid-response',
    );
    const bad = reader(() => new Response('not json', { status: 200 }));
    await assert.rejects(
      bad.r.getQuota(),
      (e: unknown) => e instanceof LineApiError && e.kind === 'invalid-response',
    );
  });

  it('never includes the token in error messages', async () => {
    const { r } = reader(() => jsonResponse(401, { message: `bad token ${TOKEN}` }));
    try {
      await r.getBotInfo();
      assert.fail('expected error');
    } catch (e) {
      assert.ok(e instanceof LineApiError);
      assert.ok(!e.message.includes(TOKEN));
      assert.ok(!JSON.stringify(e).includes(TOKEN));
    }
  });

  it('exposes no message-sending capability', () => {
    const { r } = reader(() => jsonResponse(200, {}));
    assert.deepEqual(Object.keys(r).sort(), ['getBotInfo', 'getConsumption', 'getQuota']);
  });
});

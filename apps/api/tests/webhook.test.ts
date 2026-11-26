import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildApp } from '../src/app.js';
import { lineSignature, WEBHOOK_BODY_LIMIT } from '../src/line/webhook.js';
import {
  BOT_ID,
  CHANNEL_SECRET,
  integration,
  mockFetch,
  jsonResponse,
  testEnv,
  OWNER_ID,
} from './helpers.js';

const GROUP_ID = `C${'e'.repeat(32)}`;

async function makeApp(overrides: Parameters<typeof integration>[0] = {}) {
  const net = mockFetch(() => jsonResponse(200, {}));
  const app = buildApp({
    env: testEnv(integration(overrides)),
    deps: { fetchImpl: net.fn, verifier: null },
  });
  await app.ready();
  return { app, net };
}

function event(type: string, extra: Record<string, unknown> = {}) {
  return {
    type,
    mode: 'active',
    timestamp: 1795665000000,
    webhookEventId: `01J${type.toUpperCase().padEnd(23, 'X')}`.slice(0, 26),
    deliveryContext: { isRedelivery: false },
    source: { type: 'user', userId: OWNER_ID },
    ...extra,
  };
}

function post(
  app: Awaited<ReturnType<typeof makeApp>>['app'],
  body: string,
  sig: string | null = lineSignature(CHANNEL_SECRET, body),
  contentType = 'application/json',
) {
  return app.inject({
    method: 'POST',
    url: '/api/line/webhook',
    headers: { 'content-type': contentType, ...(sig === null ? {} : { 'x-line-signature': sig }) },
    payload: body,
  });
}

describe('LINE webhook security', () => {
  it('accepts the verification request (empty events) with a correct signature', async () => {
    const { app } = await makeApp();
    const res = await post(app, JSON.stringify({ destination: BOT_ID, events: [] }));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { ok: true, received: 0, duplicates: 0 });
    await app.close();
  });

  it('rejects a missing or incorrect signature before any processing', async () => {
    const { app } = await makeApp();
    const body = JSON.stringify({ destination: BOT_ID, events: [event('follow')] });
    const missing = await post(app, body, null);
    assert.equal(missing.statusCode, 401);
    assert.equal(missing.json().error.code, 'SIGNATURE_MISSING');
    const wrongSecret = await post(app, body, lineSignature('f'.repeat(32), body));
    assert.equal(wrongSecret.statusCode, 401);
    assert.equal(wrongSecret.json().error.code, 'SIGNATURE_INVALID');
    assert.equal((await post(app, body, 'not-base64!!')).statusCode, 401);
    await app.close();
  });

  it('verifies the exact raw bytes (re-serialised JSON does not match)', async () => {
    const { app } = await makeApp();
    const raw = '{"destination":"' + BOT_ID + '",  "events":[]}';
    const sigOfReserialised = lineSignature(CHANNEL_SECRET, JSON.stringify(JSON.parse(raw)));
    assert.equal((await post(app, raw, sigOfReserialised)).statusCode, 401);
    assert.equal((await post(app, raw)).statusCode, 200);
    const unicode = JSON.stringify({ destination: BOT_ID, events: [], note: 'นัดหมาย  ' });
    assert.equal((await post(app, unicode)).statusCode, 200);
    await app.close();
  });

  it('rejects malformed payloads (after a valid signature)', async () => {
    const { app } = await makeApp();
    for (const body of [
      '{not json',
      JSON.stringify({ events: [] }),
      JSON.stringify({ destination: 'x', events: [] }),
      JSON.stringify({ destination: BOT_ID, events: 'no' }),
    ]) {
      const res = await post(app, body);
      assert.equal(res.statusCode, 400, body);
      assert.equal(res.json().error.code, 'INVALID_PAYLOAD');
    }
    await app.close();
  });

  it('rejects oversized payloads and non-JSON content types', async () => {
    const { app } = await makeApp();
    const big = JSON.stringify({
      destination: BOT_ID,
      events: [],
      pad: 'x'.repeat(WEBHOOK_BODY_LIMIT),
    });
    assert.equal((await post(app, big)).statusCode, 413);
    const text = 'destination=x';
    assert.equal(
      (await post(app, text, lineSignature(CHANNEL_SECRET, text), 'text/plain')).statusCode,
      415,
    );
    await app.close();
  });

  it('rejects events intended for a different bot destination', async () => {
    const { app } = await makeApp();
    const res = await post(
      app,
      JSON.stringify({ destination: `U${'9'.repeat(32)}`, events: [event('follow')] }),
    );
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().error.code, 'UNEXPECTED_DESTINATION');
    await app.close();
  });

  it('fails closed when not configured or the bot identity is unknown', async () => {
    const noSecret = await makeApp({
      line: { ...integration().line, messagingChannelSecret: null },
    });
    assert.equal(
      (await post(noSecret.app, JSON.stringify({ destination: BOT_ID, events: [] }))).statusCode,
      503,
    );
    await noSecret.app.close();
    const noBot = await makeApp({ line: { ...integration().line, botUserId: null } });
    const res = await post(noBot.app, JSON.stringify({ destination: BOT_ID, events: [] }));
    assert.equal(res.statusCode, 503);
    assert.equal(res.json().error.code, 'DESTINATION_UNRESOLVED');
    await noBot.app.close();
  });
});

describe('LINE webhook events', () => {
  it('handles every supported event type and unknown types without crashing', async () => {
    const { app } = await makeApp();
    const events = [
      event('follow'),
      event('unfollow'),
      event('join', { source: { type: 'group', groupId: GROUP_ID } }),
      event('memberJoined', {
        source: { type: 'group', groupId: GROUP_ID },
        joined: { members: [{ type: 'user', userId: OWNER_ID }] },
      }),
      event('memberLeft', { source: { type: 'group', groupId: GROUP_ID }, left: { members: [] } }),
      event('message', {
        replyToken: 'r',
        message: { type: 'text', id: '1', text: 'นัดหาหมอพรุ่งนี้ 9 โมง' },
      }),
      event('postback', { replyToken: 'r', postback: { data: 'action=ack&id=123' } }),
      event('leave', { source: { type: 'group', groupId: GROUP_ID } }),
      event('somethingNew', { webhookEventId: '01JUNKNOWNEVENTXXXXXXXXXXX' }),
    ];
    const res = await post(app, JSON.stringify({ destination: BOT_ID, events }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().received, 9);
    await app.close();
  });

  it('deduplicates by webhookEventId (redelivery is processed once)', async () => {
    const { app } = await makeApp();
    const e = event('follow');
    const first = await post(app, JSON.stringify({ destination: BOT_ID, events: [e] }));
    const again = await post(
      app,
      JSON.stringify({
        destination: BOT_ID,
        events: [{ ...e, deliveryContext: { isRedelivery: true } }],
      }),
    );
    assert.deepEqual(first.json(), { ok: true, received: 1, duplicates: 0 });
    assert.deepEqual(again.json(), { ok: true, received: 0, duplicates: 1 });
    await app.close();
  });

  it('a group join stays pending-registration (never authorised) and causes no outbound call', async () => {
    const { app, net } = await makeApp();
    const join = event('join', {
      source: { type: 'group', groupId: GROUP_ID },
      replyToken: 'reply-token',
    });
    const msg = event('message', {
      webhookEventId: '01JMSG00000000000000000000',
      replyToken: 'reply-token',
      source: { type: 'group', groupId: GROUP_ID, userId: OWNER_ID },
      message: { type: 'text', text: 'สวัสดี Sally' },
    });
    const res = await post(app, JSON.stringify({ destination: BOT_ID, events: [join, msg] }));
    assert.equal(res.statusCode, 200);
    assert.equal(net.calls.length, 0, 'no LINE API call (no reply, no push) as a side effect');
    await app.close();
  });

  it('records metadata only: message text, postback data and raw IDs never appear in logs', async () => {
    const lines: string[] = [];
    const app = buildApp({
      env: { ...testEnv(), logLevel: 'info' },
      logStream: { write: (m: string) => void lines.push(m) },
      deps: { verifier: null, messaging: null },
    });
    await app.ready();
    const body = JSON.stringify({
      destination: BOT_ID,
      events: [
        event('message', {
          source: { type: 'group', groupId: GROUP_ID, userId: OWNER_ID },
          message: { type: 'text', text: 'SECRET-MEDICAL-NOTE' },
        }),
        event('postback', { postback: { data: 'SECRET-POSTBACK' } }),
      ],
    });
    assert.equal((await post(app, body)).statusCode, 200);
    await app.close();
    const out = lines.join('\n');
    for (const forbidden of ['SECRET-MEDICAL-NOTE', 'SECRET-POSTBACK', GROUP_ID, OWNER_ID])
      assert.ok(!out.includes(forbidden), forbidden);
    assert.ok(out.includes('"type":"message"'));
  });

  it('resolves the bot destination via read-only bot info when not configured explicitly', async () => {
    const net = mockFetch((url) =>
      url.endsWith('/v2/bot/info')
        ? jsonResponse(200, { userId: BOT_ID, basicId: '@000test', displayName: 'Sally' })
        : jsonResponse(404, {}),
    );
    const app = buildApp({
      env: testEnv(
        integration({
          line: { ...integration().line, botUserId: null, channelAccessToken: 'T'.repeat(120) },
        }),
      ),
      deps: { fetchImpl: net.fn, verifier: null },
    });
    await app.ready();
    const body = JSON.stringify({ destination: BOT_ID, events: [] });
    assert.equal((await post(app, body)).statusCode, 200);
    assert.equal((await post(app, body)).statusCode, 200);
    assert.equal(net.calls.length, 1, 'bot info fetched once and cached');
    assert.equal(net.calls[0]?.init?.method, 'GET');
    await app.close();
  });
});

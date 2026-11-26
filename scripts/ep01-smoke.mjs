#!/usr/bin/env node
/**
 * EP01 G09 smoke harness (cross-platform, no dependencies, Node >= 22).
 *
 *   node scripts/ep01-smoke.mjs --self-test
 *   node scripts/ep01-smoke.mjs --phase A [--base http://127.0.0.1:6769] [--wait-ms 20000]
 *   node scripts/ep01-smoke.mjs --phase B   (needs SMOKE_CHANNEL_SECRET, SMOKE_BOT_USER_ID, SMOKE_LIFF_ID)
 *
 * The caller (scripts/ep01-verify.ps1 on Windows) starts the API + gateway with an isolated,
 * synthetic configuration and stops them afterwards. This script only sends HTTP probes:
 *   - every request's headers and body are set explicitly (node:http, no implicit headers);
 *   - every response body is read in full, for 2xx and non-2xx alike, and parsed as JSON;
 *   - assertions check the exact status AND the documented error code / state where one exists;
 *   - bounded timeouts; loopback targets only; never reads files, env files or real credentials;
 *   - log lines contain no request IDs, cookies, secrets or IDs (deterministic output).
 * Exit codes: 0 all passed, 1 assertion failure(s), 2 usage/configuration error, 3 target unreachable.
 */
import { createHmac } from 'node:crypto';
import { createServer, request } from 'node:http';

const TIMEOUT_MS = 5000;
const EVIL = 'https://evil.example';
const FORM = 'application/x-www-form-urlencoded';
const JSON_CT = 'application/json';
const CTP_415 = 'FST_ERR_CTP_INVALID_MEDIA_TYPE'; // Fastify's code for an unsupported media type

// ------------------------------------------------------------------ args
function parseArgs(argv) {
  const out = {
    phase: null,
    base: 'http://127.0.0.1:6769',
    allowed: 'http://127.0.0.1:6767',
    waitMs: 20000,
    selfTest: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--self-test') out.selfTest = true;
    else if (a === '--phase') out.phase = String(argv[++i] ?? '').toUpperCase();
    else if (a === '--base') out.base = String(argv[++i] ?? '');
    else if (a === '--allowed-origin') out.allowed = String(argv[++i] ?? '');
    else if (a === '--wait-ms') out.waitMs = Number(argv[++i]);
    else throw new UsageError(`unknown argument: ${a}`);
  }
  return out;
}
class UsageError extends Error {}

function assertLoopback(base) {
  let u;
  try {
    u = new URL(base);
  } catch {
    throw new UsageError('--base is not a URL');
  }
  if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) {
    throw new UsageError(
      '--base must be a loopback http:// URL (the smoke never targets public hosts)',
    );
  }
  return u;
}

// ------------------------------------------------------------------ HTTP
/**
 * Sends exactly the given headers. A bodyless POST gets `content-length: 0` (what browsers
 * send) unless the probe sets its own. Resolves with the full response body for any status.
 */
export function send(baseUrl, { method, path, headers = {}, body }) {
  return new Promise((resolve) => {
    const h = { ...headers };
    const payload = body === undefined ? undefined : Buffer.from(body, 'utf8');
    const hasLength = Object.keys(h).some((k) => k.toLowerCase() === 'content-length');
    if (!hasLength && (payload !== undefined || method !== 'GET'))
      h['content-length'] = String(payload?.length ?? 0);
    const req = request(
      {
        host: baseUrl.hostname.replace(/^\[|\]$/g, ''),
        port: baseUrl.port,
        method,
        path,
        headers: h,
        agent: false,
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const type = String(res.headers['content-type'] ?? '');
          let json;
          if (type.includes('json')) {
            try {
              json = JSON.parse(text);
            } catch {
              json = undefined;
            }
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json, type });
        });
        res.on('error', (e) =>
          resolve({
            status: -1,
            error: e.code ?? 'response-error',
            headers: {},
            text: '',
            type: '',
          }),
        );
      },
    );
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })));
    req.on('error', (e) =>
      resolve({ status: -1, error: e.code ?? 'request-error', headers: {}, text: '', type: '' }),
    );
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

// ------------------------------------------------------------------ assertions
/** Returns a list of mismatch descriptions (empty = pass). Never includes raw values from secrets. */
export function check(expect, res) {
  const bad = [];
  if (res.status !== expect.status)
    bad.push(`status ${res.status}${res.error ? ` (${res.error})` : ''} != ${expect.status}`);
  if (expect.code !== undefined) {
    const code = res.json?.error?.code;
    if (code !== expect.code)
      bad.push(`error.code ${code === undefined ? '<absent>' : code} != ${expect.code}`);
  }
  if (expect.state !== undefined) {
    const state = res.json?.state;
    if (state !== expect.state)
      bad.push(`state ${state === undefined ? '<absent>' : state} != ${expect.state}`);
  }
  for (const [k, v] of Object.entries(expect.json ?? {})) {
    const actual = res.json?.[k];
    if (actual !== v)
      bad.push(
        `${k} ${actual === undefined ? '<absent>' : JSON.stringify(actual)} != ${JSON.stringify(v)}`,
      );
  }
  if (expect.contentType && !expect.contentType.test(res.type))
    bad.push(`content-type "${res.type}" !~ ${expect.contentType}`);
  if (expect.text !== undefined && res.text !== expect.text) bad.push('body text mismatch');
  if (expect.cookieCleared) {
    const sc = [res.headers['set-cookie'] ?? []].flat().join(';');
    if (!/Max-Age=0/i.test(sc)) bad.push('session cookie not cleared');
  }
  return bad;
}

function describeActual(res) {
  const parts = [String(res.status)];
  if (res.error) parts.push(res.error);
  if (res.json?.error?.code) parts.push(res.json.error.code);
  if (typeof res.json?.state === 'string') parts.push(`state=${res.json.state}`);
  return parts.join(' ');
}
function describeExpect(e) {
  const parts = [String(e.status)];
  if (e.code) parts.push(e.code);
  if (e.state) parts.push(`state=${e.state}`);
  for (const [k, v] of Object.entries(e.json ?? {})) parts.push(`${k}=${JSON.stringify(v)}`);
  if (e.contentType) parts.push(`type~${e.contentType.source}`);
  if (e.text !== undefined) parts.push('text');
  if (e.cookieCleared) parts.push('cookie-cleared');
  return parts.join(' ');
}

async function runProbes(baseUrl, probes, log = console.log) {
  let failed = 0;
  for (const p of probes) {
    const res = await send(baseUrl, p);
    const bad = check(p.expect, res);
    if (bad.length) failed += 1;
    log(
      `${bad.length ? 'BAD ' : 'OK  '} ${p.id.padEnd(4)} ${p.name.padEnd(80)} -> ${describeActual(res)}  [expected ${describeExpect(p.expect)}]`,
    );
    for (const b of bad) log(`          ${b}`);
  }
  log(`RESULT ${probes.length - failed}/${probes.length} passed`);
  return failed;
}

async function waitForHealth(baseUrl, waitMs) {
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    const r = await send(baseUrl, { method: 'GET', path: '/api/health' });
    if (r.status === 200 && r.json?.status === 'ok') return true;
    await new Promise((s) => setTimeout(s, 400));
  }
  return false;
}

// ------------------------------------------------------------------ probes
const sign = (secret, body) => createHmac('sha256', secret).update(body, 'utf8').digest('base64');

/** Exact replica of what Windows PowerShell 5.1 `Invoke-WebRequest -Method POST` (no -ContentType, no -Body) sent. */
const PS51_DEFAULT_POST = { 'content-type': FORM, 'content-length': '0' };

export function phaseA(allowed) {
  const html = /^text\/html/;
  const notFoundText = { status: 404, contentType: /^text\/plain/, text: 'Not found' };
  const closed = { status: 503, code: 'AUTH_NOT_CONFIGURED' };
  return [
    {
      id: 'A01',
      name: 'gateway GET /api/health',
      method: 'GET',
      path: '/api/health',
      expect: { status: 200, json: { status: 'ok' } },
    },
    {
      id: 'A02',
      name: 'gateway GET / (LIFF entry, built SPA)',
      method: 'GET',
      path: '/',
      expect: { status: 200, contentType: html },
    },
    {
      id: 'A03',
      name: 'gateway GET /today (rich-menu deep link)',
      method: 'GET',
      path: '/today',
      expect: { status: 200, contentType: html },
    },
    {
      id: 'A04',
      name: 'gateway blocks /dev/design-showcase',
      method: 'GET',
      path: '/dev/design-showcase',
      expect: notFoundText,
    },
    {
      id: 'A05',
      name: 'gateway blocks /dev/auth-states',
      method: 'GET',
      path: '/dev/auth-states',
      expect: notFoundText,
    },
    { id: 'A06', name: 'gateway blocks /.env', method: 'GET', path: '/.env', expect: notFoundText },
    {
      id: 'A07',
      name: 'gateway blocks /src/main.tsx',
      method: 'GET',
      path: '/src/main.tsx',
      expect: notFoundText,
    },
    {
      id: 'A08',
      name: 'gateway blocks /health (non-allow-listed path)',
      method: 'GET',
      path: '/health',
      expect: notFoundText,
    },
    {
      id: 'A09',
      name: 'gateway blocks unknown /api route',
      method: 'GET',
      path: '/api/admin',
      expect: { status: 404, code: 'NOT_FOUND' },
    },
    {
      id: 'A10',
      name: 'GET /api/auth/config reports not configured',
      method: 'GET',
      path: '/api/auth/config',
      expect: { status: 200, json: { authConfigured: false, liffId: null } },
    },
    {
      id: 'A11',
      name: 'login, foreign origin, JSON body -> origin denied before anything else',
      method: 'POST',
      path: '/api/auth/line',
      headers: { origin: EVIL, 'content-type': JSON_CT },
      body: '{"idToken":"a.b.c"}',
      expect: { status: 403, code: 'ORIGIN_DENIED' },
    },
    {
      id: 'A12',
      name: 'logout, foreign origin, PS 5.1 default request replica (original G09 probe)',
      method: 'POST',
      path: '/api/auth/logout',
      headers: { origin: EVIL, ...PS51_DEFAULT_POST },
      expect: { status: 403, code: 'ORIGIN_DENIED' },
    },
    {
      id: 'A13',
      name: 'logout, foreign origin, JSON {} (valid format)',
      method: 'POST',
      path: '/api/auth/logout',
      headers: { origin: EVIL, 'content-type': JSON_CT },
      body: '{}',
      expect: { status: 403, code: 'ORIGIN_DENIED' },
    },
    {
      id: 'A14',
      name: 'logout, allowed origin, documented format (no body) -> fail closed',
      method: 'POST',
      path: '/api/auth/logout',
      headers: { origin: allowed },
      expect: closed,
    },
    {
      id: 'A14b',
      name: 'logout, allowed origin, documented format (JSON {}) -> fail closed',
      method: 'POST',
      path: '/api/auth/logout',
      headers: { origin: allowed, 'content-type': JSON_CT },
      body: '{}',
      expect: closed,
    },
    {
      id: 'A14c',
      name: 'logout, allowed origin, PS 5.1 default replica -> unsupported media type',
      method: 'POST',
      path: '/api/auth/logout',
      headers: { origin: allowed, ...PS51_DEFAULT_POST },
      expect: { status: 415, code: CTP_415 },
    },
    {
      id: 'A15',
      name: 'GET /api/auth/session -> fail closed',
      method: 'GET',
      path: '/api/auth/session',
      expect: closed,
    },
    {
      id: 'A16',
      name: 'webhook without signature -> fail closed',
      method: 'POST',
      path: '/api/line/webhook',
      headers: { 'content-type': JSON_CT },
      body: '{"destination":"x","events":[]}',
      expect: { status: 503, code: 'WEBHOOK_NOT_CONFIGURED' },
    },
    {
      id: 'A17',
      name: 'GET /api/line/status -> fail closed',
      method: 'GET',
      path: '/api/line/status',
      expect: closed,
    },
  ];
}

export function phaseB(allowed, { channelSecret, botUserId, liffId }) {
  const json = (origin) => ({ ...(origin ? { origin } : {}), 'content-type': JSON_CT });
  const empty = JSON.stringify({ destination: botUserId, events: [] });
  const wrongDest = JSON.stringify({ destination: `U${'0'.repeat(32)}`, events: [] });
  return [
    {
      id: 'B01',
      name: 'GET /api/auth/config reports configured (synthetic LIFF ID)',
      method: 'GET',
      path: '/api/auth/config',
      expect: { status: 200, json: { authConfigured: true, liffId } },
    },
    {
      id: 'B02',
      name: 'login, foreign origin, JSON body',
      method: 'POST',
      path: '/api/auth/line',
      headers: json(EVIL),
      body: '{"idToken":"a.b.c"}',
      expect: { status: 403, code: 'ORIGIN_DENIED' },
    },
    {
      id: 'B03',
      name: 'login, no Origin header',
      method: 'POST',
      path: '/api/auth/line',
      headers: json(),
      body: '{"idToken":"a.b.c"}',
      expect: { status: 403, code: 'ORIGIN_DENIED' },
    },
    {
      id: 'B04',
      name: 'login, allowed origin, malformed token (rejected locally, no LINE call)',
      method: 'POST',
      path: '/api/auth/line',
      headers: json(allowed),
      body: '{"idToken":"not-a-jwt"}',
      expect: { status: 401, code: 'ID_TOKEN_INVALID' },
    },
    {
      id: 'B05',
      name: 'login, allowed origin, extra field rejected',
      method: 'POST',
      path: '/api/auth/line',
      headers: json(allowed),
      body: '{"idToken":"a.b.c","role":"owner"}',
      expect: { status: 400, code: 'VALIDATION_ERROR' },
    },
    {
      id: 'B06',
      name: 'login, allowed origin, unsupported media type',
      method: 'POST',
      path: '/api/auth/line',
      headers: { origin: allowed, 'content-type': FORM },
      body: 'idToken=a.b.c',
      expect: { status: 415, code: CTP_415 },
    },
    {
      id: 'B07',
      name: 'GET /api/auth/session without cookie',
      method: 'GET',
      path: '/api/auth/session',
      expect: { status: 401, state: 'unauthenticated' },
    },
    {
      id: 'B08',
      name: 'logout, foreign origin, PS 5.1 default request replica (original G09 probe)',
      method: 'POST',
      path: '/api/auth/logout',
      headers: { origin: EVIL, ...PS51_DEFAULT_POST },
      expect: { status: 403, code: 'ORIGIN_DENIED' },
    },
    {
      id: 'B09',
      name: 'logout, foreign origin, JSON {} (valid format)',
      method: 'POST',
      path: '/api/auth/logout',
      headers: json(EVIL),
      body: '{}',
      expect: { status: 403, code: 'ORIGIN_DENIED' },
    },
    {
      id: 'B10',
      name: 'logout, no Origin header, JSON {}',
      method: 'POST',
      path: '/api/auth/logout',
      headers: json(),
      body: '{}',
      expect: { status: 403, code: 'ORIGIN_DENIED' },
    },
    {
      id: 'B11',
      name: 'logout, allowed origin, unsupported media type (PS 5.1 default replica)',
      method: 'POST',
      path: '/api/auth/logout',
      headers: { origin: allowed, ...PS51_DEFAULT_POST },
      expect: { status: 415, code: CTP_415 },
    },
    {
      id: 'B12',
      name: 'logout, allowed origin, data in body rejected',
      method: 'POST',
      path: '/api/auth/logout',
      headers: json(allowed),
      body: '{"all":true}',
      expect: { status: 400, code: 'VALIDATION_ERROR' },
    },
    {
      id: 'B13',
      name: 'logout, allowed origin, no session, JSON {} (idempotent)',
      method: 'POST',
      path: '/api/auth/logout',
      headers: json(allowed),
      body: '{}',
      expect: { status: 200, state: 'logged-out', cookieCleared: true },
    },
    {
      id: 'B13b',
      name: 'logout, allowed origin, no session, no body (SPA format)',
      method: 'POST',
      path: '/api/auth/logout',
      headers: { origin: allowed },
      expect: { status: 200, state: 'logged-out', cookieCleared: true },
    },
    {
      id: 'B14',
      name: 'GET /api/line/status without session',
      method: 'GET',
      path: '/api/line/status',
      expect: { status: 401, state: 'unauthenticated' },
    },
    {
      id: 'B15',
      name: 'webhook without signature',
      method: 'POST',
      path: '/api/line/webhook',
      headers: json(),
      body: empty,
      expect: { status: 401, code: 'SIGNATURE_MISSING' },
    },
    {
      id: 'B16',
      name: 'webhook with invalid signature',
      method: 'POST',
      path: '/api/line/webhook',
      headers: { ...json(), 'x-line-signature': sign('not-the-channel-secret', empty) },
      body: empty,
      expect: { status: 401, code: 'SIGNATURE_INVALID' },
    },
    {
      id: 'B17',
      name: 'webhook, valid signature, unexpected destination',
      method: 'POST',
      path: '/api/line/webhook',
      headers: { ...json(), 'x-line-signature': sign(channelSecret, wrongDest) },
      body: wrongDest,
      expect: { status: 403, code: 'UNEXPECTED_DESTINATION' },
    },
    {
      id: 'B18',
      name: 'webhook, valid signature, verification request (empty events)',
      method: 'POST',
      path: '/api/line/webhook',
      headers: { ...json(), 'x-line-signature': sign(channelSecret, empty) },
      body: empty,
      expect: { status: 200, json: { ok: true, received: 0 } },
    },
    {
      id: 'B19',
      name: 'webhook, unsupported media type',
      method: 'POST',
      path: '/api/line/webhook',
      headers: { 'content-type': FORM, 'x-line-signature': 'AAAA' },
      body: 'a=b',
      expect: { status: 415, code: CTP_415 },
    },
  ];
}

// ------------------------------------------------------------------ self-test
/**
 * Proves the harness reads and validates error bodies: a local server answers with error
 * bodies sent both with Content-Length and chunked; correct expectations must pass and
 * deliberately wrong ones (code, state, status) must fail.
 */
async function selfTest() {
  const server = createServer((req, res) => {
    const body = JSON.stringify({ error: { code: 'ORIGIN_DENIED', message: 'x', requestId: 'r' } });
    if (req.url === '/fixed') {
      res.writeHead(403, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(body),
      });
      res.end(body);
    } else if (req.url === '/chunked') {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.write(body.slice(0, 10));
      res.end(body.slice(10));
    } else if (req.url === '/state') {
      res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' });
      res.end('{"state":"unauthenticated"}');
    } else if (req.url === '/echo') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          ct: req.headers['content-type'] ?? null,
          cl: req.headers['content-length'] ?? null,
          te: req.headers['transfer-encoding'] ?? null,
        }),
      );
    } else {
      res.writeHead(500);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = new URL(`http://127.0.0.1:${server.address().port}`);
  const cases = [
    [
      'error body with Content-Length is read',
      { method: 'GET', path: '/fixed' },
      { status: 403, code: 'ORIGIN_DENIED' },
      true,
    ],
    [
      'error body sent chunked is read',
      { method: 'GET', path: '/chunked' },
      { status: 401, code: 'ORIGIN_DENIED' },
      true,
    ],
    [
      'error state is read',
      { method: 'GET', path: '/state' },
      { status: 401, state: 'unauthenticated' },
      true,
    ],
    [
      'wrong error code is detected',
      { method: 'GET', path: '/fixed' },
      { status: 403, code: 'CSRF_INVALID' },
      false,
    ],
    [
      'wrong status is detected',
      { method: 'GET', path: '/fixed' },
      { status: 503, code: 'ORIGIN_DENIED' },
      false,
    ],
    [
      'wrong state is detected',
      { method: 'GET', path: '/state' },
      { status: 401, state: 'expired' },
      false,
    ],
    [
      'missing code is detected',
      { method: 'GET', path: '/state' },
      { status: 401, code: 'ORIGIN_DENIED' },
      false,
    ],
  ];
  let failed = 0;
  for (const [name, req, expect, shouldPass] of cases) {
    const passed = check(expect, await send(base, req)).length === 0;
    const ok = passed === shouldPass;
    if (!ok) failed += 1;
    console.log(`${ok ? 'OK  ' : 'BAD '} self-test: ${name}`);
  }
  // Request construction: the PS 5.1 replica and the bodyless SPA-format POST are sent exactly as declared.
  const ps = (await send(base, { method: 'POST', path: '/echo', headers: PS51_DEFAULT_POST })).json;
  const ps0 = ps?.ct === FORM && ps?.cl === '0' && ps?.te === null;
  console.log(
    `${ps0 ? 'OK  ' : 'BAD '} self-test: PS 5.1 replica sends Content-Type form + Content-Length 0, no body`,
  );
  const spa = (await send(base, { method: 'POST', path: '/echo', headers: { origin: 'http://x' } }))
    .json;
  const spa0 = spa?.ct === null && spa?.cl === '0' && spa?.te === null;
  console.log(
    `${spa0 ? 'OK  ' : 'BAD '} self-test: bodyless POST sends no Content-Type and Content-Length 0`,
  );
  if (!ps0) failed += 1;
  if (!spa0) failed += 1;
  await new Promise((r) => server.close(r));
  console.log(`RESULT ${cases.length + 2 - failed}/${cases.length + 2} passed`);
  return failed;
}

// ------------------------------------------------------------------ main
async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
    if (args.selfTest) return (await selfTest()) === 0 ? 0 : 1;
    if (args.phase !== 'A' && args.phase !== 'B')
      throw new UsageError('--phase A|B or --self-test is required');
    const baseUrl = assertLoopback(args.base);
    let probes;
    if (args.phase === 'A') probes = phaseA(args.allowed);
    else {
      const channelSecret = process.env.SMOKE_CHANNEL_SECRET ?? '';
      const botUserId = process.env.SMOKE_BOT_USER_ID ?? '';
      const liffId = process.env.SMOKE_LIFF_ID ?? '';
      if (
        !/^[0-9a-f]{32}$/.test(channelSecret) ||
        !/^U[0-9a-f]{32}$/.test(botUserId) ||
        !/^\d{10}-[A-Za-z0-9]{8}$/.test(liffId)
      ) {
        throw new UsageError(
          'phase B needs synthetic SMOKE_CHANNEL_SECRET, SMOKE_BOT_USER_ID and SMOKE_LIFF_ID',
        );
      }
      probes = phaseB(args.allowed, { channelSecret, botUserId, liffId });
    }
    if (!(await waitForHealth(baseUrl, Number.isFinite(args.waitMs) ? args.waitMs : 20000))) {
      console.log('BAD  target did not become healthy (API/gateway not running?)');
      return 3;
    }
    console.log(`=== Phase ${args.phase}: ${probes.length} probes against ${baseUrl.origin} ===`);
    return (await runProbes(baseUrl, probes)) === 0 ? 0 : 1;
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`usage error: ${e.message}`);
      return 2;
    }
    throw e;
  }
}

process.exitCode = await main();

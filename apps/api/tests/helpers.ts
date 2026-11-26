import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppEnv, IntegrationConfig } from '../src/env.js';

/** Synthetic identifiers only — never real LINE IDs. */
export const OWNER_ID = `U${'a'.repeat(32)}`;
export const TESTER_ID = `U${'b'.repeat(32)}`;
export const STRANGER_ID = `U${'c'.repeat(32)}`;
export const BOT_ID = `U${'d'.repeat(32)}`;
export const CHANNEL_SECRET = '0123456789abcdef'.repeat(2); // synthetic
export const LOGIN_CHANNEL = '1000000001';
export const ORIGIN = 'https://flow-test.example';
export const FAKE_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl';

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'flow-ep01-'));
}

export function integration(overrides: Partial<IntegrationConfig> = {}): IntegrationConfig {
  return {
    publicBaseUrl: ORIGIN,
    line: {
      loginChannelId: LOGIN_CHANNEL,
      messagingChannelId: '1000000002',
      liffId: `${LOGIN_CHANNEL}-AbCdEfGh`,
      messagingChannelSecret: CHANNEL_SECRET,
      channelAccessToken: null,
      botUserId: BOT_ID,
    },
    sessionSecret: 'x'.repeat(48),
    allowedLineUserIds: [],
    secretDir: null,
    sessionAbsoluteMinutes: 480,
    sessionIdleMinutes: 120,
    ...overrides,
  };
}

export function testEnv(i: IntegrationConfig | undefined = integration()): AppEnv {
  return {
    nodeEnv: 'test',
    host: '127.0.0.1',
    port: 0,
    logLevel: 'silent',
    corsOrigins: ['http://127.0.0.1:6767', ORIGIN],
    ...(i ? { integration: i } : {}),
  };
}

export function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

export function mockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
) {
  const calls: FetchCall[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { fn, calls };
}

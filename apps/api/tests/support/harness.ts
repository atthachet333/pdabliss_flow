/**
 * Test harness shared by the MemoryStore suites (tests/) and the MariaDB suites (tests-db/).
 * Identities are synthetic: token "tok:<lineUserId>:<name>" verifies as that LINE user.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp, type BuildAppOptions } from '../../src/app.js';
import {
  ensureMember,
  ensurePersonalWorkspace,
  ensurePrivateDestination,
} from '../../src/domain/identity.js';
import type { IdTokenResult, IdTokenVerifier } from '../../src/line/id-token.js';
import { MemoryStore } from '../../src/store/memory.js';
import type {
  GlobalRole,
  Store,
  UserRow,
  UserStatus,
  WorkspaceKind,
  WorkspaceRole,
  WorkspaceRow,
} from '../../src/store/types.js';
import { integration, ORIGIN, testEnv } from '../helpers.js';

export const lineId = (n: number) => `U${n.toString(16).padStart(32, '0')}`;
export const groupId = (n: number) => `C${n.toString(16).padStart(32, '0')}`;
export const tokenFor = (line: string, name = 'ผู้ใช้จำลอง') => `tok:${line}:${name}`;

export const fakeVerifier: IdTokenVerifier = {
  async verify(token: string): Promise<IdTokenResult> {
    const m = /^tok:(U[0-9a-f]{32}):(.*)$/s.exec(token);
    if (token === 'tok:expired') return { ok: false, reason: 'expired' };
    if (token === 'tok:upstream') return { ok: false, reason: 'upstream' };
    if (token === 'tok:audience') return { ok: false, reason: 'wrong-audience' };
    if (token === 'tok:malformed') return { ok: false, reason: 'malformed' };
    if (!m) return { ok: false, reason: 'invalid' };
    return {
      ok: true,
      identity: { sub: m[1] as string, name: m[2] as string, exp: 0, iat: 0, amr: [] },
    };
  },
};

export interface Harness {
  app: FastifyInstance;
  store: Store;
  clock: { t: number };
  client: () => Client;
  /** Rebuilds the API on the same store (restart persistence). */
  restart: () => Promise<void>;
  close: () => Promise<void>;
}

export async function createHarness(
  opts: {
    store?: Store;
    loginLimit?: number;
    apiLimit?: number;
    start?: number;
    publicBaseUrl?: string;
    logStream?: BuildAppOptions['logStream'];
  } = {},
): Promise<Harness> {
  const store = opts.store ?? new MemoryStore();
  const clock = { t: opts.start ?? Date.UTC(2026, 10, 26, 1, 0, 0) }; // 08:00 Bangkok
  const make = async () => {
    const app = buildApp({
      env: {
        ...testEnv(integration(opts.publicBaseUrl ? { publicBaseUrl: opts.publicBaseUrl } : {})),
        ...(opts.logStream ? { logLevel: 'error' } : {}),
      },
      store,
      ...(opts.logStream ? { logStream: opts.logStream } : {}),
      deps: {
        verifier: fakeVerifier,
        messaging: null,
        now: () => clock.t,
        loginLimit: { limit: opts.loginLimit ?? 1000, windowMs: 300_000 },
        apiLimit: { limit: opts.apiLimit ?? 100_000, windowMs: 60_000 },
      },
    });
    await app.ready();
    return app;
  };
  const h: Harness = {
    app: await make(),
    store,
    clock,
    client: () => new Client(() => h.app),
    restart: async () => {
      await h.app.close();
      h.app = await make();
    },
    close: async () => {
      await h.app.close();
    },
  };
  return h;
}

export class Client {
  cookie: string | null = null;
  csrf: string | null = null;
  origin: string | null = ORIGIN;
  constructor(private readonly app: () => FastifyInstance) {}

  private headers(extra: Record<string, string> = {}, json = false) {
    return {
      ...(this.cookie ? { cookie: this.cookie } : {}),
      ...(this.origin ? { origin: this.origin } : {}),
      ...(this.csrf ? { 'x-flow-csrf': this.csrf } : {}),
      ...(json ? { 'content-type': 'application/json' } : {}),
      ...extra,
    };
  }

  async login(token: string): Promise<LightMyRequestResponse> {
    const res = await this.app().inject({
      method: 'POST',
      url: '/api/auth/line',
      headers: this.headers({}, true),
      payload: { idToken: token },
    });
    const raw = res.headers['set-cookie'];
    const first = Array.isArray(raw) ? raw[0] : raw;
    if (typeof first === 'string' && !/Max-Age=0/.test(first))
      this.cookie = first.split(';')[0] as string;
    if (res.statusCode === 200) this.csrf = res.json().csrfToken as string;
    return res;
  }

  get(url: string, headers: Record<string, string> = {}) {
    return this.app().inject({ method: 'GET', url, headers: this.headers(headers) });
  }
  send(
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    return this.app().inject({
      method,
      url,
      headers: this.headers(headers, body !== undefined),
      ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
    });
  }
  post(url: string, body?: unknown, headers: Record<string, string> = {}) {
    return this.send('POST', url, body, headers);
  }
  put(url: string, body?: unknown) {
    return this.send('PUT', url, body);
  }
  patch(url: string, body?: unknown) {
    return this.send('PATCH', url, body);
  }
  del(url: string) {
    return this.send('DELETE', url);
  }
}

/** Seeds a user with a LINE identity directly in the store (no HTTP). */
export async function seedUser(
  store: Store,
  n: number,
  opts: { name?: string; status?: UserStatus; globalRole?: GlobalRole; now?: Date } = {},
): Promise<UserRow & { line: string; token: string }> {
  const now = opts.now ?? new Date(Date.UTC(2026, 10, 1));
  const line = lineId(n);
  const name = opts.name ?? `ผู้ใช้ ${n}`;
  const user: UserRow = {
    id: randomUUID(),
    displayName: name,
    status: opts.status ?? 'ACTIVE',
    globalRole: opts.globalRole ?? 'USER',
    authzVersion: 1,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
    statusChangedAt: now,
  };
  await store.createUserWithIdentity(user, {
    id: randomUUID(),
    userId: user.id,
    lineUserId: line,
    loginChannelId: '1000000001',
    createdAt: now,
    lastVerifiedAt: now,
  });
  if (user.status === 'ACTIVE') {
    await ensurePersonalWorkspace(store, user, now);
    await ensurePrivateDestination(store, user.id, now);
  }
  return { ...user, line, token: tokenFor(line, name) };
}

export async function seedWorkspace(
  store: Store,
  name: string,
  kind: Exclude<WorkspaceKind, 'PERSONAL'>,
  members: { userId: string; role: WorkspaceRole }[],
): Promise<WorkspaceRow> {
  const now = new Date(Date.UTC(2026, 10, 1));
  const ws: WorkspaceRow = {
    id: randomUUID(),
    name,
    kind,
    status: 'ACTIVE',
    personalOwnerId: null,
    createdByUserId: members[0]?.userId as string,
    version: 1,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
  await store.createWorkspace(ws);
  for (const m of members) await ensureMember(store, ws.id, m.userId, m.role, null, now);
  return ws;
}

export async function seedGroup(
  store: Store,
  n: number,
  workspaceId: string | null,
  status: 'PENDING' | 'ACTIVE' = 'ACTIVE',
  audienceSize: number | null = 5,
) {
  const now = new Date(Date.UTC(2026, 10, 1));
  const row = {
    id: randomUUID(),
    kind: 'GROUP' as const,
    lineTargetId: groupId(n),
    label: `กลุ่มจำลอง ${n}`,
    status,
    workspaceId,
    userId: null,
    audienceSize,
    createdAt: now,
    updatedAt: now,
    lastEventAt: null,
  };
  await store.createDestination(row);
  return row;
}

/** A valid appointment payload (10:00 Bangkok on the given date, reminders 06:00 + 1 h). */
export function appointmentPayload(workspaceId: string, overrides: Record<string, unknown> = {}) {
  return {
    workspaceId,
    title: 'นัดหมายจำลอง',
    category: 'business',
    allDay: false,
    date: '2026-12-10',
    startTime: '10:00',
    endTime: '11:00',
    timeZone: 'Asia/Bangkok',
    visibility: 'PRIVATE',
    sharedWithUserIds: [],
    destinations: [],
    reminders: [
      { kind: 'CALENDAR', dayOffset: 0, localTime: '06:00', enabled: true },
      { kind: 'RELATIVE', offsetMinutes: 60, enabled: true },
    ],
    ...overrides,
  };
}

export const idem = () => ({ 'idempotency-key': randomUUID() });

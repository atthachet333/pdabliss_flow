/**
 * E14 — the database is down. The API answers 503 DATABASE_UNAVAILABLE (with Retry-After),
 * returns no data, does not echo driver messages, and never falls back to an in-memory store
 * (there is no fallback path: the server either verifies MariaDB at start-up or refuses to start).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { databaseFailureCode } from '../src/app.js';
import type { Store } from '../src/store/types.js';
import { MemoryStore } from '../src/store/memory.js';
import {
  appointmentPayload,
  createHarness,
  idem,
  lineId,
  seedUser,
  tokenFor,
} from './support/harness.js';

const SECRET = 'นัดตรวจลับ-quoted-by-driver';

/** A store whose every call fails the way Prisma does when MariaDB is unreachable. */
function downStore(): Store {
  return new Proxy({} as Store, {
    get(_t, prop) {
      if (prop === 'then') return undefined;
      return async () => {
        const e = new Error(
          `Can't reach database server at 127.0.0.1:3306 while running "${SECRET}"`,
        );
        e.name = 'PrismaClientInitializationError';
        throw Object.assign(e, { errorCode: 'P1001' });
      };
    },
  });
}

describe('E14: database unavailable', () => {
  it('login and application calls fail with 503 DATABASE_UNAVAILABLE and leak nothing', async () => {
    const h = await createHarness({ store: downStore() });
    const r = await h.client().login(tokenFor(lineId(1)));
    assert.equal(r.statusCode, 503);
    assert.equal(r.json().error.code, 'DATABASE_UNAVAILABLE');
    assert.equal(r.headers['retry-after'], '30');
    assert.ok(!r.body.includes(SECRET) && !r.body.includes('3306'));
    assert.equal(r.headers['set-cookie'], undefined, 'no session is issued');
    await h.close();
  });

  it('an existing session cannot read anything while the database is down', async (t) => {
    const live = new MemoryStore();
    const u = await seedUser(live, 1);
    let failedMethod: keyof Store | undefined;
    const logs: string[] = [];
    const flaky = new Proxy(live, {
      get(target, prop, recv) {
        const v = Reflect.get(target, prop, recv) as unknown;
        if (typeof v !== 'function') return v;
        return (...args: unknown[]) => {
          if (prop === failedMethod) {
            return Promise.reject(
              Object.assign(new Error(SECRET), {
                name: 'PrismaClientKnownRequestError',
                code: 'P1017',
              }),
            );
          }
          return (v as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
    const h = await createHarness({
      store: flaky,
      logStream: { write: (line) => logs.push(line) },
    });
    t.after(() => h.close());
    const c = h.client();
    assert.equal((await c.login(u.token)).statusCode, 200);
    const personal = (await c.get('/api/v1/me')).json().workspaces[0].id as string;
    for (const method of ['hitRateLimit', 'getSessionByKeyHash', 'getUser'] as const) {
      failedMethod = method;
      for (const url of ['/api/v1/me', '/api/v1/today', '/api/auth/session']) {
        const r = await c.get(url);
        assert.equal(r.statusCode, 503, `${method} ${url}`);
        assert.deepEqual(Object.keys(r.json()), ['error']);
        assert.equal(r.json().error.code, 'DATABASE_UNAVAILABLE');
        assert.equal(r.headers['retry-after'], '30');
        assert.equal(r.headers['set-cookie'], undefined);
        assert.ok(!r.body.includes(SECRET), url);
      }
    }
    const headers = idem();
    const draft = appointmentPayload(personal, { title: SECRET });
    failedMethod = 'transaction';
    const mutation = await c.post('/api/v1/appointments', draft, headers);
    assert.equal(mutation.statusCode, 503);
    assert.equal(mutation.json().error.code, 'DATABASE_UNAVAILABLE');
    assert.equal(mutation.headers['retry-after'], '30');
    assert.ok(!mutation.body.includes(SECRET));
    failedMethod = undefined;
    assert.equal((await c.get('/api/v1/me')).statusCode, 200, 'recovers when the database is back');
    assert.equal((await c.get('/api/auth/session')).json().state, 'approved');
    const created = await c.post('/api/v1/appointments', draft, headers);
    assert.equal(created.statusCode, 201, 'the failed transaction did not save the appointment');
    assert.equal(logs.length, 10);
    for (const line of logs) {
      const entry = JSON.parse(line) as Record<string, unknown>;
      assert.equal(entry.msg, 'Database unavailable');
      assert.equal(entry.code, 'P1017');
      assert.equal(typeof entry.reqId, 'string');
      assert.ok(!line.includes(SECRET) && !('err' in entry));
    }
  });

  it('classifies database failures by class/code only', () => {
    assert.equal(databaseFailureCode({ code: 'ECONNREFUSED' }), 'ECONNREFUSED');
    assert.equal(databaseFailureCode({ errorCode: 'P1001' }), 'P1001');
    assert.equal(databaseFailureCode({ cause: { kind: 'ConnectionClosed' } }), 'ConnectionClosed');
    assert.equal(
      databaseFailureCode({
        code: 'P2039',
        meta: { driverAdapterError: { cause: { kind: 'TooManyConnections' } } },
      }),
      'TooManyConnections',
    );
    for (const code of [
      'P2002',
      'P2003',
      'P2034',
      'P1000',
      'P2028',
      'FST_ERR_CTP_INVALID_MEDIA_TYPE',
    ]) {
      assert.equal(databaseFailureCode({ code }), undefined);
    }
    assert.equal(
      databaseFailureCode({ code: 'P2039', cause: { originalCode: '1020' } }),
      undefined,
    );
  });

  it('an application error stays a sanitized 500', async (t) => {
    const store = new MemoryStore();
    const user = await seedUser(store, 1);
    const logs: string[] = [];
    const h = await createHarness({ store, logStream: { write: (line) => logs.push(line) } });
    t.after(() => h.close());
    const client = h.client();
    assert.equal((await client.login(user.token)).statusCode, 200);
    store.getSessionByKeyHash = async () => {
      throw new TypeError(SECRET);
    };
    const response = await client.get('/api/v1/me');
    assert.equal(response.statusCode, 500);
    assert.equal(response.json().error.code, 'INTERNAL_ERROR');
    assert.equal(response.headers['retry-after'], undefined);
    assert.ok(!response.body.includes(SECRET) && !logs.join('').includes(SECRET));
  });
});

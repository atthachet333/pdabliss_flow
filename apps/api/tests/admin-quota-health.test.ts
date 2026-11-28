import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DestinationService } from '../src/domain/destinations.js';
import { OperationsService } from '../src/domain/operations.js';
import type { Actor } from '../src/domain/policy.js';
import { LineApiError, type LineMessagingReader } from '../src/line/messaging.js';
import { MemoryStore } from '../src/store/memory.js';

const actor = {
  user: { status: 'ACTIVE', globalRole: 'OWNER' },
  memberships: new Map(),
} as unknown as Actor;

function service(reader: LineMessagingReader | null, clock: { t: number }) {
  const store = new MemoryStore();
  const now = () => new Date(clock.t);
  return new OperationsService(
    store,
    now,
    new DestinationService(store, now),
    reader,
    { login: true, messagingRead: !!reader, webhook: false },
    't',
  );
}

describe('ADM08 / ADM09 server refresh semantics', () => {
  it('every quota request is a fresh LINE read; last success advances only on success; failure serves stale values', async () => {
    const clock = { t: Date.parse('2026-11-28T06:00:00Z') };
    let reads = 0;
    let fail = false;
    const reader: LineMessagingReader = {
      getBotInfo: async () => {
        throw new Error('unused');
      },
      getQuota: async () => {
        reads += 1;
        if (fail) throw new LineApiError('upstream', 503, 1);
        return { type: 'limited', value: 300 };
      },
      getConsumption: async () => ({ totalUsage: 7 }),
    };
    const ops = service(reader, clock);
    const a = await ops.quota(actor);
    clock.t += 65_000;
    const b = await ops.quota(actor);
    assert.equal(reads, 2, 'no server-side cache between explicit refreshes');
    assert.equal(a.status, 'available');
    assert.deepEqual([b.used, b.limit, b.remaining], [7, 300, 293]);
    assert.equal(b.lastSuccessAt, '2026-11-28T06:01:05.000Z');
    fail = true;
    clock.t += 30_000;
    const c = await ops.quota(actor);
    assert.equal(reads, 3);
    assert.equal(c.status, 'stale');
    assert.equal(c.used, 7, 'previous valid values preserved');
    assert.equal(c.lastSuccessAt, '2026-11-28T06:01:05.000Z', 'not advanced by a failed read');
    assert.equal(c.checkedAt, '2026-11-28T06:01:35.000Z');
    assert.equal(c.errorKind, 'upstream');
    assert.ok(!JSON.stringify(c).toLowerCase().includes('token'));
  });

  it('a quota that was never read successfully is unavailable, never zero', async () => {
    const reader: LineMessagingReader = {
      getBotInfo: async () => {
        throw new Error('unused');
      },
      getQuota: async () => {
        throw new LineApiError('timeout', null, 3);
      },
      getConsumption: async () => ({ totalUsage: 0 }),
    };
    const q = await service(reader, { t: Date.now() }).quota(actor);
    assert.equal(q.status, 'unavailable');
    assert.equal(q.used, null);
    assert.equal(q.lastSuccessAt, null);
    assert.equal((await service(null, { t: Date.now() }).quota(actor)).status, 'not-configured');
  });

  it('every health request re-checks the database and reports the worker as not running', async () => {
    const clock = { t: Date.parse('2026-11-28T06:00:00Z') };
    const ops = service(null, clock);
    const a = await ops.health(actor);
    clock.t += 41_000;
    const b = await ops.health(actor);
    assert.equal(a.database.status, 'ok');
    assert.equal(b.checkedAt, '2026-11-28T06:00:41.000Z');
    assert.equal(b.worker, 'not-enabled');
    assert.equal(b.notificationEngine, 'not-enabled');
    assert.equal(b.line.outbound, 'disabled');
  });
});

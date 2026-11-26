/** The guard PrismaStore installs on every model operation (src/store/fail-closed.ts). */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertFailClosedWhere,
  findUndefinedFilter,
  UnsafeQueryError,
} from '../src/store/fail-closed.js';

describe('fail-closed query filters', () => {
  it('finds an explicit undefined anywhere in a filter (top level, nested, AND/OR, relations)', () => {
    assert.equal(findUndefinedFilter({ userId: undefined }), 'where.userId');
    assert.equal(
      findUndefinedFilter({ id: 'a', endedAt: null, userId: undefined }),
      'where.userId',
    );
    assert.equal(
      findUndefinedFilter({
        AND: [{ workspaceId: { in: ['w'] } }, { OR: [{ createdByUserId: undefined }] }],
      }),
      'where.AND[1].OR[0].createdByUserId',
    );
    assert.equal(
      findUndefinedFilter({ accessGrants: { some: { userId: undefined } } }),
      'where.accessGrants.some.userId',
    );
    assert.equal(findUndefinedFilter({ id: { in: ['a', undefined] } }), 'where.id.in[1]');
  });

  it('accepts real conditions: values, null, empty objects, dates and binary keys', () => {
    assert.equal(findUndefinedFilter({}), null);
    assert.equal(findUndefinedFilter({ endedAt: null, id: 'x' }), null);
    assert.equal(findUndefinedFilter({ windowEnd: { lte: new Date() } }), null);
    assert.equal(findUndefinedFilter({ keyHash: new Uint8Array(32) }), null);
    assert.equal(findUndefinedFilter({ status: { in: [] } }), null);
  });

  it('rejects an operation whose where is undefined or contains undefined; ignores ops without where', () => {
    assert.throws(
      () =>
        assertFailClosedWhere('Session', 'updateMany', { where: { userId: undefined }, data: {} }),
      UnsafeQueryError,
    );
    assert.throws(
      () => assertFailClosedWhere('ReminderRule', 'deleteMany', { where: undefined }),
      UnsafeQueryError,
    );
    assert.doesNotThrow(() => assertFailClosedWhere('AuditLog', 'create', { data: { a: 1 } }));
    assert.doesNotThrow(() => assertFailClosedWhere('WebhookEvent', 'deleteMany', undefined));
    assert.doesNotThrow(() => assertFailClosedWhere('User', 'count', { where: {} }));
    try {
      assertFailClosedWhere('Appointment', 'findMany', {
        where: { AND: [{ createdByUserId: undefined }] },
      });
    } catch (e) {
      assert.match((e as Error).message, /Appointment\.findMany/);
      assert.ok(!(e as Error).message.includes('undefined'.repeat(2)));
    }
  });
});

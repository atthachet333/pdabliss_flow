/** Database guard — runs anywhere (no connection is made). */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertDatabaseTarget, assertDestructiveAllowed, DbGuardError, describeTarget, parseDatabaseUrl } from '../src/db/guard.js';

const U = (host: string, db: string, extra = '') => `mysql://flow_x:s3cr3t-value@${host}:3306/${db}${extra}`;

describe('database guard', () => {
  it('accepts only the exact expected database for each purpose on loopback', () => {
    assert.equal(assertDatabaseTarget(U('127.0.0.1', 'pdabliss_flow_dev'), 'dev-runtime').database, 'pdabliss_flow_dev');
    assert.equal(assertDatabaseTarget(U('localhost', 'pdabliss_flow_dev'), 'dev-migrate').database, 'pdabliss_flow_dev');
    assert.equal(assertDatabaseTarget(U('127.0.0.1', 'pdabliss_flow_test'), 'test').database, 'pdabliss_flow_test');
    assert.equal(assertDatabaseTarget(U('[::1]', 'pdabliss_flow_shadow'), 'shadow').database, 'pdabliss_flow_shadow');
  });

  it('rejects production, unexpected names, remote hosts, cross-purpose use and ambiguous URLs', () => {
    const bad: [string | undefined, Parameters<typeof assertDatabaseTarget>[1]][] = [
      [U('127.0.0.1', 'pdabliss_flow'), 'dev-runtime'],
      [U('127.0.0.1', 'pdabliss_flow'), 'test'],
      [U('127.0.0.1', 'pdabliss_flow_dev'), 'test'],
      [U('127.0.0.1', 'pdabliss_flow_test'), 'dev-runtime'],
      [U('127.0.0.1', 'PDABLISS_FLOW_TEST'), 'test'],
      [U('127.0.0.1', 's2_payroll'), 'dev-runtime'],
      [U('10.0.0.5', 'pdabliss_flow_dev'), 'dev-runtime'],
      [U('db.example.com', 'pdabliss_flow_test'), 'test'],
      [U('127.0.0.1', 'pdabliss_flow_test', '?database=pdabliss_flow'), 'test'],
      ['postgresql://u:p@127.0.0.1:5432/pdabliss_flow_dev', 'dev-runtime'],
      [undefined, 'dev-runtime'],
      ['', 'test'],
      ['not a url', 'test'],
    ];
    for (const [url, purpose] of bad) assert.throws(() => assertDatabaseTarget(url, purpose), DbGuardError, `${url} ${purpose}`);
  });

  it('destructive operations are allowed on the test database only', () => {
    assert.doesNotThrow(() => assertDestructiveAllowed(U('127.0.0.1', 'pdabliss_flow_test')));
    for (const db of ['pdabliss_flow_dev', 'pdabliss_flow', 'pdabliss_flow_shadow'])
      assert.throws(() => assertDestructiveAllowed(U('127.0.0.1', db)), DbGuardError, db);
  });

  it('never reveals credentials in errors or descriptions', () => {
    const t = parseDatabaseUrl(U('127.0.0.1', 'pdabliss_flow_test'));
    assert.ok(!describeTarget(t).includes('s3cr3t-value'));
    try {
      assertDatabaseTarget(U('127.0.0.1', 'pdabliss_flow'), 'test');
    } catch (e) {
      assert.ok(!(e as Error).message.includes('s3cr3t-value'));
    }
  });
});

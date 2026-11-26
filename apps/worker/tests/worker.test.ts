import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { exponentialBackoff } from '../src/contracts.js';
import { describeWorker } from '../src/index.js';

describe('worker scaffold', () => {
  it('reports that the scheduler is disabled in EP00', () => {
    const s = describeWorker();
    assert.equal(s.mode, 'scaffold');
    assert.equal(s.schedulerEnabled, false);
  });

  it('exponential backoff doubles, caps and stops after max attempts', () => {
    const policy = exponentialBackoff(30_000, 600_000, 5);
    const now = new Date('2026-11-26T00:00:00Z');
    const delays = [0, 1, 2, 3, 4].map(
      (a) => (policy.nextAttemptAt(a, now)?.getTime() ?? NaN) - now.getTime(),
    );
    assert.deepEqual(delays, [30_000, 60_000, 120_000, 240_000, 480_000]);
    assert.equal(
      exponentialBackoff(30_000, 100_000, 10).nextAttemptAt(6, now)?.getTime(),
      now.getTime() + 100_000,
    );
    assert.equal(policy.nextAttemptAt(5, now), null);
  });
});

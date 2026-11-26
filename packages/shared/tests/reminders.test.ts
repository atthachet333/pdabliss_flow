import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ALL_DAY_ANCHOR_TIME, MAX_REMINDERS, planReminders } from '../src/reminders.js';

const base = {
  localDate: '2026-11-27',
  localTime: '09:00',
  allDay: false,
  timeZone: 'Asia/Bangkok',
  now: new Date('2026-11-26T02:00:00Z'), // 26 Nov 09:00 Bangkok
};

describe('planReminders', () => {
  it('computes actual fire times before the appointment, sorted earliest first', () => {
    const plan = planReminders({ ...base, offsetsMinutes: [30, 1440, 0] });
    assert.equal(plan.anchor.toISOString(), '2026-11-27T02:00:00.000Z');
    assert.deepEqual(
      plan.scheduled.map((r) => [r.offsetMinutes, r.fireAt.toISOString()]),
      [
        [30, '2026-11-27T01:30:00.000Z'],
        [0, '2026-11-27T02:00:00.000Z'],
      ],
    );
    // 1 day before = exactly "now" → not at least one minute in the future → past
    assert.deepEqual(plan.rejected, [
      { offsetMinutes: 1440, issue: 'past', fireAt: new Date('2026-11-26T02:00:00Z') },
    ]);
  });

  it('collapses duplicates and reports them', () => {
    const plan = planReminders({ ...base, offsetsMinutes: [15, 15, 60] });
    assert.deepEqual(
      plan.scheduled.map((r) => r.offsetMinutes),
      [60, 15],
    );
    assert.deepEqual(
      plan.rejected.map((r) => [r.offsetMinutes, r.issue]),
      [[15, 'duplicate']],
    );
  });

  it('rejects invalid offsets (negative, fractional, beyond 30 days)', () => {
    const plan = planReminders({ ...base, offsetsMinutes: [-5, 2.5, 50_000, 10] });
    assert.deepEqual(
      plan.scheduled.map((r) => r.offsetMinutes),
      [10],
    );
    assert.deepEqual(
      plan.rejected.map((r) => r.issue),
      ['invalid-offset', 'invalid-offset', 'invalid-offset'],
    );
  });

  it(`keeps at most ${MAX_REMINDERS} reminders and marks the rest over-limit`, () => {
    const plan = planReminders({
      ...base,
      localDate: '2026-12-10',
      offsetsMinutes: [0, 5, 10, 15, 30, 60, 120],
    });
    assert.equal(plan.scheduled.length, MAX_REMINDERS);
    assert.deepEqual(
      plan.rejected.map((r) => r.issue),
      ['over-limit', 'over-limit'],
    );
    // the earliest-firing reminders are kept
    assert.deepEqual(
      plan.scheduled.map((r) => r.offsetMinutes),
      [120, 60, 30, 15, 10],
    );
  });

  it(`anchors all-day appointments at ${ALL_DAY_ANCHOR_TIME} local time on the event date`, () => {
    const plan = planReminders({ ...base, allDay: true, localTime: '23:59', offsetsMinutes: [0] });
    assert.equal(plan.anchor.toISOString(), '2026-11-27T01:00:00.000Z');
  });

  it('rejects reminders already in the past', () => {
    const plan = planReminders({
      ...base,
      localDate: '2026-11-26',
      localTime: '09:10',
      offsetsMinutes: [5, 30],
    });
    assert.deepEqual(
      plan.scheduled.map((r) => r.offsetMinutes),
      [5],
    );
    assert.deepEqual(
      plan.rejected.map((r) => [r.offsetMinutes, r.issue]),
      [[30, 'past']],
    );
  });
});

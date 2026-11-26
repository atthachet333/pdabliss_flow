import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  calculateReminders,
  DEFAULT_REMINDER_RULES,
  MAX_REMINDER_RULES,
  reminderLabelTh,
  type ReminderRuleInput,
} from '../src/reminder-rules.js';

const BKK = 'Asia/Bangkok';
const NOW = new Date('2026-11-26T02:00:00Z'); // 26 Nov 09:00 Bangkok
const timed = (localDate: string, localTime: string) => ({ allDay: false, localDate, localTime, timeZone: BKK });
const iso = (d: Date | null) => d?.toISOString() ?? null;
const cal = (dayOffset: number, localTime: string, enabled = true): ReminderRuleInput => ({ kind: 'CALENDAR', dayOffset, localTime, enabled });
const rel = (offsetMinutes: number, enabled = true): ReminderRuleInput => ({ kind: 'RELATIVE', offsetMinutes, enabled });

describe('reminder rules v1 (RELATIVE + CALENDAR)', () => {
  it('owner example: 10:00 appointment → 06:00 same day and 1 h before (09:00)', () => {
    const r = calculateReminders(timed('2026-12-10', '10:00'), DEFAULT_REMINDER_RULES, NOW);
    assert.equal(iso(r.anchor), '2026-12-10T03:00:00.000Z');
    assert.deepEqual(
      r.reminders.map((x) => [x.status, iso(x.fireAt)]),
      [
        ['SCHEDULED', '2026-12-09T23:00:00.000Z'], // 06:00 Bangkok
        ['SCHEDULED', '2026-12-10T02:00:00.000Z'], // 09:00 Bangkok
      ],
    );
    assert.equal(r.valid, true);
  });

  it('owner example: moved to 13:00 → 06:00 stays, relative moves to 12:00', () => {
    const r = calculateReminders(timed('2026-12-10', '13:00'), DEFAULT_REMINDER_RULES, NOW);
    assert.deepEqual(r.reminders.map((x) => iso(x.fireAt)), ['2026-12-09T23:00:00.000Z', '2026-12-10T05:00:00.000Z']);
  });

  it('previous-day CALENDAR rule fires the evening before', () => {
    const r = calculateReminders(timed('2026-12-10', '10:00'), [cal(-1, '18:00')], NOW);
    assert.equal(iso(r.reminders[0]!.fireAt), '2026-12-09T11:00:00.000Z');
    assert.equal(r.reminders[0]!.labelTh, 'วันก่อนนัด 18:00 น.');
  });

  it('all-day appointments anchor RELATIVE rules at 08:00 local; CALENDAR rules use their own time', () => {
    const r = calculateReminders({ allDay: true, localDate: '2026-12-10', localTime: null, timeZone: BKK }, [rel(60), cal(0, '06:00'), cal(0, '20:00')], NOW);
    assert.equal(iso(r.anchor), '2026-12-10T01:00:00.000Z');
    assert.deepEqual(r.reminders.map((x) => iso(x.fireAt)), ['2026-12-10T00:00:00.000Z', '2026-12-09T23:00:00.000Z', '2026-12-10T13:00:00.000Z']);
    assert.ok(r.reminders.every((x) => x.status === 'SCHEDULED'), 'a same-day evening rule is allowed for all-day events');
  });

  it('a CALENDAR time after a timed start is invalid ("after-start")', () => {
    const r = calculateReminders(timed('2026-12-10', '10:00'), [cal(0, '11:00')], NOW);
    assert.equal(r.reminders[0]!.status, 'DISABLED');
    assert.equal(r.reminders[0]!.issue, 'after-start');
    assert.equal(r.valid, false);
  });

  it('reminders within one minute of now or in the past are PAST, never scheduled', () => {
    const r = calculateReminders(timed('2026-11-26', '10:00'), [cal(0, '06:00'), rel(60), rel(30)], NOW);
    assert.deepEqual(r.reminders.map((x) => x.status), ['PAST', 'PAST', 'SCHEDULED']);
    const at = (ms: number) => calculateReminders(timed('2026-11-26', '09:01'), [rel(0)], new Date(NOW.getTime() + ms)).reminders[0]!.status;
    assert.equal(at(0), 'SCHEDULED', 'exactly one minute of lead is enough');
    assert.equal(at(1), 'PAST', 'less than the one-minute lead');
  });

  it('same kind at the same instant is DUPLICATE; other kind at the same instant is flagged sameTimeAs', () => {
    const r = calculateReminders(timed('2026-12-10', '10:00'), [rel(60), rel(60), cal(0, '09:00')], NOW);
    assert.deepEqual(r.reminders.map((x) => x.status), ['SCHEDULED', 'DUPLICATE', 'SCHEDULED']);
    assert.equal(r.reminders[1]!.duplicateOf, 0);
    assert.equal(r.reminders[2]!.sameTimeAs, 0);
  });

  it('disabled rules and cancelled appointments never schedule', () => {
    assert.equal(calculateReminders(timed('2026-12-10', '10:00'), [rel(60, false)], NOW).reminders[0]!.status, 'DISABLED');
    const c = calculateReminders({ ...timed('2026-12-10', '10:00'), cancelled: true }, DEFAULT_REMINDER_RULES, NOW);
    assert.ok(c.reminders.every((x) => x.status === 'CANCELLED'));
  });

  it('validates offsets, day offsets, times and the rule limit', () => {
    const r = calculateReminders(
      timed('2026-12-10', '10:00'),
      [rel(-5), rel(1.5), cal(1, '06:00'), cal(-8, '06:00'), cal(0, '24:00')],
      NOW,
    );
    assert.deepEqual(r.reminders.map((x) => x.issue), ['invalid-offset', 'invalid-offset', 'invalid-day-offset', 'invalid-day-offset', 'invalid-time']);
    const many = calculateReminders(timed('2026-12-10', '10:00'), Array.from({ length: MAX_REMINDER_RULES + 1 }, (_, i) => rel(i * 10)), NOW);
    assert.equal(many.reminders.at(-1)!.issue, 'too-many');
    assert.throws(() => calculateReminders(timed('2026-02-30', '10:00'), [], NOW), RangeError);
    assert.throws(() => calculateReminders(timed('2026-12-10', '25:00'), [], NOW), RangeError);
  });

  it('time-zone boundaries: Bangkok midnight, new year and the previous-day rule across a month/year', () => {
    const ny = calculateReminders(timed('2027-01-01', '00:30'), [cal(-1, '21:00'), rel(60)], NOW);
    assert.deepEqual(ny.reminders.map((x) => iso(x.fireAt)), ['2026-12-31T14:00:00.000Z', '2026-12-31T16:30:00.000Z']);
    const early = calculateReminders(timed('2026-12-01', '06:30'), [cal(0, '06:00'), rel(420)], NOW);
    assert.deepEqual(early.reminders.map((x) => iso(x.fireAt)), ['2026-11-30T23:00:00.000Z', '2026-11-30T16:30:00.000Z']);
  });

  it('leap day: 29 Feb 2028 works, and a previous-day rule on 1 Mar lands on 29 Feb', () => {
    const r = calculateReminders(timed('2028-03-01', '09:00'), [cal(-1, '18:00')], NOW);
    assert.equal(iso(r.reminders[0]!.fireAt), '2028-02-29T11:00:00.000Z');
    const leap = calculateReminders({ allDay: true, localDate: '2028-02-29', localTime: null, timeZone: BKK }, [cal(0, '06:00')], NOW);
    assert.equal(iso(leap.reminders[0]!.fireAt), '2028-02-28T23:00:00.000Z');
    assert.throws(() => calculateReminders(timed('2027-02-29', '09:00'), [], NOW), RangeError);
  });

  it('Thai labels describe each rule clearly', () => {
    assert.equal(reminderLabelTh(cal(0, '06:00')), 'เช้าวันนัด 06:00 น.');
    assert.equal(reminderLabelTh(cal(0, '13:00')), 'วันนัด 13:00 น.');
    assert.equal(reminderLabelTh(cal(-3, '09:00')), 'ก่อนนัด 3 วัน เวลา 09:00 น.');
    assert.equal(reminderLabelTh(rel(0)), 'เมื่อถึงเวลานัด');
    assert.match(reminderLabelTh(rel(60)), /^ก่อนนัด .*1 ชั่วโมง/);
  });

  it('is deterministic and does not mutate its inputs', () => {
    const rules = [cal(0, '06:00'), rel(60)];
    const copy = JSON.parse(JSON.stringify(rules));
    const a = calculateReminders(timed('2026-12-10', '10:00'), rules, NOW);
    const b = calculateReminders(timed('2026-12-10', '10:00'), rules, NOW);
    assert.deepEqual(a, b);
    assert.deepEqual(rules, copy);
  });
});

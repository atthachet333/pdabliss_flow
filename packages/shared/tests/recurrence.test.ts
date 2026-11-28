import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  describeRecurrenceThai,
  expandRecurrence,
  horizonEnd,
  occurrencesBefore,
  recurrenceFinishedAfter,
  recurrenceSchema,
  type RecurrenceRule,
} from '../src/index.js';

const rule = (r: Partial<RecurrenceRule> & Pick<RecurrenceRule, 'frequency'>): RecurrenceRule => ({
  interval: 1,
  monthDay: null,
  missingDay: 'LAST_DAY',
  end: { type: 'NEVER' },
  ...r,
});
const dates = (r: RecurrenceRule, start: string, from: string, to: string, max?: number) =>
  expandRecurrence(r, start, { from, to, ...(max ? { max } : {}) }).map((o) => o.date);

describe('recurrence engine', () => {
  it('daily and weekly keep the start weekday and interval', () => {
    assert.deepEqual(
      dates(rule({ frequency: 'DAILY' }), '2026-12-30', '2026-12-30', '2027-01-02'),
      ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'],
    );
    assert.deepEqual(
      dates(rule({ frequency: 'WEEKLY', interval: 2 }), '2026-12-07', '2026-12-01', '2027-01-31'),
      ['2026-12-07', '2026-12-21', '2027-01-04', '2027-01-18'],
    );
  });

  it('monthly on the 31st uses the last day of shorter months (LAST_DAY) including leap February', () => {
    const r = rule({ frequency: 'MONTHLY', monthDay: 31 });
    assert.deepEqual(dates(r, '2027-12-31', '2027-12-01', '2028-05-31'), [
      '2027-12-31',
      '2028-01-31',
      '2028-02-29',
      '2028-03-31',
      '2028-04-30',
      '2028-05-31',
    ]);
    assert.deepEqual(dates(r, '2026-12-31', '2027-02-01', '2027-02-28'), ['2027-02-28']);
  });

  it('monthly SKIP omits missing days and skipped periods do not count towards COUNT', () => {
    const r = rule({
      frequency: 'MONTHLY',
      monthDay: 31,
      missingDay: 'SKIP',
      end: { type: 'COUNT', count: 3 },
    });
    assert.deepEqual(dates(r, '2027-01-31', '2027-01-01', '2027-12-31'), [
      '2027-01-31',
      '2027-03-31',
      '2027-05-31',
    ]);
  });

  it('monthly on 30 April keeps 30 and LAST always picks the month end', () => {
    assert.deepEqual(
      dates(rule({ frequency: 'MONTHLY' }), '2027-04-30', '2027-04-01', '2027-07-31'),
      ['2027-04-30', '2027-05-30', '2027-06-30', '2027-07-30'],
    );
    assert.deepEqual(
      dates(
        rule({ frequency: 'MONTHLY', monthDay: 'LAST' }),
        '2027-01-15',
        '2027-01-01',
        '2027-04-30',
      ),
      ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30'],
    );
  });

  it('a monthly day before the start date begins next month', () => {
    assert.deepEqual(
      dates(rule({ frequency: 'MONTHLY', monthDay: 5 }), '2026-12-10', '2026-12-01', '2027-02-28'),
      ['2027-01-05', '2027-02-05'],
    );
  });

  it('yearly on 29 February handles leap and common years per policy, across year rollover', () => {
    assert.deepEqual(
      dates(rule({ frequency: 'YEARLY' }), '2028-02-29', '2028-01-01', '2032-12-31'),
      ['2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29'],
    );
    assert.deepEqual(
      dates(
        rule({ frequency: 'YEARLY', missingDay: 'SKIP' }),
        '2028-02-29',
        '2028-01-01',
        '2032-12-31',
      ),
      ['2028-02-29', '2032-02-29'],
    );
  });

  it('UNTIL is inclusive, ordinals are global and the window bounds the result', () => {
    const r = rule({ frequency: 'DAILY', end: { type: 'UNTIL', until: '2026-12-05' } });
    const occ = expandRecurrence(r, '2026-12-01', { from: '2026-12-03', to: '2027-01-01' });
    assert.deepEqual(
      occ.map((o) => [o.ordinal, o.date]),
      [
        [2, '2026-12-03'],
        [3, '2026-12-04'],
        [4, '2026-12-05'],
      ],
    );
    assert.equal(recurrenceFinishedAfter(r, '2026-12-01', '2026-12-05'), true);
    assert.equal(recurrenceFinishedAfter(r, '2026-12-01', '2026-12-04'), false);
    assert.equal(
      recurrenceFinishedAfter(rule({ frequency: 'DAILY' }), '2026-12-01', '2030-01-01'),
      false,
    );
  });

  it('is bounded: never more than the materialization cap, and counts prior occurrences', () => {
    const daily = rule({ frequency: 'DAILY' });
    assert.equal(dates(daily, '2026-01-01', '2026-01-01', '2030-01-01').length, 120);
    assert.equal(dates(daily, '2026-01-01', '2026-01-01', '2030-01-01', 5).length, 5);
    assert.equal(occurrencesBefore(daily, '2026-12-01', '2026-12-11'), 10);
    assert.equal(occurrencesBefore(daily, '2026-12-01', '2026-12-01'), 0);
    assert.equal(horizonEnd(daily, '2026-11-28'), '2027-02-26');
  });

  it('validates rules strictly', () => {
    assert.equal(recurrenceSchema.safeParse({ frequency: 'WEEKLY', monthDay: 3 }).success, false);
    assert.equal(recurrenceSchema.safeParse({ frequency: 'MONTHLY', monthDay: 32 }).success, false);
    assert.equal(recurrenceSchema.safeParse({ frequency: 'DAILY', interval: 0 }).success, false);
    assert.equal(
      recurrenceSchema.safeParse({ frequency: 'DAILY', end: { type: 'COUNT', count: 0 } }).success,
      false,
    );
    const ok = recurrenceSchema.parse({ frequency: 'MONTHLY', monthDay: 'LAST' });
    assert.deepEqual(ok, {
      frequency: 'MONTHLY',
      interval: 1,
      monthDay: 'LAST',
      missingDay: 'LAST_DAY',
      end: { type: 'NEVER' },
    });
  });

  it('describes rules in Thai', () => {
    assert.match(
      describeRecurrenceThai(rule({ frequency: 'WEEKLY' }), '2026-12-07'),
      /ทุกสัปดาห์ วันจันทร์/,
    );
    assert.match(
      describeRecurrenceThai(
        rule({ frequency: 'MONTHLY', monthDay: 31, missingDay: 'SKIP' }),
        '2026-12-31',
      ),
      /ข้ามเดือน/,
    );
    assert.match(
      describeRecurrenceThai(
        rule({ frequency: 'DAILY', end: { type: 'UNTIL', until: '2027-01-31' } }),
        '2026-12-01',
      ),
      /2570/,
    );
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addDaysToLocalDate,
  describeOffsetThai,
  describeTimeUntilThai,
  formatThaiLocalDate,
  formatThaiTime,
  parseLocalDate,
  timeZoneOffsetMinutes,
  toLocalDateString,
  zonedLocalToUtc,
} from '../src/time.js';

describe('zonedLocalToUtc', () => {
  it('converts Asia/Bangkok wall-clock time to UTC (+07:00, no DST)', () => {
    const utc = zonedLocalToUtc('2026-11-26', '09:00', 'Asia/Bangkok');
    assert.equal(utc.toISOString(), '2026-11-26T02:00:00.000Z');
  });

  it('crosses the UTC date boundary correctly for early-morning Bangkok times', () => {
    const utc = zonedLocalToUtc('2026-12-01', '05:30', 'Asia/Bangkok');
    assert.equal(utc.toISOString(), '2026-11-30T22:30:00.000Z');
    assert.equal(toLocalDateString(utc, 'Asia/Bangkok'), '2026-12-01');
  });

  it('respects DST in zones that use it (America/New_York)', () => {
    assert.equal(
      zonedLocalToUtc('2026-07-01', '09:00', 'America/New_York').toISOString(),
      '2026-07-01T13:00:00.000Z',
    );
    assert.equal(
      zonedLocalToUtc('2026-12-01', '09:00', 'America/New_York').toISOString(),
      '2026-12-01T14:00:00.000Z',
    );
  });

  it('reports the Bangkok offset as 420 minutes', () => {
    assert.equal(timeZoneOffsetMinutes(new Date('2026-06-15T00:00:00Z'), 'Asia/Bangkok'), 420);
  });
});

describe('local dates (all-day safety)', () => {
  it('rejects impossible calendar dates', () => {
    assert.throws(() => parseLocalDate('2026-02-30'), RangeError);
    assert.throws(() => parseLocalDate('2026-13-01'), RangeError);
    assert.throws(() => parseLocalDate('26-11-2026'), RangeError);
  });

  it('adds days across month and year boundaries without UTC drift', () => {
    assert.equal(addDaysToLocalDate('2026-12-31', 1), '2027-01-01');
    assert.equal(addDaysToLocalDate('2028-03-01', -1), '2028-02-29');
  });

  it('formats an all-day local date with the same calendar day regardless of zone', () => {
    const text = formatThaiLocalDate('2027-01-01');
    assert.equal(text.day, '1');
    assert.equal(text.yearBE, '2570');
  });
});

describe('Thai display', () => {
  it('uses Buddhist Era years', () => {
    const t = formatThaiLocalDate('2026-11-26');
    assert.equal(t.yearBE, '2569');
    assert.match(t.short, /26/);
    assert.match(t.long, /^วัน.+ที่ 26 .+ 2569$/);
  });

  it('formats times in 24-hour Thai style', () => {
    assert.equal(formatThaiTime(new Date('2026-11-26T02:00:00Z'), 'Asia/Bangkok'), '09:00 น.');
    assert.equal(formatThaiTime(new Date('2026-11-26T11:45:00Z'), 'Asia/Bangkok'), '18:45 น.');
  });

  it('describes reminder offsets', () => {
    assert.equal(describeOffsetThai(0), 'ตรงเวลานัด');
    assert.equal(describeOffsetThai(30), 'ก่อน 30 นาที');
    assert.equal(describeOffsetThai(120), 'ก่อน 2 ชั่วโมง');
    assert.equal(describeOffsetThai(1440), 'ก่อน 1 วัน');
    assert.equal(describeOffsetThai(90), 'ก่อน 1 ชั่วโมง 30 นาที');
  });

  it('describes time remaining', () => {
    const now = new Date('2026-11-26T02:00:00Z');
    assert.equal(describeTimeUntilThai(new Date('2026-11-26T02:30:00Z'), now), 'อีก 30 นาที');
    assert.equal(describeTimeUntilThai(new Date('2026-11-26T04:00:00Z'), now), 'อีก 2 ชั่วโมง');
    assert.equal(describeTimeUntilThai(new Date('2026-11-26T01:00:00Z'), now), 'ผ่านไปแล้ว');
  });
});

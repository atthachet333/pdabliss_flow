/**
 * Recurring appointments and bills — rule contract v1 (EP02 consolidated).
 *
 * Pure and deterministic: works on local calendar dates ("YYYY-MM-DD") only and never on the
 * host, browser or database time zone. Times of day are applied later in the appointment's
 * own zone (Asia/Bangkok by default), so a 10:00 weekly meeting stays at 10:00 local time.
 *
 *  DAILY    every `interval` days from the series start date
 *  WEEKLY   every `interval` weeks on the weekday of the series start date
 *  MONTHLY  every `interval` months on `monthDay` (1–31) or on the last day ('LAST');
 *           `monthDay` null = the day of the series start date
 *  YEARLY   every `interval` years on the month/day of the series start date
 *
 *  Missing days (31 April, 29 February in a common year):
 *    LAST_DAY → the last day of that month   SKIP → no occurrence that period
 *  A skipped period never counts towards an occurrence COUNT.
 *
 *  Termination: NEVER (bounded by the materialization horizon), UNTIL (inclusive local
 *  date) or COUNT (total occurrences, counted from the series start).
 *
 * Occurrences are identified by their generated local date (`occurrenceDate`), which never
 * changes even when one occurrence is moved — that is what keeps generation idempotent and
 * free of duplicates (database unique key: series + occurrenceDate).
 */
import { z } from 'zod';
import { addDaysToLocalDate, isValidLocalDate, parseLocalDate } from './time.js';

export const RECURRENCE_FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];
export type MissingDayPolicy = 'LAST_DAY' | 'SKIP';

export const RECURRENCE_MAX_INTERVAL = 99;
export const RECURRENCE_MAX_COUNT = 500;
/** Hard cap on materialized occurrences per generation pass (bounded storage). */
export const RECURRENCE_MAX_MATERIALIZED = 120;
/** Rolling horizon (days ahead of "today") that occurrences are materialized for. */
export const RECURRENCE_HORIZON_DAYS: Readonly<Record<RecurrenceFrequency, number>> = {
  DAILY: 90,
  WEEKLY: 371,
  MONTHLY: 731,
  YEARLY: 1830,
};
/** Upper bound on periods inspected by one expansion (protects against pathological rules). */
const MAX_PERIODS = 6000;

export type RecurrenceEnd =
  { type: 'NEVER' } | { type: 'UNTIL'; until: string } | { type: 'COUNT'; count: number };

export interface RecurrenceRule {
  frequency: RecurrenceFrequency;
  interval: number;
  monthDay: number | 'LAST' | null;
  missingDay: MissingDayPolicy;
  end: RecurrenceEnd;
}

const localDate = z.string().refine(isValidLocalDate, 'invalid date');

export const recurrenceSchema = z
  .object({
    frequency: z.enum(RECURRENCE_FREQUENCIES),
    interval: z.number().int().min(1).max(RECURRENCE_MAX_INTERVAL).default(1),
    monthDay: z
      .union([z.number().int().min(1).max(31), z.literal('LAST')])
      .nullable()
      .default(null),
    missingDay: z.enum(['LAST_DAY', 'SKIP']).default('LAST_DAY'),
    end: z
      .discriminatedUnion('type', [
        z.object({ type: z.literal('NEVER') }).strict(),
        z.object({ type: z.literal('UNTIL'), until: localDate }).strict(),
        z
          .object({
            type: z.literal('COUNT'),
            count: z.number().int().min(1).max(RECURRENCE_MAX_COUNT),
          })
          .strict(),
      ])
      .default({ type: 'NEVER' }),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.monthDay !== null && v.frequency !== 'MONTHLY')
      ctx.addIssue({ code: 'custom', path: ['monthDay'], message: 'only for MONTHLY' });
  });

export type RecurrenceInput = z.input<typeof recurrenceSchema>;

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function ymd(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Candidate date of period k (or null when the period has no occurrence). */
function periodDate(rule: RecurrenceRule, start: string, k: number): string | null {
  const s = parseLocalDate(start);
  const step = k * rule.interval;
  switch (rule.frequency) {
    case 'DAILY':
      return addDaysToLocalDate(start, step);
    case 'WEEKLY':
      return addDaysToLocalDate(start, step * 7);
    case 'MONTHLY': {
      const index = s.month - 1 + step;
      const year = s.year + Math.floor(index / 12);
      const month = (index % 12) + 1;
      const dim = daysInMonth(year, month);
      const wanted = rule.monthDay === 'LAST' ? dim : (rule.monthDay ?? s.day);
      if (wanted <= dim) return ymd(year, month, wanted);
      return rule.missingDay === 'LAST_DAY' ? ymd(year, month, dim) : null;
    }
    case 'YEARLY': {
      const year = s.year + step;
      const dim = daysInMonth(year, s.month);
      if (s.day <= dim) return ymd(year, s.month, s.day);
      return rule.missingDay === 'LAST_DAY' ? ymd(year, s.month, dim) : null;
    }
  }
}

export interface Occurrence {
  /** 0-based position in the whole series (skipped periods excluded). */
  ordinal: number;
  /** Generated local date — the stable occurrence identity. */
  date: string;
}

/**
 * Occurrences of `rule` (series starting `start`) whose dates fall in [from, to], in order,
 * at most `max`. Dates before `start` never occur. Deterministic and bounded.
 */
export function expandRecurrence(
  rule: RecurrenceRule,
  start: string,
  window: { from: string; to: string; max?: number },
): Occurrence[] {
  if (!isValidLocalDate(start) || !isValidLocalDate(window.from) || !isValidLocalDate(window.to))
    throw new RangeError('invalid recurrence window');
  const max = Math.min(window.max ?? RECURRENCE_MAX_MATERIALIZED, RECURRENCE_MAX_COUNT);
  const out: Occurrence[] = [];
  let ordinal = 0;
  let last = '';
  for (let k = 0; k < MAX_PERIODS; k++) {
    const date = periodDate(rule, start, k);
    if (date === null) continue;
    if (date < start || date === last) continue;
    if (rule.end.type === 'UNTIL' && date > rule.end.until) break;
    if (rule.end.type === 'COUNT' && ordinal >= rule.end.count) break;
    if (date > window.to) break;
    last = date;
    if (date >= window.from) {
      out.push({ ordinal, date });
      if (out.length >= max) break;
    }
    ordinal += 1;
  }
  return out;
}

/** True when the rule can never produce another occurrence after `afterDate`. */
export function recurrenceFinishedAfter(
  rule: RecurrenceRule,
  start: string,
  afterDate: string,
): boolean {
  if (rule.end.type === 'NEVER') return false;
  if (rule.end.type === 'UNTIL' && rule.end.until <= afterDate) return true;
  const next = expandRecurrence(rule, start, {
    from: addDaysToLocalDate(afterDate, 1),
    to: addDaysToLocalDate(afterDate, 366 * RECURRENCE_MAX_INTERVAL),
    max: 1,
  });
  return next.length === 0;
}

/** Number of occurrences strictly before `date` (used when a series is split). */
export function occurrencesBefore(rule: RecurrenceRule, start: string, date: string): number {
  if (date <= start) return 0;
  return expandRecurrence(rule, start, {
    from: start,
    to: addDaysToLocalDate(date, -1),
    max: RECURRENCE_MAX_COUNT,
  }).length;
}

/** Last day of the materialization horizon for a rule, counted from `today`. */
export function horizonEnd(rule: Pick<RecurrenceRule, 'frequency'>, today: string): string {
  return addDaysToLocalDate(today, RECURRENCE_HORIZON_DAYS[rule.frequency]);
}

const WEEKDAY_TH = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const MONTH_TH = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
];

/** Short Thai description, e.g. "ทุกเดือน วันที่ 31 (เดือนที่ไม่มีวันนี้ใช้วันสุดท้าย)". */
export function describeRecurrenceThai(rule: RecurrenceRule, start: string): string {
  const s = parseLocalDate(start);
  const every = (unit: string) =>
    rule.interval === 1 ? `ทุก${unit}` : `ทุก ${rule.interval} ${unit}`;
  let text: string;
  switch (rule.frequency) {
    case 'DAILY':
      text = every('วัน');
      break;
    case 'WEEKLY': {
      const dow = new Date(Date.UTC(s.year, s.month - 1, s.day)).getUTCDay();
      text = `${every('สัปดาห์')} วัน${WEEKDAY_TH[dow]}`;
      break;
    }
    case 'MONTHLY': {
      const day = rule.monthDay ?? s.day;
      text =
        day === 'LAST'
          ? `${every('เดือน')} วันสุดท้ายของเดือน`
          : `${every('เดือน')} วันที่ ${day}${
              day > 28
                ? rule.missingDay === 'LAST_DAY'
                  ? ' (เดือนที่ไม่มีวันนี้ใช้วันสุดท้ายของเดือน)'
                  : ' (ข้ามเดือนที่ไม่มีวันนี้)'
                : ''
            }`;
      break;
    }
    case 'YEARLY':
      text = `${every('ปี')} วันที่ ${s.day} ${MONTH_TH[s.month - 1]}${
        s.month === 2 && s.day === 29
          ? rule.missingDay === 'LAST_DAY'
            ? ' (ปีที่ไม่มีวันนี้ใช้ 28 ก.พ.)'
            : ' (ข้ามปีที่ไม่มีวันนี้)'
          : ''
      }`;
      break;
  }
  if (rule.end.type === 'COUNT') text += ` · ${rule.end.count} ครั้ง`;
  if (rule.end.type === 'UNTIL') {
    const u = parseLocalDate(rule.end.until);
    text += ` · ถึง ${u.day} ${MONTH_TH[u.month - 1]} ${u.year + 543}`;
  }
  return text;
}

/** Scope of an edit or cancellation on a recurring item. */
export const SERIES_SCOPES = ['THIS', 'FUTURE', 'ALL'] as const;
export type SeriesScope = (typeof SERIES_SCOPES)[number];

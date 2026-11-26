/**
 * Multi-stage reminder rules — contract v1 (EP02). Pure and deterministic; used by the API
 * (authoritative, inside the appointment transaction) and by the web form (live preview).
 * Semantics: docs/EP02-ARCHITECTURE.md §Reminders.
 *
 *  RELATIVE  fireAt = anchor − offsetMinutes            (e.g. 60 → one hour before)
 *  CALENDAR  fireAt = (localDate + dayOffset) at localTime in the appointment's zone
 *            (e.g. dayOffset 0, "06:00" → 06:00 on the appointment day)
 *
 *  anchor    timed appointment: its start instant;
 *            all-day appointment: ALL_DAY_ANCHOR_TIME (08:00) local on its start date.
 *
 *  Status    DISABLED  rule switched off
 *            PAST      fireAt is less than MIN_LEAD_MS ahead of `now` — never delivered,
 *                      never "caught up" by an immediate send
 *            DUPLICATE same kind and same instant as an earlier rule → delivered once
 *            CANCELLED appointment cancelled
 *            SCHEDULED eligible for EP03 delivery
 *  A CALENDAR rule that would fire after a timed appointment has started is invalid
 *  ("after-start"). Rules of different kinds that land on the same minute stay separate
 *  (their wording differs) but are flagged `sameTimeAs` so the UI can warn.
 */
import {
  addDaysToLocalDate,
  describeOffsetThai,
  isValidLocalDate,
  isValidLocalTime,
  zonedLocalToUtc,
} from './time.js';

export const REMINDER_RULE_VERSION = 1;
export const MAX_REMINDER_RULES = 5;
export const MAX_RELATIVE_OFFSET_MINUTES = 43_200; // 30 days
export const MIN_CALENDAR_DAY_OFFSET = -7;
export const REMINDER_MIN_LEAD_MS = 60_000;
export const ALL_DAY_ANCHOR = '08:00';

export const RELATIVE_PRESETS = [5, 15, 30, 60, 120, 1440] as const;
export const CALENDAR_PRESETS = [
  { dayOffset: 0, localTime: '06:00' },
  { dayOffset: 0, localTime: '08:00' },
  { dayOffset: -1, localTime: '18:00' },
] as const;

export type ReminderRuleKind = 'RELATIVE' | 'CALENDAR';
export type ReminderRuleStatus = 'SCHEDULED' | 'PAST' | 'DISABLED' | 'DUPLICATE' | 'CANCELLED';
export type ReminderRuleIssue =
  'invalid-offset' | 'invalid-day-offset' | 'invalid-time' | 'after-start' | 'too-many';

export interface ReminderRuleInput {
  kind: ReminderRuleKind;
  offsetMinutes?: number | null;
  dayOffset?: number | null;
  localTime?: string | null;
  enabled: boolean;
}

export interface AppointmentTiming {
  allDay: boolean;
  /** Local start date "YYYY-MM-DD". */
  localDate: string;
  /** Local start time "HH:mm" (ignored for all-day). */
  localTime: string | null;
  timeZone: string;
  cancelled?: boolean;
}

export interface CalculatedReminder {
  index: number;
  kind: ReminderRuleKind;
  fireAt: Date | null;
  status: ReminderRuleStatus;
  issue: ReminderRuleIssue | null;
  /** Index of the earlier rule this one duplicates. */
  duplicateOf: number | null;
  /** Index of an earlier rule of the other kind at the same minute. */
  sameTimeAs: number | null;
  labelTh: string;
}

export interface ReminderCalculation {
  anchor: Date;
  reminders: CalculatedReminder[];
  /** True when every rule is valid (statuses may still be PAST/DISABLED/DUPLICATE). */
  valid: boolean;
}

export function appointmentAnchor(t: AppointmentTiming): Date {
  return zonedLocalToUtc(
    t.localDate,
    t.allDay ? ALL_DAY_ANCHOR : (t.localTime ?? '00:00'),
    t.timeZone,
  );
}

export function reminderLabelTh(rule: ReminderRuleInput): string {
  if (rule.kind === 'RELATIVE') {
    const m = rule.offsetMinutes ?? 0;
    return m === 0 ? 'เมื่อถึงเวลานัด' : `ก่อนนัด ${describeOffsetThai(m).replace(/^ก่อน\s*/, '')}`;
  }
  const d = rule.dayOffset ?? 0;
  const time = rule.localTime ?? '--:--';
  if (d === 0) return Number(time.slice(0, 2)) < 12 ? `เช้าวันนัด ${time} น.` : `วันนัด ${time} น.`;
  if (d === -1) return `วันก่อนนัด ${time} น.`;
  return `ก่อนนัด ${-d} วัน เวลา ${time} น.`;
}

function validate(rule: ReminderRuleInput): ReminderRuleIssue | null {
  if (rule.kind === 'RELATIVE') {
    const m = rule.offsetMinutes;
    if (typeof m !== 'number' || !Number.isInteger(m) || m < 0 || m > MAX_RELATIVE_OFFSET_MINUTES)
      return 'invalid-offset';
    return null;
  }
  const d = rule.dayOffset;
  if (typeof d !== 'number' || !Number.isInteger(d) || d > 0 || d < MIN_CALENDAR_DAY_OFFSET)
    return 'invalid-day-offset';
  if (typeof rule.localTime !== 'string' || !isValidLocalTime(rule.localTime))
    return 'invalid-time';
  return null;
}

export function calculateReminders(
  timing: AppointmentTiming,
  rules: readonly ReminderRuleInput[],
  now: Date,
): ReminderCalculation {
  if (!isValidLocalDate(timing.localDate)) throw new RangeError('invalid appointment date');
  if (!timing.allDay && (!timing.localTime || !isValidLocalTime(timing.localTime)))
    throw new RangeError('invalid appointment time');
  const anchor = appointmentAnchor(timing);
  const startInstant = timing.allDay ? null : anchor;
  const out: CalculatedReminder[] = [];
  const firstByKey = new Map<string, number>(); // kind|instant → index
  const firstByInstant = new Map<number, { index: number; kind: ReminderRuleKind }>();
  let valid = true;

  rules.forEach((rule, index) => {
    const base = {
      index,
      kind: rule.kind,
      duplicateOf: null,
      sameTimeAs: null,
      labelTh: reminderLabelTh(rule),
    };
    if (index >= MAX_REMINDER_RULES) {
      valid = false;
      out.push({ ...base, fireAt: null, status: 'DISABLED', issue: 'too-many' });
      return;
    }
    const issue = validate(rule);
    if (issue) {
      valid = false;
      out.push({ ...base, fireAt: null, status: 'DISABLED', issue });
      return;
    }
    const fireAt =
      rule.kind === 'RELATIVE'
        ? new Date(anchor.getTime() - (rule.offsetMinutes as number) * 60_000)
        : zonedLocalToUtc(
            addDaysToLocalDate(timing.localDate, rule.dayOffset as number),
            rule.localTime as string,
            timing.timeZone,
          );
    if (rule.kind === 'CALENDAR' && startInstant && fireAt.getTime() > startInstant.getTime()) {
      valid = false;
      out.push({ ...base, fireAt, status: 'DISABLED', issue: 'after-start' });
      return;
    }
    let status: ReminderRuleStatus;
    let duplicateOf: number | null = null;
    let sameTimeAs: number | null = null;
    if (timing.cancelled) status = 'CANCELLED';
    else if (!rule.enabled) status = 'DISABLED';
    else if (fireAt.getTime() - now.getTime() < REMINDER_MIN_LEAD_MS) status = 'PAST';
    else {
      const key = `${rule.kind}|${fireAt.getTime()}`;
      const dup = firstByKey.get(key);
      if (dup !== undefined) {
        status = 'DUPLICATE';
        duplicateOf = dup;
      } else {
        status = 'SCHEDULED';
        firstByKey.set(key, index);
        const other = firstByInstant.get(fireAt.getTime());
        if (other && other.kind !== rule.kind) sameTimeAs = other.index;
        else if (!other) firstByInstant.set(fireAt.getTime(), { index, kind: rule.kind });
      }
    }
    out.push({ ...base, fireAt, status, issue: null, duplicateOf, sameTimeAs });
  });
  return { anchor, reminders: out, valid };
}

/** Owner-requested canonical defaults: same-day 06:00 + one hour before. */
export const DEFAULT_REMINDER_RULES: readonly ReminderRuleInput[] = [
  { kind: 'CALENDAR', dayOffset: 0, localTime: '06:00', enabled: true },
  { kind: 'RELATIVE', offsetMinutes: 60, enabled: true },
];

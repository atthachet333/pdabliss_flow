/**
 * Reminder-time calculation (pure). Rules are documented in docs/NOTIFICATION-ENGINE-PLAN.md.
 *
 *  R1  Preset offsets: 0, 5, 10, 15, 30, 60, 120 minutes and 1 day before.
 *  R2  Custom offsets: whole minutes, 1 … 43,200 (30 days).
 *  R3  At most MAX_REMINDERS reminders per appointment.
 *  R4  Duplicate offsets are collapsed and reported.
 *  R5  A reminder whose fire time is not at least MIN_LEAD_MS in the future is rejected as "past".
 *  R6  All-day appointments anchor reminders at ALL_DAY_ANCHOR_TIME local time on the event date.
 *  R7  Results are sorted by fire time (earliest first).
 */
import { zonedLocalToUtc } from './time.js';

export const PRESET_REMINDER_OFFSETS = [0, 5, 10, 15, 30, 60, 120, 1440] as const;
export const MAX_REMINDERS = 5;
export const MAX_CUSTOM_OFFSET_MINUTES = 43_200;
export const MIN_LEAD_MS = 60_000;
export const ALL_DAY_ANCHOR_TIME = '08:00';

export type ReminderIssue = 'past' | 'duplicate' | 'invalid-offset' | 'over-limit';

export interface ReminderInput {
  /** Local calendar date of the appointment, "YYYY-MM-DD". */
  localDate: string;
  /** Local start time "HH:mm" (ignored when allDay). */
  localTime: string;
  allDay: boolean;
  timeZone: string;
  offsetsMinutes: readonly number[];
  now: Date;
}

export interface ComputedReminder {
  offsetMinutes: number;
  fireAt: Date;
}

export interface RejectedReminder {
  offsetMinutes: number;
  issue: ReminderIssue;
  fireAt?: Date;
}

export interface ReminderPlan {
  /** Instant the reminders are anchored to. */
  anchor: Date;
  scheduled: ComputedReminder[];
  rejected: RejectedReminder[];
}

export function isValidOffset(offset: number): boolean {
  return Number.isInteger(offset) && offset >= 0 && offset <= MAX_CUSTOM_OFFSET_MINUTES;
}

export function reminderAnchor(
  input: Pick<ReminderInput, 'localDate' | 'localTime' | 'allDay' | 'timeZone'>,
): Date {
  return zonedLocalToUtc(
    input.localDate,
    input.allDay ? ALL_DAY_ANCHOR_TIME : input.localTime,
    input.timeZone,
  );
}

export function planReminders(input: ReminderInput): ReminderPlan {
  const anchor = reminderAnchor(input);
  const seen = new Set<number>();
  const candidates: ComputedReminder[] = [];
  const rejected: RejectedReminder[] = [];

  for (const offset of input.offsetsMinutes) {
    if (!isValidOffset(offset)) {
      rejected.push({ offsetMinutes: offset, issue: 'invalid-offset' });
      continue;
    }
    if (seen.has(offset)) {
      rejected.push({ offsetMinutes: offset, issue: 'duplicate' });
      continue;
    }
    seen.add(offset);
    const fireAt = new Date(anchor.getTime() - offset * 60_000);
    if (fireAt.getTime() - input.now.getTime() < MIN_LEAD_MS) {
      rejected.push({ offsetMinutes: offset, issue: 'past', fireAt });
      continue;
    }
    candidates.push({ offsetMinutes: offset, fireAt });
  }

  candidates.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());
  const scheduled = candidates.slice(0, MAX_REMINDERS);
  for (const extra of candidates.slice(MAX_REMINDERS)) {
    rejected.push({
      offsetMinutes: extra.offsetMinutes,
      issue: 'over-limit',
      fireAt: extra.fireAt,
    });
  }
  return { anchor, scheduled, rejected };
}

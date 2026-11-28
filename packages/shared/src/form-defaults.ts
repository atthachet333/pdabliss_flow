/**
 * Default date/time for a new appointment (RD03, EP02 consolidated).
 *
 *  - A date picked in the calendar (or any future date) starts at 09:00.
 *  - For today, the start is the next full hour that is at least 30 minutes away
 *    (16:20 → 17:00, 16:40 → 18:00), so a new appointment never silently defaults to a
 *    time that has already passed.
 *  - If that would cross local midnight (from 23:30 onward), the default moves to 09:00 the
 *    next day — never to an invalid "24:00".
 *  - A past date chosen on purpose keeps 09:00: historical entries remain possible, and the
 *    reminder engine marks their reminders PAST (never delivered), so nothing misleading is
 *    scheduled.
 */
import { addDaysToLocalDate, toLocalDateString, zonedParts } from './time.js';

export const DEFAULT_START_TIME = '09:00';
const MIN_LEAD_MINUTES = 30;

export function defaultAppointmentStart(
  now: Date,
  timeZone: string,
  requestedDate?: string | null,
): { date: string; startTime: string; movedToNextDay: boolean } {
  const today = toLocalDateString(now, timeZone);
  const date = requestedDate ?? today;
  if (date !== today) return { date, startTime: DEFAULT_START_TIME, movedToNextDay: false };
  const p = zonedParts(now, timeZone);
  const minutes = p.hour * 60 + p.minute + MIN_LEAD_MINUTES;
  const nextHour = Math.ceil(minutes / 60);
  if (nextHour >= 24)
    return {
      date: addDaysToLocalDate(today, 1),
      startTime: DEFAULT_START_TIME,
      movedToNextDay: true,
    };
  return { date, startTime: `${String(nextHour).padStart(2, '0')}:00`, movedToNextDay: false };
}

/** True when a timed start on `date` at `time` is already in the past. */
export function isPastLocalStart(now: Date, timeZone: string, date: string, time: string): boolean {
  const today = toLocalDateString(now, timeZone);
  if (date !== today) return date < today;
  const p = zonedParts(now, timeZone);
  const [h, m] = time.split(':').map(Number) as [number, number];
  return h * 60 + m <= p.hour * 60 + p.minute;
}

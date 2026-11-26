/**
 * Time-zone and Thai date utilities.
 *
 * Rules (see docs/SYSTEM-ARCHITECTURE.md → "Time"):
 *  - Timed appointments are stored as UTC instants plus the IANA zone they were created in.
 *  - All-day appointments are stored as a local calendar date ("YYYY-MM-DD") and are NEVER
 *    converted through UTC, so the date cannot shift.
 *  - Display uses the Thai locale with Buddhist Era years.
 */

const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

export function parseLocalDate(value: string): LocalDateParts {
  const m = LOCAL_DATE_RE.exec(value);
  if (!m) throw new RangeError(`Invalid local date: ${value}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new RangeError(`Invalid calendar date: ${value}`);
  }
  return { year, month, day };
}

export function parseLocalTime(value: string): { hour: number; minute: number } {
  const m = LOCAL_TIME_RE.exec(value);
  if (!m) throw new RangeError(`Invalid local time: ${value}`);
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

export function isValidLocalDate(value: string): boolean {
  try {
    parseLocalDate(value);
    return true;
  } catch {
    return false;
  }
}

export function isValidLocalTime(value: string): boolean {
  return LOCAL_TIME_RE.test(value);
}

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = offsetFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    offsetFormatters.set(timeZone, f);
  }
  return f;
}

/** Wall-clock parts of an instant in a time zone. */
export function zonedParts(instant: Date, timeZone: string) {
  const parts = partsFormatter(timeZone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** Offset of `timeZone` from UTC at `instant`, in minutes (Asia/Bangkok → 420). */
export function timeZoneOffsetMinutes(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const truncated = Math.floor(instant.getTime() / 1000) * 1000;
  return Math.round((asUtc - truncated) / 60000);
}

/**
 * Convert a local wall-clock date + time in `timeZone` to a UTC instant.
 * For times that do not exist (DST gap) the result moves forward; for ambiguous
 * times (DST overlap) the earlier instant is chosen. Asia/Bangkok has no DST.
 */
export function zonedLocalToUtc(localDate: string, localTime: string, timeZone: string): Date {
  const { year, month, day } = parseLocalDate(localDate);
  const { hour, minute } = parseLocalTime(localTime);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const firstOffset = timeZoneOffsetMinutes(new Date(guess), timeZone);
  let candidate = guess - firstOffset * 60000;
  const secondOffset = timeZoneOffsetMinutes(new Date(candidate), timeZone);
  if (secondOffset !== firstOffset) {
    candidate = guess - secondOffset * 60000;
  }
  return new Date(candidate);
}

/** Local calendar date ("YYYY-MM-DD") of an instant in a zone. */
export function toLocalDateString(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function toLocalTimeString(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** Add whole days to a local date without touching UTC. */
export function addDaysToLocalDate(localDate: string, days: number): string {
  const { year, month, day } = parseLocalDate(localDate);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- Thai display

export interface ThaiDateText {
  weekday: string;
  day: string;
  month: string;
  /** Buddhist Era year, e.g. "2569". */
  yearBE: string;
  /** "พฤ. 26 พ.ย. 2569" style compact text. */
  short: string;
  /** "วันพฤหัสบดีที่ 26 พฤศจิกายน 2569" style long text. */
  long: string;
}

function thaiPartsFor(utcNoonOfDate: Date, timeZone: string) {
  const pick = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { timeZone, ...opts }).formatToParts(
      utcNoonOfDate,
    );
  const find = (parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  const shortParts = pick({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const longParts = pick({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const weekdayShort = find(shortParts, 'weekday');
  const weekdayLong = find(longParts, 'weekday');
  const day = find(shortParts, 'day');
  const monthShort = find(shortParts, 'month');
  const monthLong = find(longParts, 'month');
  const yearBE = find(shortParts, 'year');
  const weekdayLongBare = weekdayLong.replace(/^วัน/, '');
  return {
    weekday: weekdayLong,
    day,
    month: monthShort,
    yearBE,
    short: `${weekdayShort} ${day} ${monthShort} ${yearBE}`,
    long: `วัน${weekdayLongBare}ที่ ${day} ${monthLong} ${yearBE}`,
  };
}

/** Format a local calendar date (all-day safe: never shifted through a zone). */
export function formatThaiLocalDate(localDate: string): ThaiDateText {
  const { year, month, day } = parseLocalDate(localDate);
  return thaiPartsFor(new Date(Date.UTC(year, month - 1, day, 12)), 'UTC');
}

/** Format the local date of an instant in a zone. */
export function formatThaiDate(instant: Date, timeZone: string): ThaiDateText {
  return formatThaiLocalDate(toLocalDateString(instant, timeZone));
}

/** "09:00 น." (24-hour, Thai convention). */
export function formatThaiTime(instant: Date, timeZone: string): string {
  return `${toLocalTimeString(instant, timeZone)} น.`;
}

/** Human Thai description of a reminder offset, e.g. 30 → "ก่อน 30 นาที". */
export function describeOffsetThai(minutesBefore: number): string {
  if (minutesBefore === 0) return 'ตรงเวลานัด';
  if (minutesBefore % 1440 === 0) return `ก่อน ${minutesBefore / 1440} วัน`;
  if (minutesBefore % 60 === 0) return `ก่อน ${minutesBefore / 60} ชั่วโมง`;
  if (minutesBefore > 60) {
    const h = Math.floor(minutesBefore / 60);
    const m = minutesBefore % 60;
    return `ก่อน ${h} ชั่วโมง ${m} นาที`;
  }
  return `ก่อน ${minutesBefore} นาที`;
}

/** "อีก 30 นาที" / "อีก 2 ชั่วโมง" / "อีก 3 วัน" / "ถึงเวลาแล้ว" / "ผ่านไปแล้ว". */
export function describeTimeUntilThai(target: Date, now: Date): string {
  const minutes = Math.round((target.getTime() - now.getTime()) / 60000);
  if (minutes < 0) return 'ผ่านไปแล้ว';
  if (minutes === 0) return 'ถึงเวลาแล้ว';
  if (minutes < 60) return `อีก ${minutes} นาที`;
  if (minutes < 1440) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m === 0 ? `อีก ${h} ชั่วโมง` : `อีก ${h} ชั่วโมง ${m} นาที`;
  }
  return `อีก ${Math.round(minutes / 1440)} วัน`;
}

/** Refresh options and second-precision time text for ADM08 / ADM09 (pure, unit-tested). */
import { formatThaiDate, type HealthDto, type QuotaDto } from '@flow/shared';
import type { RefreshOptions } from './refresh';

const TZ = 'Asia/Bangkok';

/** "ส. 28 พ.ย. 2569 · 13:25:54 น." — second precision so a refresh is always visible. */
export function preciseText(iso: string): string {
  const d = new Date(iso);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(d);
  return `${formatThaiDate(d, TZ).short} · ${time} น.`;
}

export const QUOTA_REFRESH: RefreshOptions<QuotaDto> = {
  // Only a successful LINE read counts as success; a stale fallback or no data is a failure.
  judge: (q) =>
    q.status === 'available' ? 'ok' : q.status === 'not-configured' ? 'degraded' : 'failed',
  text: {
    ok: 'อัปเดตข้อมูลโควตาเรียบร้อยแล้ว',
    degraded: 'ยังไม่ได้ตั้งค่าการอ่านโควตาจาก LINE บนเครื่องนี้',
    failed: 'ไม่สามารถอ่านข้อมูลล่าสุดได้ กรุณาลองใหม่อีกครั้ง',
  },
  checkedAtOf: (q) => q.checkedAt,
  // A failed read that returned no values keeps the last valid values on screen, marked stale.
  merge: (prev, next, verdict) =>
    verdict === 'failed' && next.used === null && prev && prev.used !== null
      ? { ...prev, status: 'stale', errorKind: next.errorKind, checkedAt: next.checkedAt }
      : next,
};

export const HEALTH_REFRESH: RefreshOptions<HealthDto> = {
  judge: (h) => (h.database.status === 'ok' ? 'ok' : 'degraded'),
  text: {
    ok: 'ตรวจสอบสถานะระบบเรียบร้อยแล้ว',
    degraded: 'ตรวจสอบแล้ว — พบบริการที่ไม่พร้อมใช้งาน',
    failed: 'ไม่สามารถตรวจสอบสถานะระบบได้',
  },
  checkedAtOf: (h) => h.checkedAt,
};

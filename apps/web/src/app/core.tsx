/**
 * Application context, data hooks, error text and date helpers shared by every page.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  CATEGORIES,
  formatThaiLocalDate,
  toLocalDateString,
  toLocalTimeString,
  type AppointmentSummaryDto,
  type MeDto,
} from '@flow/shared';
import { ApiRequestError } from '../auth/api-client';
import { ApiNetworkError, ApiRateLimitedError } from '../auth/types';
import type { FlowApp } from './api';

export const TZ = 'Asia/Bangkok';

export interface AppCtx {
  api: FlowApp;
  me: MeDto;
  reloadMe: () => Promise<void>;
  /** Active workspace filter for Today/Calendar ("all" = every workspace I belong to). */
  workspaceId: string | 'all';
  setWorkspaceId: (id: string | 'all') => void;
  logout: () => void;
  toast: (text: string, tone?: 'success' | 'info' | 'caution') => void;
}

const Ctx = createContext<AppCtx | null>(null);
export const AppProvider = ({ value, children }: { value: AppCtx; children: ReactNode }) => (
  <Ctx.Provider value={value}>{children}</Ctx.Provider>
);
export function useApp(): AppCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}

export type Load<T> =
  | { state: 'loading'; data?: T }
  | { state: 'ready'; data: T }
  | { state: 'error'; error: unknown; data?: T };

/** Loads on mount and when `key` changes; stale responses are ignored. */
export function useLoad<T>(fn: () => Promise<T>, key: string): Load<T> & { reload: () => void } {
  const [s, setS] = useState<Load<T>>({ state: 'loading' });
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let live = true;
    setS((prev) => ({ state: 'loading', ...(prev.data !== undefined ? { data: prev.data } : {}) }));
    fnRef.current().then(
      (data) => live && setS({ state: 'ready', data }),
      (error: unknown) =>
        live &&
        setS((prev) => ({
          state: 'error',
          error,
          ...(prev.data !== undefined ? { data: prev.data } : {}),
        })),
    );
    return () => {
      live = false;
    };
  }, [key, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...s, reload };
}

/** Runs a mutation once at a time; returns [run, busy]. */
export function useAction(): [
  <T>(fn: () => Promise<T>) => Promise<T | undefined>,
  boolean,
  unknown,
] {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const inflight = useRef(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>) => {
    if (inflight.current) return undefined;
    inflight.current = true;
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e);
      return undefined;
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }, []);
  return [run, busy, error];
}

const CODE_TEXT: Record<string, string> = {
  NOT_FOUND: 'ไม่พบรายการนี้ หรือคุณไม่มีสิทธิ์เข้าถึง',
  FORBIDDEN: 'คุณไม่มีสิทธิ์ทำรายการนี้',
  CONFLICT: 'ข้อมูลถูกแก้ไขจากอีกที่หนึ่งแล้ว กรุณาโหลดใหม่แล้วลองอีกครั้ง',
  VERSION_CONFLICT: 'ข้อมูลถูกแก้ไขจากอีกที่หนึ่งแล้ว กรุณาโหลดใหม่แล้วลองอีกครั้ง',
  VALIDATION_ERROR: 'ข้อมูลบางช่องไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง',
  CSRF_INVALID: 'เซสชันไม่ถูกต้อง กรุณาเปิด FLOW ใหม่อีกครั้ง',
  ORIGIN_DENIED: 'คำขอไม่ได้มาจาก FLOW โดยตรง',
  UNAUTHENTICATED: 'เซสชันหมดอายุ กรุณาเปิด FLOW ใหม่อีกครั้ง',
  DESTINATION_NOT_PERMITTED: 'คุณไม่มีสิทธิ์ส่งแจ้งเตือนไปยังปลายทางนี้',
  PRIVATE_CONTENT_TO_GROUP:
    'นัดหมายส่วนตัวส่งเนื้อหาเต็มไปยังกลุ่มไม่ได้ — เลือก “ไม่แสดงรายละเอียด” หรือเปลี่ยนการมองเห็น',
  SENSITIVE_CONFIRMATION_REQUIRED: 'นัดหมายหมวดนี้อาจมีข้อมูลอ่อนไหว กรุณายืนยันก่อนส่งรายละเอียดไปยังกลุ่ม',
  RECIPIENT_CANNOT_VIEW: 'มีผู้รับที่ไม่ได้อยู่ในกลุ่มนี้',
  INVALID_WORKSPACE: 'คุณสร้างนัดหมายในกลุ่มนี้ไม่ได้',
  IDEMPOTENCY_KEY_REQUIRED: 'กรุณาลองบันทึกอีกครั้ง',
  LAST_OWNER: 'ต้องมีเจ้าของระบบอย่างน้อยหนึ่งคน',
  LAST_WORKSPACE_ADMIN: 'กลุ่มต้องมีผู้ดูแลอย่างน้อยหนึ่งคน — แต่งตั้งผู้ดูแลคนอื่นก่อน',
  ALREADY_PENDING: 'คุณส่งคำขอไว้แล้ว รอเจ้าของระบบอนุมัติค่ะ',
  REQUEST_ALREADY_DECIDED: 'คำขอนี้ได้รับการตัดสินแล้ว',
  INVITATION_USED: 'ลิงก์เชิญนี้ถูกใช้ไปแล้ว',
  INVITATION_REVOKED: 'ลิงก์เชิญนี้ถูกยกเลิกแล้ว',
  INVITATION_NOT_ACTIVE: 'ลิงก์เชิญนี้หมดอายุหรือถูกยกเลิกแล้ว',
  USER_NOT_ACTIVE: 'ผู้ใช้นี้ยังไม่ได้เปิดใช้งาน',
  NOT_A_MEMBER: 'ผู้ใช้นี้ไม่ได้อยู่ในกลุ่ม',
  WORKSPACE_REQUIRED: 'กรุณาเลือกกลุ่ม',
  WORKSPACE_NOT_PERMITTED: 'คุณไม่มีสิทธิ์ในกลุ่มนี้',
  END_BEFORE_START: 'เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม',
  END_TIME_REQUIRED: 'กรุณาระบุเวลาสิ้นสุด',
  SPAN_TOO_LONG: 'นัดหมายทั้งวันยาวได้ไม่เกิน 31 วัน',
  DATE_OUT_OF_RANGE: 'วันที่อยู่นอกช่วงที่รองรับ',
  INVALID_REMINDERS: 'การตั้งเวลาแจ้งเตือนบางรายการไม่ถูกต้อง',
  INVALID_SHARED_USER: 'มีผู้ที่เลือกไม่ได้อยู่ในกลุ่มนี้',
  ONLY_CREATOR_CHANGES_VISIBILITY: 'เฉพาะผู้สร้างนัดหมายเปลี่ยนการมองเห็นได้',
  INVALID_NAME: 'ชื่อไม่ถูกต้อง (1–60 ตัวอักษร)',
  CANNOT_CHANGE_OWN_ROLE: 'เปลี่ยนสิทธิ์ของตัวเองไม่ได้',
  INVALID_TRANSITION: 'เปลี่ยนสถานะนี้ไม่ได้',
  ALREADY_ACTIVE: 'ผู้ใช้นี้ใช้งานได้อยู่แล้ว',
  REQUEST_IN_PROGRESS: 'กำลังบันทึกคำขอก่อนหน้า กรุณารอสักครู่',
  DESTINATION_REMOVED: 'บอทถูกนำออกจากกลุ่ม LINE นี้แล้ว',
  INVITATION_INVALID: 'ลิงก์เชิญไม่ถูกต้อง',
  INVITATION_EXPIRED: 'ลิงก์เชิญนี้หมดอายุแล้ว',
  APPOINTMENT_CANCELLED: 'นัดหมายนี้ถูกยกเลิกแล้ว แก้ไขไม่ได้',
};

/** Thai, user-safe message for any failure (never a raw server body). */
export function errorText(e: unknown): string {
  if (e instanceof ApiNetworkError)
    return 'เชื่อมต่อไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง — ยังไม่มีการบันทึกใด ๆ';
  if (e instanceof ApiRateLimitedError)
    return `ใช้งานถี่เกินไป กรุณารอ ${e.retryAfterSeconds ?? 60} วินาทีแล้วลองใหม่`;
  if (e instanceof ApiRequestError) {
    if (CODE_TEXT[e.code]) return CODE_TEXT[e.code] as string;
    if (e.code.startsWith('ACCOUNT_')) return 'บัญชีของคุณยังใช้งานส่วนนี้ไม่ได้';
    if (e.status === 409) return CODE_TEXT.CONFLICT as string;
    if (e.status === 404) return CODE_TEXT.NOT_FOUND as string;
    if (e.status === 403) return CODE_TEXT.FORBIDDEN as string;
    if (e.status === 400) return CODE_TEXT.VALIDATION_ERROR as string;
  }
  return 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง';
}
export const errorCode = (e: unknown) => (e instanceof ApiRequestError ? e.code : null);

// ───────────────────────── dates

export const todayLocal = () => toLocalDateString(new Date(), TZ);

export function dateLabel(d: string): string {
  return formatThaiLocalDate(d).short;
}

export function whenText(
  a: Pick<
    AppointmentSummaryDto,
    'allDay' | 'startAt' | 'endAt' | 'startDate' | 'endDate' | 'timeZone'
  >,
): string {
  if (a.allDay) {
    return a.startDate === a.endDate ? 'ทั้งวัน' : `ทั้งวัน · ถึง ${dateLabel(a.endDate)}`;
  }
  const s = a.startAt ? toLocalTimeString(new Date(a.startAt), a.timeZone) : '';
  const e = a.endAt ? toLocalTimeString(new Date(a.endAt), a.timeZone) : '';
  return e ? `${s}–${e} น.` : `${s} น.`;
}

export const VISIBILITY_TEXT = {
  PRIVATE: { label: 'เฉพาะฉัน', hint: 'เห็นได้เฉพาะคุณ' },
  WORKSPACE: { label: 'ทุกคนในกลุ่ม', hint: 'สมาชิกทุกคนในกลุ่มนี้เห็น' },
  SELECTED: { label: 'เลือกคน', hint: 'เฉพาะสมาชิกที่คุณเลือก' },
} as const;

export const ROLE_TEXT = { ADMIN: 'ผู้ดูแล', MEMBER: 'สมาชิก', VIEWER: 'ดูอย่างเดียว' } as const;
export const KIND_TEXT = {
  PERSONAL: 'ส่วนตัว',
  FAMILY: 'ครอบครัว',
  COMPANY: 'บริษัท',
  CUSTOM: 'กลุ่มอื่น ๆ',
} as const;
export const GLOBAL_ROLE_TEXT = {
  OWNER: 'เจ้าของระบบ',
  ADMIN: 'ผู้ดูแลระบบ',
  USER: 'ผู้ใช้',
} as const;
export const STATUS_TEXT = {
  NEW: 'ยังไม่ส่งคำขอ',
  PENDING: 'รออนุมัติ',
  ACTIVE: 'ใช้งานได้',
  REJECTED: 'ไม่อนุมัติ',
  SUSPENDED: 'ระงับชั่วคราว',
  REVOKED: 'เพิกถอนแล้ว',
} as const;
export const categoryLabel = (c: keyof typeof CATEGORIES) => CATEGORIES[c].labelTh;

/** Monday-first week containing `d`. */
export function weekStart(d: string): string {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, day)).getUTCDay(); // 0 = Sun
  return shift(d, -((dow + 6) % 7));
}
export function shift(d: string, days: number): string {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, day + days)).toISOString().slice(0, 10);
}
export function monthGrid(year: number, month: number): string[] {
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const start = weekStart(first);
  return Array.from({ length: 42 }, (_, i) => shift(start, i));
}
export const THAI_MONTHS = [
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
export const THAI_WEEKDAYS_MON = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'];

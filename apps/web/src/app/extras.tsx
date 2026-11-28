/**
 * Small shared pieces for EP02 consolidated: member identity, recurring and bill badges,
 * the series scope chooser and honest reminder status wording (RD06/RD08).
 */
import { useId, type ReactNode } from 'react';
import {
  formatMoneyThai,
  formatThaiDateTime,
  memberColorHex,
  MEMBER_COLORS,
  type AppointmentSummaryDto,
  type MemberColorId,
  type ReminderRuleStatus,
  type SeriesScope,
} from '@flow/shared';
import { Check, Receipt, Repeat } from '../components/icons';
import { TZ } from './core';

/**
 * RD06: wording for calculated reminders. EP02 never sends LINE messages, so nothing here
 * claims a message is scheduled for delivery or was delivered.
 */
export const REMINDER_STATUS_TEXT: Record<ReminderRuleStatus, string> = {
  SCHEDULED: 'คำนวณเวลาแล้ว · ยังไม่ส่งจริง',
  PAST: 'เวลาผ่านไปแล้ว · จะไม่ส่ง',
  DISABLED: 'ปิดอยู่',
  DUPLICATE: 'ซ้ำกับรายการอื่น · นับครั้งเดียว',
  CANCELLED: 'ยกเลิกแล้ว',
  SUPPRESSED: 'ชำระแล้ว · ไม่แจ้งเตือน',
};

/** RD08: one Thai display format for every instant (Asia/Bangkok, Buddhist Era). */
export const fireText = (iso: string) => formatThaiDateTime(new Date(iso), TZ);

export const FREQUENCY_TEXT = {
  DAILY: 'ทุกวัน',
  WEEKLY: 'ทุกสัปดาห์',
  MONTHLY: 'ทุกเดือน',
  YEARLY: 'ทุกปี',
} as const;

/** Member identity: colour dot + initial + name. Colour is never the only signal. */
export function MemberMark({
  name,
  color,
  size = 'sm',
}: {
  name: string;
  color: MemberColorId;
  size?: 'sm' | 'md';
}) {
  const initial = [...name.trim()][0] ?? '?';
  return (
    <span className={`member-mark member-mark--${size}`}>
      <span className="member-mark__dot" style={{ background: memberColorHex(color) }} aria-hidden>
        {initial}
      </span>
      <span className="member-mark__name f-name">{name}</span>
    </span>
  );
}

export function SeriesBadge({ a }: { a: Pick<AppointmentSummaryDto, 'series'> }) {
  if (!a.series) return null;
  return (
    <span className="tag tag--series" title={a.series.isException ? 'แก้ไขเฉพาะครั้งนี้' : undefined}>
      <Repeat aria-hidden />
      {FREQUENCY_TEXT[a.series.frequency]}
      {a.series.isException ? ' · แก้ไขเฉพาะครั้งนี้' : ''}
    </span>
  );
}

export function BillBadge({ a }: { a: Pick<AppointmentSummaryDto, 'bill'> }) {
  if (!a.bill) return null;
  const paid = a.bill.paymentStatus === 'PAID';
  return (
    <span className={`tag tag--bill${paid ? ' tag--paid' : ''}`}>
      {paid ? <Check aria-hidden /> : <Receipt aria-hidden />}
      {paid ? 'ชำระแล้ว' : 'ยังไม่ชำระ'}
      {a.bill.amount ? ` · ${formatMoneyThai(a.bill.amount)}` : ''}
    </span>
  );
}

const SCOPE_TEXT: Record<SeriesScope, { label: string; hint: string }> = {
  THIS: { label: 'เฉพาะครั้งนี้', hint: 'ครั้งอื่นในรายการทำซ้ำไม่เปลี่ยน' },
  FUTURE: { label: 'ครั้งนี้และครั้งถัดไป', hint: 'ครั้งก่อนหน้านี้คงเดิม' },
  ALL: {
    label: 'ทุกครั้งในรายการนี้',
    hint: 'ตั้งแต่วันนี้เป็นต้นไป — ครั้งที่ผ่านไปแล้วเก็บไว้เป็นประวัติ',
  },
};

/** Explicit scope choice for edits and cancellations of a recurring item. */
export function ScopeChooser({
  value,
  onChange,
  verb,
  extra,
}: {
  value: SeriesScope;
  onChange: (s: SeriesScope) => void;
  verb: 'แก้ไข' | 'ยกเลิก';
  extra?: ReactNode;
}) {
  const name = useId();
  return (
    <fieldset className="scope">
      <legend className="f-label">{verb}รายการทำซ้ำนี้แบบใด</legend>
      {(['THIS', 'FUTURE', 'ALL'] as const).map((s) => (
        <label key={s} className={`pick scope__opt${value === s ? ' scope__opt--on' : ''}`}>
          <input
            type="radio"
            name={name}
            value={s}
            checked={value === s}
            onChange={() => onChange(s)}
          />
          <span>
            <span className="f-name">{SCOPE_TEXT[s].label}</span>
            <span className="f-hint">{SCOPE_TEXT[s].hint}</span>
          </span>
        </label>
      ))}
      <p className="f-hint">
        ครั้งที่เคยแก้ไขแยกไว้ ครั้งที่ยกเลิกแล้ว และบิลที่ชำระแล้ว จะไม่ถูกเปลี่ยนโดยการ{verb}ทั้งรายการ
      </p>
      {extra}
    </fieldset>
  );
}

/** Accessible colour picker: radio swatches with names; saves only palette tokens. */
export function ColorPicker({
  value,
  onChange,
  name,
}: {
  value: MemberColorId;
  onChange: (c: MemberColorId) => void;
  name: string;
}) {
  return (
    <div className="swatches" role="radiogroup" aria-label="สีประจำตัวของฉันในกลุ่มนี้">
      {MEMBER_COLORS.map((c) => (
        <label key={c.id} className="swatch" title={c.labelTh}>
          <input
            type="radio"
            name={name}
            value={c.id}
            checked={value === c.id}
            onChange={() => onChange(c.id)}
          />
          <span className="swatch__chip" style={{ background: c.hex }} aria-hidden>
            {value === c.id ? <Check /> : null}
          </span>
          <span className="swatch__label">{c.labelTh}</span>
        </label>
      ))}
    </div>
  );
}

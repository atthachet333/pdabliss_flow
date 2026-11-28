import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { formatMoneyThai, formatThaiLocalDate, type SeriesScope } from '@flow/shared';
import {
  Ban,
  Bell,
  Check,
  Copy,
  History,
  Lock,
  MapPin,
  PencilLine,
  Receipt,
  Repeat,
  Users,
} from '../../components/icons';
import { Button, CategoryBadge, Notice } from '../../components/ui';
import { errorText, useAction, useApp, useLoad, VISIBILITY_TEXT, whenText } from '../core';
import {
  BillBadge,
  fireText,
  MemberMark,
  REMINDER_STATUS_TEXT,
  ScopeChooser,
  SeriesBadge,
} from '../extras';
import { Confirm, KeyValue, Loaded, Page } from '../ui';

const EVENT_TEXT: Record<string, string> = {
  CREATED: 'สร้างนัดหมาย',
  UPDATED: 'แก้ไขรายละเอียด',
  RESCHEDULED: 'เปลี่ยนวันเวลา',
  REMINDERS_CHANGED: 'เปลี่ยนการแจ้งเตือน',
  VISIBILITY_CHANGED: 'เปลี่ยนผู้ที่มองเห็น',
  DESTINATIONS_CHANGED: 'เปลี่ยนปลายทางแจ้งเตือน',
  CANCELLED: 'ยกเลิกนัดหมาย',
  PAYMENT_CHANGED: 'เปลี่ยนสถานะการชำระ',
};

export function AppointmentDetailPage() {
  const { id = '' } = useParams();
  const { api, toast } = useApp();
  const navigate = useNavigate();
  const load = useLoad(() => api.appointment(id), `appt|${id}`);
  const events = useLoad(() => api.appointmentEvents(id), `events|${id}`);
  const [confirm, setConfirm] = useState(false);
  const [scope, setScope] = useState<SeriesScope>('THIS');
  const [pay, setPay] = useState<null | 'PAID' | 'UNPAID'>(null);
  const [run, busy, error] = useAction();

  return (
    <Page title="รายละเอียดนัดหมาย" back="/today">
      <Loaded load={load}>
        {(a) => {
          const cancelled = a.status === 'CANCELLED';
          const date = formatThaiLocalDate(a.startDate).long;
          const paid = a.bill?.paymentStatus === 'PAID';
          return (
            <article
              className={`detail${cancelled ? ' detail--cancelled' : ''}`}
              data-theme={a.category}
            >
              <div className="detail__head">
                <CategoryBadge category={a.category} solid />
                <SeriesBadge a={a} />
                <BillBadge a={a} />
                {cancelled ? <span className="tag tag--muted">ยกเลิกแล้ว</span> : null}
              </div>
              <h2 className="detail__title f-name">{a.title}</h2>
              <p className="detail__when f-num">
                {date} · {whenText(a)}
              </p>
              <KeyValue
                items={[
                  ['กลุ่ม', <span className="f-name">{a.workspaceName}</span>],
                  [
                    'ผู้ที่มองเห็น',
                    <span>
                      {a.visibility === 'PRIVATE' ? (
                        <Lock aria-hidden className="inline-icon" />
                      ) : (
                        <Users aria-hidden className="inline-icon" />
                      )}{' '}
                      {VISIBILITY_TEXT[a.visibility].label}
                      {a.visibility === 'SELECTED' && a.sharedWith.length
                        ? ` · ${a.sharedWith.map((s) => s.displayName).join(', ')}`
                        : ''}
                    </span>,
                  ],
                  ...(a.recurrence
                    ? ([
                        [
                          'ทำซ้ำ',
                          <span>
                            <Repeat aria-hidden className="inline-icon" />{' '}
                            {a.recurrence.descriptionTh}
                            {a.recurrence.status !== 'ACTIVE' ? (
                              <span className="tag tag--muted">
                                {a.recurrence.status === 'CANCELLED'
                                  ? 'ยกเลิกทั้งรายการแล้ว'
                                  : 'สิ้นสุดแล้ว'}
                              </span>
                            ) : null}
                          </span>,
                        ],
                      ] as [string, ReactNode][])
                    : []),
                  ...(a.bill
                    ? ([
                        [
                          'จำนวนเงิน',
                          <span className="f-num">
                            {formatMoneyThai(a.bill.amount, a.bill.currency)}
                          </span>,
                        ],
                        [
                          'สถานะการชำระ',
                          <span>
                            {paid
                              ? `ชำระแล้ว${a.paidBy ? ` · บันทึกโดย ${a.paidBy}` : ''}${a.bill.paidAt ? ` · ${fireText(a.bill.paidAt)}` : ''}`
                              : 'ยังไม่ชำระ'}
                            <span className="f-hint"> (ผู้ใช้แจ้งเอง — FLOW ไม่ได้ตรวจสอบกับธนาคาร)</span>
                          </span>,
                        ],
                      ] as [string, ReactNode][])
                    : []),
                  ...(a.location
                    ? ([
                        [
                          'สถานที่',
                          <span>
                            <MapPin aria-hidden className="inline-icon" /> {a.location}
                          </span>,
                        ],
                      ] as [string, ReactNode][])
                    : []),
                  [
                    'สร้างโดย',
                    a.mine ? (
                      <span>คุณ</span>
                    ) : a.creator ? (
                      <MemberMark name={a.creator.displayName} color={a.creator.color} />
                    ) : (
                      <span className="f-name">{a.createdBy.displayName}</span>
                    ),
                  ],
                ]}
              />
              {a.notes ? (
                <div className="detail__notes">
                  <p className="f-label">บันทึก</p>
                  <p className="pre">{a.notes}</p>
                </div>
              ) : null}

              <div className="detail__actions">
                {a.canEdit && !cancelled ? (
                  <Link className="f-btn f-btn--dark" to={`/appointments/${a.id}/edit`}>
                    <PencilLine aria-hidden /> แก้ไข
                  </Link>
                ) : null}
                {a.bill && a.canEdit && !cancelled ? (
                  <Button
                    variant={paid ? 'secondary' : 'primary'}
                    icon={paid ? Receipt : Check}
                    onClick={() => setPay(paid ? 'UNPAID' : 'PAID')}
                  >
                    {paid ? 'แก้เป็นยังไม่ชำระ' : 'ทำเครื่องหมายว่าชำระแล้ว'}
                  </Button>
                ) : null}
                <Link className="f-btn" to={`/appointments/new?from=${a.id}`}>
                  <Copy aria-hidden /> ทำซ้ำ
                </Link>
                {a.canEdit && !cancelled ? (
                  <Button variant="danger" icon={Ban} onClick={() => setConfirm(true)}>
                    ยกเลิกนัด
                  </Button>
                ) : null}
              </div>

              <h3 className="section-title">
                <Bell aria-hidden className="inline-icon" /> เวลาแจ้งเตือนที่คำนวณไว้
              </h3>
              {a.reminders.length ? (
                <ul className="rem__list">
                  {a.reminders.map((r) => (
                    <li
                      key={r.index}
                      className={`rem__item${r.status !== 'SCHEDULED' ? ' rem__item--off' : ''}`}
                    >
                      <span className="rem__label">{r.labelTh}</span>
                      <span className="rem__when f-num">
                        {r.fireAt ? fireText(r.fireAt) : ''}
                        <span className="tag tag--muted">{REMINDER_STATUS_TEXT[r.status]}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="f-hint">ไม่มีการแจ้งเตือน</p>
              )}
              {a.destinations.length ? (
                <p className="f-hint">
                  ปลายทางที่เลือกไว้:{' '}
                  {a.destinations
                    .map(
                      (d) =>
                        `${d.label}${d.kind === 'GROUP' ? (d.contentPolicy === 'FULL' ? ' (แสดงรายละเอียด)' : ' (ไม่แสดงรายละเอียด)') : ''}`,
                    )
                    .join(' · ')}
                </p>
              ) : null}
              <Notice tone="info">
                เวอร์ชันนี้คำนวณเวลาแจ้งเตือนเท่านั้น — ยังไม่มีการส่งข้อความ LINE จริง ระบบส่งแจ้งเตือนจะเปิดในเฟสถัดไป
              </Notice>

              <h3 className="section-title">
                <History aria-hidden className="inline-icon" /> ประวัติการเปลี่ยนแปลง
              </h3>
              <Loaded load={events} skeleton={1}>
                {(ev) => (
                  <ol className="timeline">
                    {ev.items.map((e, i) => (
                      <li key={i}>
                        <span className="f-name">{EVENT_TEXT[e.type] ?? e.type}</span>
                        <span className="f-hint f-num">
                          {fireText(e.at)}
                          {e.actor ? ` · ${e.actor}` : ''}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </Loaded>

              <Confirm
                open={confirm}
                title={a.series ? 'ยกเลิกรายการทำซ้ำ?' : 'ยกเลิกนัดหมายนี้?'}
                body={
                  <p>
                    “<span className="f-name">{a.title}</span>” จะถูกย้ายไปที่ “ยกเลิกแล้ว”
                    และเวลาแจ้งเตือนที่คำนวณไว้จะถูกยกเลิก — ดูย้อนหลังได้ในประวัติ
                  </p>
                }
                confirmLabel="ยืนยันการยกเลิก"
                danger
                busy={busy}
                error={error ? errorText(error) : null}
                onClose={() => setConfirm(false)}
                onConfirm={async () => {
                  const r = await run(() =>
                    api.cancelAppointment(a.id, a.version, a.series ? scope : 'THIS'),
                  );
                  if (!r) return;
                  setConfirm(false);
                  toast('ยกเลิกแล้ว', 'info');
                  load.reload();
                  events.reload();
                  navigate(`/appointments/${a.id}`, { replace: true });
                }}
              >
                {a.series ? <ScopeChooser value={scope} onChange={setScope} verb="ยกเลิก" /> : null}
              </Confirm>
              <Confirm
                open={pay !== null}
                title={pay === 'PAID' ? 'บันทึกว่าชำระบิลนี้แล้ว?' : 'แก้สถานะเป็นยังไม่ชำระ?'}
                body={
                  <p>
                    {pay === 'PAID'
                      ? 'มีผลเฉพาะบิลครั้งนี้ — เวลาแจ้งเตือนที่ยังไม่ถึงของครั้งนี้จะถูกระงับ บิลครั้งถัดไปยังแจ้งเตือนตามปกติ'
                      : 'ใช้เมื่อบันทึกผิด — เวลาแจ้งเตือนที่ยังไม่ถึงจะกลับมา ส่วนเวลาที่ผ่านไปแล้วจะไม่ถูกส่งย้อนหลัง'}{' '}
                    สถานะนี้ผู้ใช้แจ้งเอง FLOW ไม่ได้ตรวจสอบการโอนเงิน
                  </p>
                }
                confirmLabel={pay === 'PAID' ? 'ชำระแล้ว' : 'ยังไม่ชำระ'}
                busy={busy}
                error={error ? errorText(error) : null}
                onClose={() => setPay(null)}
                onConfirm={async () => {
                  if (!pay) return;
                  const r = await run(() => api.setPayment(a.id, a.version, pay));
                  if (!r) return;
                  setPay(null);
                  toast(pay === 'PAID' ? 'บันทึกว่าชำระแล้ว' : 'แก้เป็นยังไม่ชำระแล้ว');
                  load.reload();
                  events.reload();
                }}
              />
            </article>
          );
        }}
      </Loaded>
    </Page>
  );
}

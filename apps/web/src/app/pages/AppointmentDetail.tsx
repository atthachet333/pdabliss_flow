import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { formatThaiLocalDate, toLocalTimeString } from '@flow/shared';
import { Ban, Bell, Copy, History, Lock, MapPin, PencilLine, Users } from '../../components/icons';
import { Button, CategoryBadge, Notice } from '../../components/ui';
import { errorText, TZ, useAction, useApp, useLoad, VISIBILITY_TEXT, whenText } from '../core';
import { Confirm, KeyValue, Loaded, Page } from '../ui';

const EVENT_TEXT: Record<string, string> = {
  CREATED: 'สร้างนัดหมาย',
  UPDATED: 'แก้ไขรายละเอียด',
  RESCHEDULED: 'เปลี่ยนวันเวลา',
  REMINDERS_CHANGED: 'เปลี่ยนการแจ้งเตือน',
  VISIBILITY_CHANGED: 'เปลี่ยนผู้ที่มองเห็น',
  DESTINATIONS_CHANGED: 'เปลี่ยนปลายทางแจ้งเตือน',
  CANCELLED: 'ยกเลิกนัดหมาย',
};
const REMINDER_STATUS: Record<string, string> = {
  SCHEDULED: 'ตั้งเวลาแล้ว',
  PAST: 'เลยเวลาแล้ว',
  DISABLED: 'ปิดอยู่',
  DUPLICATE: 'ซ้ำ',
  CANCELLED: 'ยกเลิก',
};

export function AppointmentDetailPage() {
  const { id = '' } = useParams();
  const { api, toast } = useApp();
  const navigate = useNavigate();
  const load = useLoad(() => api.appointment(id), `appt|${id}`);
  const events = useLoad(() => api.appointmentEvents(id), `events|${id}`);
  const [confirm, setConfirm] = useState(false);
  const [run, busy, error] = useAction();

  return (
    <Page title="รายละเอียดนัดหมาย" back="/today">
      <Loaded load={load}>
        {(a) => {
          const cancelled = a.status === 'CANCELLED';
          const date = formatThaiLocalDate(a.startDate).long;
          return (
            <article
              className={`detail${cancelled ? ' detail--cancelled' : ''}`}
              data-theme={a.category}
            >
              <div className="detail__head">
                <CategoryBadge category={a.category} solid />
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
                    <span className="f-name">{a.mine ? 'คุณ' : a.createdBy.displayName}</span>,
                  ],
                ]}
              />
              {a.notes ? (
                <div className="detail__notes">
                  <p className="f-label">บันทึก</p>
                  <p className="pre">{a.notes}</p>
                </div>
              ) : null}

              <h3 className="section-title">
                <Bell aria-hidden className="inline-icon" /> การแจ้งเตือน
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
                        {r.fireAt
                          ? `${new Date(r.fireAt).toLocaleDateString('th-TH', { timeZone: TZ, day: 'numeric', month: 'short' })} ${toLocalTimeString(new Date(r.fireAt), TZ)} น.`
                          : ''}
                        <span className="tag tag--muted">{REMINDER_STATUS[r.status]}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="f-hint">ไม่มีการแจ้งเตือน</p>
              )}
              {a.destinations.length ? (
                <p className="f-hint">
                  ส่งไปที่:{' '}
                  {a.destinations
                    .map(
                      (d) =>
                        `${d.label}${d.kind === 'GROUP' ? (d.contentPolicy === 'FULL' ? ' (แสดงรายละเอียด)' : ' (ไม่แสดงรายละเอียด)') : ''}`,
                    )
                    .join(' · ')}
                </p>
              ) : null}
              <Notice tone="info">
                ยังไม่มีการส่งข้อความ LINE จริงในเวอร์ชันนี้ — เวลาที่แสดงคือเวลาที่ระบบคำนวณไว้
              </Notice>

              <div className="detail__actions">
                {a.canEdit && !cancelled ? (
                  <Link className="f-btn f-btn--dark" to={`/appointments/${a.id}/edit`}>
                    <PencilLine aria-hidden /> แก้ไข
                  </Link>
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
                <History aria-hidden className="inline-icon" /> ประวัติการเปลี่ยนแปลง
              </h3>
              <Loaded load={events} skeleton={1}>
                {(ev) => (
                  <ol className="timeline">
                    {ev.items.map((e, i) => (
                      <li key={i}>
                        <span className="f-name">{EVENT_TEXT[e.type] ?? e.type}</span>
                        <span className="f-hint f-num">
                          {new Date(e.at).toLocaleString('th-TH', {
                            timeZone: TZ,
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })}
                          {e.actor ? ` · ${e.actor}` : ''}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </Loaded>

              <Confirm
                open={confirm}
                title="ยกเลิกนัดหมายนี้?"
                body={
                  <p>
                    “<span className="f-name">{a.title}</span>” จะถูกย้ายไปที่ “ยกเลิกแล้ว”
                    และการแจ้งเตือนทั้งหมดจะไม่ถูกส่ง — ดูย้อนหลังได้ในประวัติ
                  </p>
                }
                confirmLabel="ยกเลิกนัดหมาย"
                danger
                busy={busy}
                error={error ? errorText(error) : null}
                onClose={() => setConfirm(false)}
                onConfirm={async () => {
                  const r = await run(() => api.cancelAppointment(a.id, a.version));
                  if (!r) return;
                  setConfirm(false);
                  toast('ยกเลิกนัดหมายแล้ว', 'info');
                  load.reload();
                  events.reload();
                  navigate(`/appointments/${a.id}`, { replace: true });
                }}
              />
            </article>
          );
        }}
      </Loaded>
    </Page>
  );
}

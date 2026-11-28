/**
 * Owner-only operational areas. Redaction happens on the server (domain/operations.ts);
 * these pages render exactly what the API returns and label EP03-only capabilities as not
 * enabled. There are no fake controls: pause / resume / emergency stop do not exist yet.
 */
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { addDaysToLocalDate, type ReminderRuleStatus } from '@flow/shared';
import { Lock, RefreshCw, Search } from '../../components/icons';
import { Button, Notice } from '../../components/ui';
import { KIND_TEXT, STATUS_TEXT, todayLocal, useApp, useLoad } from '../core';
import { fireText, REMINDER_STATUS_TEXT } from '../extras';
import { AdminPage, ErrorBox, NotEnabled } from './AdminCenter';
import { HEALTH_REFRESH, preciseText, QUOTA_REFRESH, RefreshStatus } from './refresh-ui';
import { useRefresh } from './refresh';

const STATUSES: ReminderRuleStatus[] = [
  'SCHEDULED',
  'PAST',
  'SUPPRESSED',
  'DUPLICATE',
  'DISABLED',
  'CANCELLED',
];

export function ActivityPage() {
  const { api } = useApp();
  const [params, setParams] = useSearchParams();
  const today = todayLocal();
  const from = params.get('from') ?? today;
  const to = params.get('to') ?? addDaysToLocalDate(from, 13);
  const status = params.get('status') ?? '';
  const workspaceId = params.get('workspaceId') ?? '';
  const offset = Number(params.get('offset') ?? 0) || 0;
  const ws = useLoad(() => api.adminWorkspaces(), 'adm-ws-activity');
  const load = useLoad(
    () => api.activity({ from, to, status, workspaceId, offset }),
    `adm-activity|${from}|${to}|${status}|${workspaceId}|${offset}`,
  );
  const setParam = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    n.delete('offset');
    setParams(n);
  };
  return (
    <AdminPage
      title="ศูนย์กิจกรรม"
      intro="ภาพรวมเวลาแจ้งเตือนทั้งระบบ — ไม่แสดงผู้สร้างนัดหมาย แสดงชื่อนัดเฉพาะรายการที่คุณมีสิทธิ์เห็นเนื้อหาอยู่แล้ว รายการอื่นถูกปิดบังโดยเซิร์ฟเวอร์ (ไม่มีชื่อ หมวด จำนวนเงิน หรือผู้รับ และเวลาแสดงเป็นรายชั่วโมง)"
    >
      <div className="adm-filters">
        <label className="adm-filter">
          <span className="f-label">ตั้งแต่</span>
          <input
            className="f-input"
            type="date"
            value={from}
            onChange={(e) => setParam('from', e.target.value)}
          />
        </label>
        <label className="adm-filter">
          <span className="f-label">ถึง</span>
          <input
            className="f-input"
            type="date"
            value={to}
            min={from}
            onChange={(e) => setParam('to', e.target.value)}
          />
        </label>
        <label className="adm-filter">
          <span className="f-label">สถานะ</span>
          <select
            className="f-select"
            value={status}
            onChange={(e) => setParam('status', e.target.value)}
          >
            <option value="">ทั้งหมด</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {REMINDER_STATUS_TEXT[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="adm-filter">
          <span className="f-label">กลุ่มงาน</span>
          <select
            className="f-select"
            value={workspaceId}
            onChange={(e) => setParam('workspaceId', e.target.value)}
          >
            <option value="">ทุกกลุ่ม</option>
            {(ws.data?.items ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {load.state === 'error' && !load.data ? (
        <ErrorBox error={load.error} onRetry={load.reload} />
      ) : !load.data ? (
        <p aria-busy="true">กำลังโหลด…</p>
      ) : (
        <>
          <ul className="adm-chips" aria-label="สรุปตามสถานะ">
            {STATUSES.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  className="adm-chip"
                  aria-pressed={status === s}
                  onClick={() => setParam('status', status === s ? '' : s)}
                >
                  <span>{REMINDER_STATUS_TEXT[s]}</span>
                  <span className="f-num">{load.data?.totals[s] ?? 0}</span>
                </button>
              </li>
            ))}
          </ul>
          {load.data.items.length === 0 ? (
            <p className="adm-empty">ไม่มีเวลาแจ้งเตือนในช่วงนี้</p>
          ) : (
            <div className="adm-table-wrap">
              <table className="adm-table">
                <caption className="sr-only">เวลาแจ้งเตือน</caption>
                <thead>
                  <tr>
                    <th scope="col">เวลาแจ้งเตือน</th>
                    <th scope="col">ประเภท</th>
                    <th scope="col">รายการ</th>
                    <th scope="col">กลุ่มงาน</th>
                    <th scope="col">ปลายทาง</th>
                    <th scope="col">สถานะ</th>
                    <th scope="col">การส่ง</th>
                  </tr>
                </thead>
                <tbody>
                  {load.data.items.map((i, n) => (
                    <tr
                      key={`${i.fireAt}-${n}`}
                      className={i.redacted ? 'adm-row--redacted' : undefined}
                    >
                      <td className="f-num">
                        {fireText(i.fireAt)}
                        {i.precision === 'hour' ? (
                          <span className="f-hint"> (รายชั่วโมง)</span>
                        ) : null}
                      </td>
                      <td>{i.reminderKind === 'CALENDAR' ? 'ตามเวลาปฏิทิน' : 'ก่อนเวลานัด'}</td>
                      <td>
                        {i.redacted ? (
                          <span className="adm-redacted">
                            <Lock aria-hidden /> จำกัดสิทธิ์ — ไม่แสดงรายละเอียด
                          </span>
                        ) : (
                          <>
                            <span className="f-name">{i.title}</span>
                            {i.itemKind === 'BILL' ? <span className="tag">บิล</span> : null}
                            {i.recurring ? <span className="tag">ทำซ้ำ</span> : null}
                          </>
                        )}
                      </td>
                      <td>
                        {i.workspace.name}
                        <span className="f-hint"> · {KIND_TEXT[i.workspace.kind]}</span>
                      </td>
                      <td>
                        {i.destinations.length
                          ? i.destinations
                              .map((d) =>
                                d.kind === 'GROUP'
                                  ? `กลุ่ม LINE${d.label ? ` · ${d.label}` : ''}`
                                  : 'แชตส่วนตัว',
                              )
                              .join(', ')
                          : 'ไม่ได้เลือกปลายทาง'}
                      </td>
                      <td>{REMINDER_STATUS_TEXT[i.status]}</td>
                      <td>
                        <span className="tag tag--muted">ยังไม่เปิดระบบส่ง</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="adm-pager">
            <Button
              size="sm"
              disabled={offset === 0}
              onClick={() => setParams(withOffset(params, Math.max(0, offset - 50)))}
            >
              ก่อนหน้า
            </Button>
            <Button
              size="sm"
              disabled={!load.data.hasMore}
              onClick={() => setParams(withOffset(params, offset + 50))}
            >
              ถัดไป
            </Button>
          </div>
          <Notice tone="info">
            EP02 แสดงเวลาที่คำนวณไว้และสถานะสิทธิ์การแจ้งเตือนเท่านั้น — ความพยายามส่ง การตอบรับจาก LINE API
            และความล้มเหลวในการส่งจะเชื่อมใน EP03 · การที่ LINE API รับข้อความไม่ได้แปลว่าผู้รับได้อ่านแล้ว
          </Notice>
        </>
      )}
    </AdminPage>
  );
}

function withOffset(p: URLSearchParams, offset: number) {
  const n = new URLSearchParams(p);
  n.set('offset', String(offset));
  return n;
}

export function NotificationsPage() {
  const { api } = useApp();
  const load = useLoad(() => api.notificationOverview(), 'adm-notif');
  return (
    <AdminPage title="การแจ้งเตือน" intro="สถานะระบบส่งแจ้งเตือนและเวลาที่คำนวณไว้">
      {load.state === 'error' && !load.data ? (
        <ErrorBox error={load.error} onRetry={load.reload} />
      ) : !load.data ? (
        <p aria-busy="true">กำลังโหลด…</p>
      ) : (
        <>
          <section className="adm-card">
            <h2 className="adm-card__title">เวลาแจ้งเตือนที่คำนวณไว้ (ตั้งแต่ตอนนี้)</h2>
            <ul className="adm-chips">
              {STATUSES.map((s) => (
                <li key={s}>
                  <Link className="adm-chip" to={`/admin/activity?status=${s}`}>
                    <span>{REMINDER_STATUS_TEXT[s]}</span>
                    <span className="f-num">{load.data?.calculated[s] ?? 0}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="adm-fine f-num">ใน 7 วันข้างหน้า: {load.data.next7Days} เวลา</p>
          </section>
          <NotEnabled title="ระบบส่งแจ้งเตือน (worker) ยังไม่ทำงาน">
            <p>
              EP02 ไม่ส่งข้อความ LINE ใด ๆ — คิวการส่ง การลองส่งซ้ำ ความล้มเหลว และปุ่มหยุดชั่วคราว / เริ่มใหม่ /
              หยุดฉุกเฉิน จะเปิดพร้อม worker ใน EP03 ซึ่งต้องควบคุมการส่งจริงได้ก่อนจึงจะแสดงปุ่มเหล่านี้
            </p>
            <ul>
              <li>หยุดชั่วคราว: ยังไม่เปิดใช้งาน</li>
              <li>เริ่มใหม่: ยังไม่เปิดใช้งาน</li>
              <li>หยุดฉุกเฉิน: ยังไม่เปิดใช้งาน (ไม่มีตัวส่งให้หยุด)</li>
            </ul>
          </NotEnabled>
        </>
      )}
    </AdminPage>
  );
}

export function QuotaPage() {
  const { api } = useApp();
  const r = useRefresh(() => api.quota(), QUOTA_REFRESH);
  const q = r.data;
  return (
    <AdminPage
      title="โควตาข้อความ LINE"
      intro="อ่านจาก LINE Official Account โดยตรงฝั่งเซิร์ฟเวอร์ (โควตาและการใช้งานเดือนนี้) — ทุกครั้งที่กด “อ่านใหม่” คือการอ่านจาก LINE จริง ไม่ใช่ค่าที่จำไว้ ไม่มีการส่งข้อความ ไม่มีการอัปเกรดแพ็กเกจอัตโนมัติ และ token ไม่ออกจากเซิร์ฟเวอร์"
      actions={
        <Button icon={RefreshCw} busy={r.busy} disabled={r.busy} onClick={r.refresh}>
          อ่านใหม่
        </Button>
      }
    >
      <RefreshStatus r={r} busyText="กำลังอ่านข้อมูลโควตาจาก LINE..." />
      {!q ? (
        r.phase === 'idle' && r.error ? (
          <ErrorBox error={r.error} onRetry={r.refresh} />
        ) : (
          <p aria-busy="true">กำลังอ่านข้อมูลโควตาจาก LINE...</p>
        )
      ) : (
        <>
          {q.status === 'not-configured' ? (
            <Notice tone="caution">
              ยังไม่ได้ตั้งค่า Messaging API สำหรับอ่านโควตาบนเครื่องนี้ — จึงไม่มีตัวเลขให้แสดง
            </Notice>
          ) : q.status === 'unavailable' ? (
            <Notice tone="caution">
              อ่านโควตาจาก LINE ไม่ได้ในขณะนี้ ({q.errorKind}) — ยังไม่เคยอ่านสำเร็จ
            </Notice>
          ) : (
            <section className="adm-card adm-quota" data-last-success={q.lastSuccessAt ?? ''}>
              {q.status === 'stale' || r.stale ? (
                <Notice tone="caution">
                  ข้อมูลเก่า — อ่านล่าสุดไม่สำเร็จ{q.errorKind ? ` (${q.errorKind})` : ''}{' '}
                  แสดงค่าที่อ่านได้สำเร็จครั้งล่าสุดเมื่อ {q.lastSuccessAt ? preciseText(q.lastSuccessAt) : '—'}
                </Notice>
              ) : null}
              <p className="adm-quota__big f-num">
                {q.used ?? '—'}{' '}
                <span>/ {q.type === 'unlimited' ? 'ไม่จำกัด' : (q.limit ?? '—')}</span>
              </p>
              {q.limit !== null && q.used !== null ? (
                <div
                  className="adm-meter"
                  role="meter"
                  aria-valuemin={0}
                  aria-valuemax={q.limit}
                  aria-valuenow={q.used}
                  aria-label="การใช้โควตา"
                >
                  <span style={{ width: `${Math.min(100, q.percent ?? 0)}%` }} />
                </div>
              ) : null}
              <dl className="adm-dl">
                <dt>คงเหลือ</dt>
                <dd className="f-num">
                  {q.remaining ?? (q.type === 'unlimited' ? 'ไม่จำกัด' : '—')}
                </dd>
                <dt>ใช้ไป</dt>
                <dd className="f-num">{q.percent !== null ? `${q.percent}%` : '—'}</dd>
                <dt>เดือนที่รายงาน</dt>
                <dd className="f-num">{q.month ?? '—'}</dd>
                <dt>อ่านจาก LINE สำเร็จล่าสุด</dt>
                <dd className="f-num">{q.lastSuccessAt ? preciseText(q.lastSuccessAt) : '—'}</dd>
              </dl>
              {q.limit !== null && q.used !== null && q.used >= q.limit ? (
                <Notice tone="block">โควตาเดือนนี้เต็มแล้ว — ระบบส่ง (EP03) ต้องหยุดส่งจนถึงเดือนใหม่</Notice>
              ) : null}
            </section>
          )}
          <NotEnabled title="การจองโควตาและบันทึกการส่งของ FLOW">
            <p>
              ตัวเลขด้านบนคือยอดของ LINE OA ทั้งบัญชี ซึ่งต่างจากบันทึกการส่งของ FLOW เอง — การจองโควตาก่อนส่ง
              และบันทึกการส่งของ FLOW จะเปิดพร้อมระบบส่งใน EP03
            </p>
          </NotEnabled>
        </>
      )}
    </AdminPage>
  );
}

export function FriendsPage() {
  const { api } = useApp();
  const [params, setParams] = useSearchParams();
  const qText = params.get('q') ?? '';
  const status = params.get('status') ?? '';
  const offset = Number(params.get('offset') ?? 0) || 0;
  const [text, setText] = useState(qText);
  const load = useLoad(
    () => api.friends({ q: qText, status, offset }),
    `adm-friends|${qText}|${status}|${offset}`,
  );
  const d = load.data;
  return (
    <AdminPage
      title="เพื่อน LINE"
      intro="แยก 4 อย่างที่ไม่ใช่สิ่งเดียวกัน: สถิติผู้ติดตาม LINE OA, เพื่อนที่ระบุตัวได้, บัญชีที่ลงทะเบียน FLOW และผู้ใช้ที่ได้รับอนุมัติ — การเพิ่ม Sally เป็นเพื่อนไม่ได้ให้สิทธิ์ใช้ FLOW"
    >
      {load.state === 'error' && !d ? (
        <ErrorBox error={load.error} onRetry={load.reload} />
      ) : !d ? (
        <p aria-busy="true">กำลังโหลด…</p>
      ) : (
        <>
          <div className="adm-grid-4">
            <section className="adm-card adm-stat">
              <p className="adm-stat__label">ผู้ติดตาม LINE OA (สถิติรวม)</p>
              <p className="adm-stat__value">ยังไม่เปิด</p>
              <p className="f-hint">{d.aggregate.noteTh}</p>
            </section>
            <section className="adm-card adm-stat">
              <p className="adm-stat__label">เพื่อนที่ระบุตัวได้</p>
              <p className="adm-stat__value">ยังไม่เปิด</p>
              <p className="f-hint">ต้องรับเหตุการณ์ follow/unfollow ที่ลงลายเซ็น (EP03)</p>
            </section>
            <section className="adm-card adm-stat">
              <p className="adm-stat__label">บัญชีที่ลงทะเบียน FLOW</p>
              <p className="adm-stat__value f-num">{d.accounts.registered}</p>
              <p className="f-hint">รอนุมัติ {d.accounts.pending}</p>
            </section>
            <section className="adm-card adm-stat">
              <p className="adm-stat__label">ผู้ใช้ที่อนุมัติแล้ว</p>
              <p className="adm-stat__value f-num">{d.accounts.approved}</p>
            </section>
          </div>
          <Notice tone="info">{d.registry.coverageTh}</Notice>
          <form
            className="adm-filters"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              const n = new URLSearchParams(params);
              if (text.trim()) n.set('q', text.trim());
              else n.delete('q');
              n.delete('offset');
              setParams(n);
            }}
          >
            <label className="adm-filter adm-filter--grow">
              <span className="f-label">ค้นหา</span>
              <input
                className="f-input"
                value={text}
                maxLength={60}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            <label className="adm-filter">
              <span className="f-label">สถานะ FLOW</span>
              <select
                className="f-select"
                value={status}
                onChange={(e) => {
                  const n = new URLSearchParams(params);
                  if (e.target.value) n.set('status', e.target.value);
                  else n.delete('status');
                  setParams(n);
                }}
              >
                <option value="">ทั้งหมด</option>
                {(['NEW', 'PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'REJECTED'] as const).map(
                  (s) => (
                    <option key={s} value={s}>
                      {STATUS_TEXT[s]}
                    </option>
                  ),
                )}
              </select>
            </label>
            <Button type="submit" variant="dark" icon={Search}>
              ค้นหา
            </Button>
          </form>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <caption className="sr-only">บัญชี LINE ที่ FLOW เคยเห็น</caption>
              <thead>
                <tr>
                  <th scope="col">ชื่อที่แสดง</th>
                  <th scope="col">LINE (ปิดบัง)</th>
                  <th scope="col">FLOW เห็นครั้งแรก</th>
                  <th scope="col">ยืนยันกับ LINE ล่าสุด</th>
                  <th scope="col">สถานะเพื่อน</th>
                  <th scope="col">สถานะ FLOW</th>
                </tr>
              </thead>
              <tbody>
                {d.items.map((f) => (
                  <tr key={f.userId}>
                    <td>
                      <Link className="adm-link f-name" to={`/admin/users/${f.userId}`}>
                        {f.displayName}
                      </Link>
                    </td>
                    <td className="f-num">{f.maskedLineId}</td>
                    <td className="f-num">{fireText(f.firstObservedAt)}</td>
                    <td className="f-num">{fireText(f.lastVerifiedAt)}</td>
                    <td>
                      {f.friendship === 'unknown'
                        ? 'ไม่ทราบ'
                        : f.friendship === 'friend'
                          ? 'เป็นเพื่อน'
                          : 'บล็อก / เลิกติดตาม'}
                    </td>
                    <td>{STATUS_TEXT[f.flowStatus]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {d.items.length === 0 ? <p className="adm-empty">ไม่พบบัญชีตามเงื่อนไข</p> : null}
          <div className="adm-pager">
            <Button
              size="sm"
              disabled={offset === 0}
              onClick={() => setParams(withOffset(params, Math.max(0, offset - 50)))}
            >
              ก่อนหน้า
            </Button>
            <Button
              size="sm"
              disabled={!d.hasMore}
              onClick={() => setParams(withOffset(params, offset + 50))}
            >
              ถัดไป
            </Button>
          </div>
        </>
      )}
    </AdminPage>
  );
}

export function HealthPage() {
  const { api } = useApp();
  const r = useRefresh(() => api.health(), HEALTH_REFRESH);
  const h = r.data;
  const row = (label: string, ok: boolean | null, text: string) => (
    <tr>
      <th scope="row">{label}</th>
      <td>
        <span
          className={`adm-dot adm-dot--${ok === null ? 'off' : ok ? 'ok' : 'bad'}`}
          aria-hidden
        />
        {text}
      </td>
    </tr>
  );
  return (
    <AdminPage
      title="สถานะระบบ"
      intro="ทุกครั้งที่กด “ตรวจใหม่” คือการตรวจ API และฐานข้อมูลจริงในขณะนั้น — แสดงเฉพาะข้อมูลที่ปลอดภัย ไม่มีรหัสผ่าน token ที่อยู่เซิร์ฟเวอร์ หรือรายละเอียดภายใน"
      actions={
        <Button icon={RefreshCw} busy={r.busy} disabled={r.busy} onClick={r.refresh}>
          ตรวจใหม่
        </Button>
      }
    >
      <RefreshStatus r={r} busyText="กำลังตรวจสอบสถานะระบบ..." />
      {!h ? (
        r.phase === 'idle' && r.error ? (
          <ErrorBox error={r.error} onRetry={r.refresh} />
        ) : (
          <p aria-busy="true">กำลังตรวจสอบสถานะระบบ...</p>
        )
      ) : (
        <section className="adm-card">
          {r.stale ? (
            <Notice tone="caution">
              ผลด้านล่างเป็นผลการตรวจครั้งก่อน — การตรวจล่าสุดไม่สำเร็จ จึงไม่ยืนยันว่าระบบทำงานปกติในขณะนี้
            </Notice>
          ) : null}
          <table className="adm-table adm-table--kv">
            <tbody>
              {row(
                'API',
                r.stale ? null : true,
                `${r.stale ? 'ไม่ทราบสถานะปัจจุบัน · ' : 'ทำงาน · '}เวอร์ชัน ${h.api.version} · เปิดมาแล้ว ${Math.round(h.api.uptimeSeconds / 60)} นาที`,
              )}
              {row(
                'ฐานข้อมูล MariaDB',
                r.stale ? null : h.database.status === 'ok',
                h.database.status === 'ok' ? `ตอบสนองใน ${h.database.latencyMs} ms` : 'ไม่พร้อมใช้งาน',
              )}
              {row(
                'LINE Login (LIFF)',
                h.line.login === 'configured',
                h.line.login === 'configured' ? 'ตั้งค่าแล้ว' : 'ยังไม่ตั้งค่า',
              )}
              {row(
                'LINE Messaging (อ่านอย่างเดียว)',
                h.line.messagingRead === 'configured',
                h.line.messagingRead === 'configured' ? 'ตั้งค่าแล้ว' : 'ยังไม่ตั้งค่า',
              )}
              {row(
                'LINE Webhook (ตรวจลายเซ็น)',
                h.line.webhook === 'configured',
                h.line.webhook === 'configured' ? 'ตั้งค่าแล้ว' : 'ยังไม่ตั้งค่า',
              )}
              {row('การส่งข้อความออก', null, 'ปิดอยู่ (EP02 ไม่ส่งข้อความ)')}
              {row('Worker ระบบส่งแจ้งเตือน', null, 'ยังไม่เปิดใช้งาน (EP03) — ไม่ได้ทำงาน')}
            </tbody>
          </table>
          <p className="adm-fine">“ยังไม่เปิดใช้งาน” ไม่ได้หมายความว่าทำงานปกติ</p>
        </section>
      )}
    </AdminPage>
  );
}

export function SettingsPage() {
  return (
    <AdminPage title="การตั้งค่าระบบ" intro="ค่าที่ระบบใช้อยู่จริง (อ่านอย่างเดียว) — ไม่มีสวิตช์ใดที่ยังไม่ได้บังคับใช้จริง">
      <section className="adm-card">
        <table className="adm-table adm-table--kv">
          <tbody>
            <tr>
              <th scope="row">เขตเวลา</th>
              <td>Asia/Bangkok (ทุกการคำนวณเวลาแจ้งเตือน)</td>
            </tr>
            <tr>
              <th scope="row">เซสชัน</th>
              <td>หมดอายุเมื่อไม่ใช้งาน 2 ชั่วโมง หรือครบ 8 ชั่วโมง · คุกกี้ HttpOnly, Secure, SameSite=Lax</td>
            </tr>
            <tr>
              <th scope="row">ยืนยันตัวตนซ้ำ</th>
              <td>การเปลี่ยนสถานะ บทบาท หรือการนำออกจากกลุ่ม ต้องเข้าสู่ระบบด้วย LINE ภายใน 15 นาทีล่าสุด</td>
            </tr>
            <tr>
              <th scope="row">ลิงก์เชิญ</th>
              <td>ใช้ได้ครั้งเดียว 1 / 24 / 72 / 168 ชั่วโมง · ไม่ให้บทบาทระบบ</td>
            </tr>
            <tr>
              <th scope="row">รายการทำซ้ำ</th>
              <td>
                สร้างล่วงหน้า 90 วัน (ทุกวัน) · 1 ปี (ทุกสัปดาห์) · 2 ปี (ทุกเดือน) · 5 ปี (ทุกปี) สูงสุด 120 ครั้งต่อรอบ
                และต่ออัตโนมัติทุก 15 นาที
              </td>
            </tr>
            <tr>
              <th scope="row">การส่งข้อความ LINE</th>
              <td>ปิด — ระบบส่ง การบำรุงรักษา และสวิตช์ฟีเจอร์จะเปิดใน EP03 เมื่อบังคับใช้ได้จริง</td>
            </tr>
          </tbody>
        </table>
      </section>
    </AdminPage>
  );
}

/**
 * Access requests, user list and user access control (offboarding). Uses the existing
 * authorized owner/admin endpoints only; the server enforces every rule (owner protection,
 * no self-actions, admins cannot touch admins/owners, recent LINE login for sensitive writes).
 */
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { Ban, CircleCheck, CircleX, Search, UserMinus, UserX } from '../../components/icons';
import { Button, Notice } from '../../components/ui';
import type { AccessRequestDto, Role } from '../api';
import {
  errorText,
  GLOBAL_ROLE_TEXT,
  KIND_TEXT,
  ROLE_TEXT,
  STATUS_TEXT,
  useAction,
  useApp,
  useLoad,
} from '../core';
import { fireText } from '../extras';
import { Confirm, Segmented } from '../ui';
import { AdminPage, ErrorBox, useSensitive } from './AdminCenter';

const AUDIT_TEXT: Record<string, string> = {
  'access.requested': 'ส่งคำขอเข้าใช้งาน',
  'access.approved': 'อนุมัติการเข้าใช้งาน',
  'access.rejected': 'ไม่อนุมัติ',
  'user.suspend': 'ระงับชั่วคราว',
  'user.reinstate': 'คืนสิทธิ์จากการระงับ',
  'user.revoke': 'เพิกถอนการเข้าใช้งาน',
  'user.reactivate': 'เปิดใช้งานอีกครั้ง (ทบทวนสิทธิ์แล้ว)',
  'user.role_changed': 'เปลี่ยนบทบาทระบบ',
  'membership.removed': 'นำออกจากกลุ่ม',
  'owner.imported': 'ตั้งเป็นเจ้าของระบบ (เครื่องมือในเครื่อง)',
};

function AssignmentsEditor({
  value,
  onChange,
}: {
  value: { workspaceId: string; role: Role }[];
  onChange: (v: { workspaceId: string; role: Role }[]) => void;
}) {
  const { api } = useApp();
  const ws = useLoad(() => api.adminWorkspaces(), 'adm-ws-pick');
  const [pick, setPick] = useState('');
  const [role, setRole] = useState<Role>('MEMBER');
  const items = ws.data?.items ?? [];
  const name = (id: string) => items.find((w) => w.id === id)?.name ?? '—';
  return (
    <div className="adm-assign">
      {value.length ? (
        <ul className="adm-assign__list">
          {value.map((a) => (
            <li key={a.workspaceId}>
              <span className="f-name">{name(a.workspaceId)}</span>
              <span className="tag">{ROLE_TEXT[a.role]}</span>
              <button
                type="button"
                className="link-btn link-btn--danger"
                onClick={() => onChange(value.filter((x) => x.workspaceId !== a.workspaceId))}
              >
                นำออก
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="f-hint">ยังไม่ได้กำหนดกลุ่มงาน — ผู้ใช้จะมีเฉพาะพื้นที่ส่วนตัว</p>
      )}
      <div className="adm-assign__add">
        <select
          className="f-select"
          aria-label="กลุ่มงาน"
          value={pick}
          onChange={(e) => setPick(e.target.value)}
        >
          <option value="">เลือกกลุ่มงาน…</option>
          {items
            .filter((w) => !value.some((a) => a.workspaceId === w.id))
            .map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({KIND_TEXT[w.kind]})
              </option>
            ))}
        </select>
        <Segmented<Role>
          label="บทบาทในกลุ่ม"
          value={role}
          onChange={setRole}
          options={[
            { value: 'VIEWER', label: ROLE_TEXT.VIEWER },
            { value: 'MEMBER', label: ROLE_TEXT.MEMBER },
            { value: 'ADMIN', label: 'ผู้ดูแลกลุ่ม' },
          ]}
        />
        <Button
          size="sm"
          disabled={!pick}
          onClick={() => {
            onChange([...value, { workspaceId: pick, role }]);
            setPick('');
          }}
        >
          เพิ่ม
        </Button>
      </div>
    </div>
  );
}

// ───────────────────────── requests

export function RequestsPage() {
  const { api, toast, reloadMe } = useApp();
  const [params, setParams] = useSearchParams();
  const status = (params.get('status') ?? 'PENDING') as 'PENDING' | 'APPROVED' | 'REJECTED';
  const load = useLoad(() => api.accessRequests(status), `adm-req|${status}`);
  const [approve, setApprove] = useState<AccessRequestDto | null>(null);
  const [reject, setReject] = useState<AccessRequestDto | null>(null);
  const [assign, setAssign] = useState<{ workspaceId: string; role: Role }[]>([]);
  const [run, busy, error] = useAction();
  const now = Date.now();
  return (
    <AdminPage
      title="คำขอเข้าใช้งาน"
      intro="ตัวตน LINE ของผู้ขอถูกยืนยันโดยเซิร์ฟเวอร์กับ LINE แล้ว (แสดงแบบปิดบังบางส่วน) — ชื่อที่แสดงใน LINE เปลี่ยนได้และไม่ใช่การยืนยันตัวตนตามกฎหมาย การอนุมัติให้สิทธิ์ผู้ใช้ทั่วไปเท่านั้น"
      actions={
        <Segmented
          label="สถานะคำขอ"
          value={status}
          onChange={(v) => setParams({ status: v })}
          options={[
            { value: 'PENDING', label: 'รออนุมัติ' },
            { value: 'APPROVED', label: 'อนุมัติแล้ว' },
            { value: 'REJECTED', label: 'ไม่อนุมัติ' },
          ]}
        />
      }
    >
      {load.state === 'error' && !load.data ? (
        <ErrorBox error={load.error} onRetry={load.reload} />
      ) : !load.data ? (
        <p aria-busy="true">กำลังโหลด…</p>
      ) : load.data.items.length === 0 ? (
        <p className="adm-empty">ไม่มีคำขอในสถานะนี้</p>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <caption className="sr-only">คำขอเข้าใช้งาน</caption>
            <thead>
              <tr>
                <th scope="col">ผู้ขอ</th>
                <th scope="col">LINE (ยืนยันแล้ว)</th>
                <th scope="col">ส่งเมื่อ</th>
                <th scope="col">ข้อความ</th>
                <th scope="col">ที่มา</th>
                <th scope="col">สถานะบัญชี</th>
                {status === 'PENDING' ? <th scope="col">ดำเนินการ</th> : null}
              </tr>
            </thead>
            <tbody>
              {load.data.items.map((r) => {
                const days = Math.floor((now - Date.parse(r.createdAt)) / 86_400_000);
                return (
                  <tr key={r.id}>
                    <td>
                      <span className="adm-avatar" aria-hidden>
                        {[...(r.user?.displayName ?? '?')][0]}
                      </span>
                      <span className="f-name">{r.user?.displayName ?? '—'}</span>
                    </td>
                    <td className="f-num">{r.maskedLineId ?? '—'}</td>
                    <td className="f-num">
                      {fireText(r.createdAt)}
                      {status === 'PENDING' && days >= 7 ? (
                        <span className="tag tag--muted">ค้าง {days} วัน</span>
                      ) : null}
                    </td>
                    <td className="adm-wrap">{r.message ?? '—'}</td>
                    <td>
                      {r.target
                        ? `ลิงก์เชิญ → ${r.target.workspaceName} (${r.target.role ? ROLE_TEXT[r.target.role] : '—'})`
                        : r.viaInvitation
                          ? 'ลิงก์เชิญ'
                          : 'ขอผ่านแอป'}
                    </td>
                    <td>{r.user ? STATUS_TEXT[r.user.status] : '—'}</td>
                    {status === 'PENDING' ? (
                      <td>
                        <div className="btn-row">
                          <Button
                            size="sm"
                            variant="dark"
                            icon={CircleCheck}
                            onClick={() => {
                              setAssign([]);
                              setApprove(r);
                            }}
                          >
                            ทบทวนและอนุมัติ
                          </Button>
                          <Button size="sm" icon={CircleX} onClick={() => setReject(r)}>
                            ไม่อนุมัติ
                          </Button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Confirm
        open={approve !== null}
        title="ทบทวนสิทธิ์ก่อนอนุมัติ"
        confirmLabel="อนุมัติ"
        busy={busy}
        error={error ? errorText(error) : null}
        onClose={() => setApprove(null)}
        onConfirm={async () => {
          if (!approve) return;
          const r = await run(() => api.approveRequest(approve.id, assign));
          if (r === undefined) return;
          setApprove(null);
          toast('อนุมัติแล้ว');
          await reloadMe();
          load.reload();
        }}
      >
        {approve ? (
          <div className="adm-review">
            <p>
              <span className="f-name">{approve.user?.displayName}</span> จะได้รับ:
            </p>
            <ul>
              <li>บทบาทระบบ: ผู้ใช้ทั่วไป (USER) — การเลื่อนเป็นผู้ดูแลระบบทำแยกต่างหากโดยเจ้าของระบบ</li>
              <li>พื้นที่ส่วนตัวของตัวเอง</li>
              {approve.target ? (
                <li>
                  จากลิงก์เชิญ: {approve.target.workspaceName} ·{' '}
                  {approve.target.role ? ROLE_TEXT[approve.target.role] : '—'}
                </li>
              ) : null}
            </ul>
            <p className="f-label">กลุ่มงานเพิ่มเติม (ไม่บังคับ)</p>
            <AssignmentsEditor value={assign} onChange={setAssign} />
          </div>
        ) : null}
      </Confirm>
      <Confirm
        open={reject !== null}
        title="ไม่อนุมัติคำขอนี้?"
        body={<p>ผู้ขอจะไม่ได้รับสิทธิ์ใช้งาน และส่งคำขอใหม่ได้ภายหลัง</p>}
        confirmLabel="ไม่อนุมัติ"
        danger
        busy={busy}
        error={error ? errorText(error) : null}
        onClose={() => setReject(null)}
        onConfirm={async () => {
          if (!reject) return;
          const r = await run(() => api.rejectRequest(reject.id));
          if (r === undefined) return;
          setReject(null);
          toast('บันทึกว่าไม่อนุมัติแล้ว', 'info');
          await reloadMe();
          load.reload();
        }}
      />
    </AdminPage>
  );
}

// ───────────────────────── users

export function UsersPage() {
  const { api } = useApp();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const status = params.get('status') ?? '';
  const role = params.get('role') ?? '';
  const workspaceId = params.get('workspaceId') ?? '';
  const offset = Number(params.get('offset') ?? 0) || 0;
  const [text, setText] = useState(q);
  const ws = useLoad(() => api.adminWorkspaces(), 'adm-ws-filter');
  const load = useLoad(
    () => api.users({ q, status, role, workspaceId, offset }),
    `adm-users|${q}|${status}|${role}|${workspaceId}|${offset}`,
  );
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    next.delete('offset');
    setParams(next);
  };
  return (
    <AdminPage
      title="ผู้ใช้"
      intro="ค้นหาด้วยชื่อที่แสดง กรองตามสถานะ บทบาท หรือกลุ่มงาน — ตัวกรองอยู่ใน URL จึงใช้ปุ่มย้อนกลับและแชร์ลิงก์ได้"
    >
      <form
        className="adm-filters"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setParam('q', text.trim());
        }}
      >
        <label className="adm-filter adm-filter--grow">
          <span className="f-label">ค้นหา</span>
          <span className="adm-search">
            <Search aria-hidden />
            <input
              className="f-input"
              value={text}
              maxLength={60}
              onChange={(e) => setText(e.target.value)}
              placeholder="ชื่อที่แสดง"
            />
          </span>
        </label>
        <label className="adm-filter">
          <span className="f-label">สถานะ</span>
          <select
            className="f-select"
            value={status}
            onChange={(e) => setParam('status', e.target.value)}
          >
            <option value="">ทั้งหมด</option>
            <option value="ACTIVE">ใช้งานได้</option>
            <option value="PENDING">รออนุมัติ</option>
            <option value="NEW">ยังไม่ส่งคำขอ</option>
            <option value="RESTRICTED">ระงับหรือเพิกถอน</option>
            <option value="SUSPENDED">ระงับชั่วคราว</option>
            <option value="REVOKED">เพิกถอนแล้ว</option>
            <option value="REJECTED">ไม่อนุมัติ</option>
          </select>
        </label>
        <label className="adm-filter">
          <span className="f-label">บทบาทระบบ</span>
          <select
            className="f-select"
            value={role}
            onChange={(e) => setParam('role', e.target.value)}
          >
            <option value="">ทั้งหมด</option>
            <option value="OWNER">เจ้าของระบบ</option>
            <option value="ADMIN">ผู้ดูแลระบบ</option>
            <option value="USER">ผู้ใช้</option>
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
        <Button type="submit" variant="dark" icon={Search}>
          ค้นหา
        </Button>
      </form>
      {load.state === 'error' && !load.data ? (
        <ErrorBox error={load.error} onRetry={load.reload} />
      ) : !load.data ? (
        <p aria-busy="true">กำลังโหลด…</p>
      ) : load.data.items.length === 0 ? (
        <p className="adm-empty">ไม่พบผู้ใช้ตามเงื่อนไข</p>
      ) : (
        <>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <caption className="sr-only">รายชื่อผู้ใช้</caption>
              <thead>
                <tr>
                  <th scope="col">ชื่อ</th>
                  <th scope="col">สถานะ</th>
                  <th scope="col">บทบาทระบบ</th>
                  <th scope="col">เข้าสู่ระบบล่าสุด</th>
                  <th scope="col">สมัครเมื่อ</th>
                </tr>
              </thead>
              <tbody>
                {load.data.items.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <Link to={`/admin/users/${u.id}`} className="adm-link f-name">
                        {u.displayName}
                      </Link>
                    </td>
                    <td>
                      <span className={`adm-status adm-status--${u.status.toLowerCase()}`}>
                        {STATUS_TEXT[u.status]}
                      </span>
                    </td>
                    <td>{GLOBAL_ROLE_TEXT[u.globalRole]}</td>
                    <td className="f-num">{u.lastLoginAt ? fireText(u.lastLoginAt) : '—'}</td>
                    <td className="f-num">{u.createdAt ? fireText(u.createdAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="adm-pager">
            <Button
              size="sm"
              disabled={offset === 0}
              onClick={() => {
                const n = new URLSearchParams(params);
                n.set('offset', String(Math.max(0, offset - 30)));
                setParams(n);
              }}
            >
              ก่อนหน้า
            </Button>
            <span className="f-num">
              ลำดับ {offset + 1}–{offset + load.data.items.length}
            </span>
            <Button
              size="sm"
              disabled={!load.data.hasMore}
              onClick={() => {
                const n = new URLSearchParams(params);
                n.set('offset', String(offset + 30));
                setParams(n);
              }}
            >
              ถัดไป
            </Button>
          </div>
        </>
      )}
    </AdminPage>
  );
}

// ───────────────────────── user detail & offboarding

type Pending =
  | { kind: 'status'; action: 'suspend' | 'reinstate' | 'revoke' }
  | { kind: 'reactivate' }
  | { kind: 'role'; role: 'ADMIN' | 'USER' }
  | { kind: 'remove'; workspaceId: string; name: string }
  | null;

export function UserDetailPage() {
  const { id = '' } = useParams();
  const { api, toast, me } = useApp();
  const load = useLoad(() => api.user(id), `adm-user|${id}`);
  const [pending, setPending] = useState<Pending>(null);
  const [assign, setAssign] = useState<{ workspaceId: string; role: Role }[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const sensitive = useSensitive();
  const close = () => {
    setPending(null);
    setError(null);
  };
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await sensitive.run(async () => {
        await fn();
        return true;
      });
      if (r) {
        close();
        toast(msg);
        load.reload();
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  if (load.state === 'error' && !load.data)
    return <ErrorBox error={load.error} onRetry={load.reload} />;
  if (!load.data) return <p aria-busy="true">กำลังโหลด…</p>;
  const d = load.data;
  const u = d.user;
  const can = d.can.administer;
  const isOwnerAccount = u.globalRole === 'OWNER';
  return (
    <AdminPage
      title={u.displayName}
      intro="การควบคุมการเข้าใช้งานของบัญชีนี้ — ทุกการเปลี่ยนแปลงถูกบันทึกในบันทึกความปลอดภัย"
    >
      {sensitive.dialog}
      <div className="adm-grid-2">
        <section className="adm-card">
          <h2 className="adm-card__title">บัญชี</h2>
          <dl className="adm-dl">
            <dt>สถานะ</dt>
            <dd>
              <span className={`adm-status adm-status--${u.status.toLowerCase()}`}>
                {STATUS_TEXT[u.status]}
              </span>
              {d.statusChangedAt ? (
                <span className="f-hint"> · ตั้งแต่ {fireText(d.statusChangedAt)}</span>
              ) : null}
            </dd>
            <dt>บทบาทระบบ</dt>
            <dd>{GLOBAL_ROLE_TEXT[u.globalRole]}</dd>
            <dt>LINE (ยืนยันแล้ว)</dt>
            <dd className="f-num">{d.maskedLineId ?? '—'}</dd>
            <dt>เข้าสู่ระบบล่าสุด</dt>
            <dd className="f-num">{u.lastLoginAt ? fireText(u.lastLoginAt) : '—'}</dd>
            <dt>เซสชันที่เปิดอยู่</dt>
            <dd className="f-num">{d.openSessions ?? '—'}</dd>
          </dl>
          {u.id === me.user.id ? (
            <Notice tone="info">นี่คือบัญชีของคุณ — เปลี่ยนสถานะหรือบทบาทของตัวเองไม่ได้</Notice>
          ) : null}
          {isOwnerAccount && u.id !== me.user.id ? (
            <Notice tone="info">บัญชีเจ้าของระบบได้รับการป้องกัน — ระบบไม่อนุญาตให้ระงับเจ้าของคนสุดท้าย</Notice>
          ) : null}
        </section>
        <section className="adm-card">
          <h2 className="adm-card__title">กลุ่มงาน ({d.memberships.length})</h2>
          {d.memberships.length ? (
            <ul className="adm-list">
              {d.memberships.map((m) => (
                <li key={m.workspaceId}>
                  <Link className="adm-link f-name" to={`/admin/workspaces/${m.workspaceId}`}>
                    {m.workspaceName}
                  </Link>
                  <span className="tag">{ROLE_TEXT[m.role]}</span>
                  {can ? (
                    <button
                      type="button"
                      className="link-btn link-btn--danger"
                      onClick={() =>
                        setPending({
                          kind: 'remove',
                          workspaceId: m.workspaceId,
                          name: m.workspaceName,
                        })
                      }
                    >
                      นำออกจากกลุ่มนี้
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="f-hint">ไม่มีกลุ่มงาน (มีเฉพาะพื้นที่ส่วนตัว ซึ่งผู้ดูแลระบบเปิดดูไม่ได้)</p>
          )}
        </section>
      </div>

      {can ? (
        <section className="adm-card adm-offboard">
          <h2 className="adm-card__title">ควบคุมการเข้าใช้งาน / พนักงานลาออก</h2>
          <ol className="adm-options">
            <li>
              <strong>ก. นำออกจากกลุ่มงานของบริษัทเท่านั้น</strong> — บัญชียังใช้ FLOW ได้ตามปกติ
              แต่จะไม่เห็นนัดหมายของกลุ่มนั้นอีกทันที (ใช้ “นำออกจากกลุ่มนี้” ด้านบน)
            </li>
            <li>
              <strong>ข. ระงับชั่วคราว</strong> — ออกจากระบบทุกอุปกรณ์ทันที เข้าใช้ไม่ได้จนกว่าจะคืนสิทธิ์
              กลุ่มงานยังคงอยู่ ไม่มีการแจ้งเตือนส่วนตัวถึงบัญชีนี้
            </li>
            <li>
              <strong>ค. เพิกถอนการเข้าใช้งาน</strong> — ออกจากระบบทันที นำออกจากทุกกลุ่มงาน
              ยกเลิกสิทธิ์ผู้ดูแลระบบและสิทธิ์ส่งไปกลุ่ม LINE การเปิดใช้อีกครั้งต้องทบทวนกลุ่มและบทบาทใหม่ทุกครั้ง
            </li>
          </ol>
          <Notice tone="caution">
            FLOW นำบุคคลออกจากแชตหรือกลุ่ม LINE ไม่ได้ และเรียกคืนข้อความที่ส่งไปแล้วไม่ได้ — การนำออกจากกลุ่ม LINE
            ต้องทำแยกในแอป LINE · นัดหมายของบริษัทที่บุคคลนี้สร้างไว้จะยังอยู่กับกลุ่มงานตามเดิม
          </Notice>
          <div className="btn-row">
            {u.status === 'ACTIVE' ? (
              <Button icon={Ban} onClick={() => setPending({ kind: 'status', action: 'suspend' })}>
                ข. ระงับชั่วคราว
              </Button>
            ) : null}
            {u.status === 'SUSPENDED' ? (
              <Button
                variant="dark"
                onClick={() => setPending({ kind: 'status', action: 'reinstate' })}
              >
                คืนสิทธิ์จากการระงับ
              </Button>
            ) : null}
            {['ACTIVE', 'SUSPENDED', 'PENDING', 'NEW'].includes(u.status) ? (
              <Button
                variant="danger"
                icon={UserX}
                onClick={() => setPending({ kind: 'status', action: 'revoke' })}
              >
                ค. เพิกถอนการเข้าใช้งาน
              </Button>
            ) : null}
            {['REVOKED', 'REJECTED'].includes(u.status) ? (
              <Button
                variant="dark"
                onClick={() => {
                  setAssign([]);
                  setPending({ kind: 'reactivate' });
                }}
              >
                ทบทวนสิทธิ์และเปิดใช้งานอีกครั้ง
              </Button>
            ) : null}
          </div>
        </section>
      ) : (
        <Notice tone="info">บัญชีนี้จัดการโดยเจ้าของระบบเท่านั้น หรือเป็นบัญชีของคุณเอง</Notice>
      )}

      {d.can.changeRole ? (
        <section className="adm-card">
          <h2 className="adm-card__title">บทบาทระบบ (เฉพาะเจ้าของระบบ)</h2>
          <p className="f-hint">
            ผู้ดูแลระบบอนุมัติคำขอและจัดการกลุ่มของผู้ใช้ทั่วไปได้ แต่ไม่เห็นนัดหมายของใคร
            และไม่สามารถตั้งเจ้าของระบบหรือผู้ดูแลคนอื่นได้
          </p>
          {u.globalRole === 'USER' ? (
            <Button onClick={() => setPending({ kind: 'role', role: 'ADMIN' })}>
              เลื่อนเป็นผู้ดูแลระบบ
            </Button>
          ) : u.globalRole === 'ADMIN' ? (
            <Button icon={UserMinus} onClick={() => setPending({ kind: 'role', role: 'USER' })}>
              ลดเป็นผู้ใช้ทั่วไป
            </Button>
          ) : null}
        </section>
      ) : null}

      <section className="adm-card">
        <h2 className="adm-card__title">ประวัติบัญชี</h2>
        {d.history.length ? (
          <ol className="timeline">
            {d.history.map((h, i) => (
              <li key={i}>
                <span className="f-name">{AUDIT_TEXT[h.action] ?? h.action}</span>
                <span className="f-hint f-num">{fireText(h.at)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="f-hint">ยังไม่มีประวัติ</p>
        )}
      </section>

      <Confirm
        open={pending?.kind === 'status'}
        title={
          pending?.kind === 'status'
            ? pending.action === 'suspend'
              ? 'ระงับบัญชีชั่วคราว?'
              : pending.action === 'reinstate'
                ? 'คืนสิทธิ์บัญชีนี้?'
                : 'เพิกถอนการเข้าใช้งาน?'
            : ''
        }
        body={
          <p>
            {pending?.kind === 'status' && pending.action === 'suspend'
              ? 'ทุกเซสชันจะสิ้นสุดทันที เข้าใช้งานไม่ได้จนกว่าจะคืนสิทธิ์ กลุ่มงานยังเก็บไว้'
              : pending?.kind === 'status' && pending.action === 'reinstate'
                ? 'บัญชีจะกลับมาใช้งานได้พร้อมกลุ่มงานเดิม'
                : 'ทุกเซสชันจะสิ้นสุดทันที นำออกจากทุกกลุ่มงาน ยกเลิกสิทธิ์ผู้ดูแลระบบและสิทธิ์ส่งไปกลุ่ม LINE — นัดหมายของกลุ่มงานยังอยู่ และไม่มีการลบข้อมูลอัตโนมัติ'}
          </p>
        }
        confirmLabel="ยืนยัน"
        danger={pending?.kind === 'status' && pending.action !== 'reinstate'}
        busy={busy}
        error={error ? errorText(error) : null}
        onClose={close}
        onConfirm={() =>
          pending?.kind === 'status' &&
          void act(() => api.setUserStatus(u.id, pending.action), 'บันทึกแล้ว')
        }
      />
      <Confirm
        open={pending?.kind === 'reactivate'}
        title="ทบทวนสิทธิ์ก่อนเปิดใช้งานอีกครั้ง"
        body={
          <p>สิทธิ์เดิมจะไม่ถูกคืนอัตโนมัติ — เลือกเฉพาะกลุ่มงานและบทบาทที่ต้องการให้ตอนนี้ บทบาทระบบจะเป็นผู้ใช้ทั่วไป</p>
        }
        confirmLabel="เปิดใช้งาน"
        busy={busy}
        error={error ? errorText(error) : null}
        onClose={close}
        onConfirm={() => void act(() => api.reactivateUser(u.id, assign), 'เปิดใช้งานแล้ว')}
      >
        <AssignmentsEditor value={assign} onChange={setAssign} />
      </Confirm>
      <Confirm
        open={pending?.kind === 'role'}
        title={
          pending?.kind === 'role' && pending.role === 'ADMIN'
            ? 'เลื่อนเป็นผู้ดูแลระบบ?'
            : 'ลดเป็นผู้ใช้ทั่วไป?'
        }
        body={<p>การเปลี่ยนบทบาทระบบมีผลทันทีกับทุกเซสชันของผู้ใช้นี้</p>}
        confirmLabel="ยืนยัน"
        busy={busy}
        error={error ? errorText(error) : null}
        onClose={close}
        onConfirm={() =>
          pending?.kind === 'role' &&
          void act(() => api.setGlobalRole(u.id, pending.role), 'เปลี่ยนบทบาทแล้ว')
        }
      />
      <Confirm
        open={pending?.kind === 'remove'}
        title="นำออกจากกลุ่มงานนี้?"
        body={
          <p>
            {pending?.kind === 'remove' ? <span className="f-name">{pending.name}</span> : null} —
            บัญชียังใช้ FLOW ได้ แต่จะไม่เห็นนัดหมายของกลุ่มนี้อีกทันที นัดหมายที่สร้างไว้ยังอยู่กับกลุ่ม
          </p>
        }
        confirmLabel="นำออก"
        danger
        busy={busy}
        error={error ? errorText(error) : null}
        onClose={close}
        onConfirm={() =>
          pending?.kind === 'remove' &&
          void act(() => api.setMembership(u.id, pending.workspaceId, null), 'นำออกจากกลุ่มแล้ว')
        }
      />
    </AdminPage>
  );
}

/**
 * Mobile Owner Console (global OWNER / ADMIN). Everything here is re-authorized by the server;
 * a global admin sees fewer actions (no role changes, no LINE groups). Appointment content
 * never appears here — not in lists, details or the audit trail.
 */
import { useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router';
import {
  ChevronRight,
  CircleCheck,
  CircleX,
  Copy,
  Link2,
  MessageCircle,
  ScrollText,
  ShieldCheck,
  UserCheck,
  Users,
} from '../../../components/icons';
import { Button, Notice } from '../../../components/ui';
import { LineStatusPanel } from '../../../auth/AuthScreen';
import type { AccessRequestDto, AdminDestinationDto, Role } from '../../api';
import {
  errorText,
  GLOBAL_ROLE_TEXT,
  KIND_TEXT,
  ROLE_TEXT,
  STATUS_TEXT,
  TZ,
  useAction,
  useApp,
  useLoad,
} from '../../core';
import { Confirm, Empty, Field, Loaded, Page, Segmented } from '../../ui';

const at = (iso: string) =>
  new Date(iso).toLocaleString('th-TH', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' });

export default function OwnerConsole() {
  return (
    <Routes>
      <Route index element={<Home />} />
      <Route path="requests" element={<Requests />} />
      <Route path="users" element={<UsersList />} />
      <Route path="users/:id" element={<UserDetail />} />
      <Route path="invitations" element={<Invitations />} />
      <Route path="groups" element={<LineGroups />} />
      <Route path="audit" element={<Audit />} />
    </Routes>
  );
}

function Home() {
  const { api, me } = useApp();
  const load = useLoad(() => api.adminSummary(), 'admin-summary');
  const tile = (to: string, n: number | string, label: string, hot = false) => (
    <Link to={to} className={`tile${hot ? ' tile--hot' : ''}`}>
      <span className="tile__n f-num">{n}</span>
      <span className="tile__l">{label}</span>
    </Link>
  );
  return (
    <Page title="คอนโซลเจ้าของระบบ" back="/settings">
      <p className="f-hint">
        <ShieldCheck aria-hidden className="inline-icon" /> {GLOBAL_ROLE_TEXT[me.user.globalRole]} ·
        คอนโซลนี้ไม่แสดงรายละเอียดนัดหมายของใคร
      </p>
      <Loaded load={load} skeleton={2}>
        {(s) => (
          <div className="tiles">
            {tile('/owner/requests', s.pendingRequests, 'คำขอรออนุมัติ', s.pendingRequests > 0)}
            {tile('/owner/users', s.users.active, 'ผู้ใช้ที่ใช้งานได้')}
            {tile('/owner/users?status=SUSPENDED', s.users.suspended, 'ถูกระงับ')}
            {me.permissions.manageDestinations
              ? tile('/owner/groups', s.pendingGroups, 'กลุ่ม LINE รอลงทะเบียน', s.pendingGroups > 0)
              : null}
          </div>
        )}
      </Loaded>
      <div className="stack">
        <NavRow to="/owner/requests" icon={UserCheck} title="คำขอใช้งาน" />
        <NavRow to="/owner/users" icon={Users} title="ผู้ใช้ทั้งหมด" />
        <NavRow to="/owner/invitations" icon={Link2} title="ลิงก์เชิญ" />
        {me.permissions.manageDestinations ? (
          <NavRow to="/owner/groups" icon={MessageCircle} title="กลุ่ม LINE" />
        ) : null}
        <NavRow to="/owner/audit" icon={ScrollText} title="บันทึกการตรวจสอบ" />
      </div>
      {me.user.globalRole === 'OWNER' ? <LineStatusPanel check={api.lineStatus} /> : null}
    </Page>
  );
}

function NavRow({ to, icon: Icon, title }: { to: string; icon: typeof Users; title: string }) {
  return (
    <Link to={to} className="row-card">
      <span className="row-card__icon" aria-hidden>
        <Icon />
      </span>
      <span className="row-card__body">
        <span className="row-card__title">{title}</span>
      </span>
      <ChevronRight aria-hidden />
    </Link>
  );
}

// ───────────────────────── access requests

function Requests() {
  const { api, reloadMe, toast } = useApp();
  const [status, setStatus] = useState<'PENDING' | 'APPROVED' | 'REJECTED'>('PENDING');
  const [q, setQ] = useState('');
  const load = useLoad(() => api.accessRequests(status), `req|${status}`);
  const spaces = useLoad(() => api.adminWorkspaces(), 'admin-ws');
  const [dialog, setDialog] = useState<{ kind: 'approve' | 'reject'; r: AccessRequestDto } | null>(
    null,
  );
  const [assign, setAssign] = useState<{ workspaceId: string; role: Role }[]>([]);
  const [run, busy, error] = useAction();
  const finish = async (msg: string) => {
    setDialog(null);
    toast(msg);
    load.reload();
    await reloadMe();
  };
  return (
    <Page title="คำขอใช้งาน" back="/owner">
      <Segmented
        label="สถานะคำขอ"
        value={status}
        onChange={setStatus}
        options={[
          { value: 'PENDING', label: 'รออนุมัติ' },
          { value: 'APPROVED', label: 'อนุมัติแล้ว' },
          { value: 'REJECTED', label: 'ไม่อนุมัติ' },
        ]}
      />
      <input
        className="f-input"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="ค้นหาชื่อ"
        aria-label="ค้นหาชื่อ"
      />
      <Loaded load={load}>
        {(d) => {
          const items = d.items.filter(
            (r) => !q || (r.user?.displayName ?? '').toLowerCase().includes(q.toLowerCase()),
          );
          if (!items.length)
            return <Empty title={status === 'PENDING' ? 'ไม่มีคำขอรออนุมัติ' : 'ไม่มีรายการ'} />;
          return (
            <ul className="req-list">
              {items.map((r) => (
                <li key={r.id} className="req">
                  <div className="req__who">
                    <span className="f-name req__name">{r.user?.displayName ?? '—'}</span>
                    <span className="f-hint f-num">{at(r.createdAt)}</span>
                  </div>
                  {r.message ? <p className="req__msg f-name">“{r.message}”</p> : null}
                  {r.target ? (
                    <p className="f-hint">
                      ผ่านลิงก์เชิญ: <span className="f-name">{r.target.workspaceName}</span> ·{' '}
                      {r.target.role ? ROLE_TEXT[r.target.role] : ''}
                    </p>
                  ) : null}
                  {r.status === 'PENDING' ? (
                    <div className="req__act">
                      <Button
                        size="sm"
                        variant="dark"
                        icon={CircleCheck}
                        onClick={() => {
                          setAssign([]);
                          setDialog({ kind: 'approve', r });
                        }}
                      >
                        อนุมัติ
                      </Button>
                      <Button
                        size="sm"
                        icon={CircleX}
                        onClick={() => setDialog({ kind: 'reject', r })}
                      >
                        ไม่อนุมัติ
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          );
        }}
      </Loaded>
      <Confirm
        open={dialog?.kind === 'approve'}
        title={`อนุมัติ ${dialog?.r.user?.displayName ?? ''}?`}
        body={
          <p>
            ผู้ใช้จะได้กลุ่มส่วนตัวและแชตส่วนตัวอัตโนมัติ
            {dialog?.r.target ? ` และเข้ากลุ่ม “${dialog.r.target.workspaceName}” ตามลิงก์เชิญ` : ''} ·
            ไม่ได้รับสิทธิ์ผู้ดูแลระบบ
          </p>
        }
        confirmLabel="อนุมัติ"
        busy={busy}
        error={error ? errorText(error) : null}
        onClose={() => setDialog(null)}
        onConfirm={async () => {
          if (!dialog) return;
          if (await run(() => api.approveRequest(dialog.r.id, assign))) await finish('อนุมัติแล้ว');
        }}
      >
        <fieldset className="fs">
          <legend className="f-label">เพิ่มเข้ากลุ่ม (ไม่บังคับ)</legend>
          {(spaces.data?.items ?? []).map((w) => {
            const cur = assign.find((a) => a.workspaceId === w.id);
            return (
              <div key={w.id} className="assign">
                <label className="pick">
                  <input
                    type="checkbox"
                    checked={!!cur}
                    onChange={() =>
                      setAssign(
                        cur
                          ? assign.filter((a) => a.workspaceId !== w.id)
                          : [...assign, { workspaceId: w.id, role: 'MEMBER' }],
                      )
                    }
                  />
                  <span className="f-name">{w.name}</span>
                  <span className="f-hint">{KIND_TEXT[w.kind]}</span>
                </label>
                {cur ? (
                  <select
                    className="f-select"
                    aria-label={`บทบาทใน ${w.name}`}
                    value={cur.role}
                    onChange={(e) =>
                      setAssign(
                        assign.map((a) =>
                          a.workspaceId === w.id ? { ...a, role: e.target.value as Role } : a,
                        ),
                      )
                    }
                  >
                    <option value="MEMBER">{ROLE_TEXT.MEMBER}</option>
                    <option value="VIEWER">{ROLE_TEXT.VIEWER}</option>
                    <option value="ADMIN">{ROLE_TEXT.ADMIN}</option>
                  </select>
                ) : null}
              </div>
            );
          })}
        </fieldset>
      </Confirm>
      <Confirm
        open={dialog?.kind === 'reject'}
        title={`ไม่อนุมัติ ${dialog?.r.user?.displayName ?? ''}?`}
        body={<p>ผู้ใช้จะเห็นว่าคำขอยังไม่ได้รับอนุมัติ และส่งคำขอใหม่ได้</p>}
        confirmLabel="ไม่อนุมัติ"
        danger
        busy={busy}
        error={error ? errorText(error) : null}
        onClose={() => setDialog(null)}
        onConfirm={async () => {
          if (!dialog) return;
          if (await run(() => api.rejectRequest(dialog.r.id))) await finish('บันทึกแล้ว');
        }}
      />
    </Page>
  );
}

// ───────────────────────── users

function UsersList() {
  const { api } = useApp();
  const initial = new URLSearchParams(window.location.search).get('status') ?? '';
  const [status, setStatus] = useState(initial);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const load = useLoad(
    () => api.users({ ...(status ? { status } : {}), ...(q ? { q } : {}) }),
    `users|${status}|${q}`,
  );
  return (
    <Page title="ผู้ใช้ทั้งหมด" back="/owner">
      <form
        className="searchbar"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(text.trim());
        }}
      >
        <input
          className="f-input"
          type="search"
          value={text}
          maxLength={60}
          onChange={(e) => setText(e.target.value)}
          placeholder="ค้นหาชื่อ"
          aria-label="ค้นหาชื่อ"
        />
        <select
          className="f-select"
          aria-label="สถานะ"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">ทุกสถานะ</option>
          {Object.entries(STATUS_TEXT).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" variant="dark">
          ค้นหา
        </Button>
      </form>
      <Loaded load={load}>
        {(d) =>
          d.items.length ? (
            <div className="stack">
              {d.items.map((u) => (
                <Link key={u.id} to={`/owner/users/${u.id}`} className="row-card">
                  <span className="row-card__body">
                    <span className="row-card__title f-name">{u.displayName}</span>
                    <span className="f-hint">
                      {STATUS_TEXT[u.status]} · {GLOBAL_ROLE_TEXT[u.globalRole]}
                    </span>
                  </span>
                  <ChevronRight aria-hidden />
                </Link>
              ))}
            </div>
          ) : (
            <Empty title="ไม่พบผู้ใช้" />
          )
        }
      </Loaded>
    </Page>
  );
}

type UserAction = 'suspend' | 'reinstate' | 'revoke' | 'reactivate';
const ACTION_TEXT: Record<UserAction, { label: string; body: string; danger: boolean }> = {
  suspend: {
    label: 'ระงับชั่วคราว',
    body: 'ผู้ใช้จะออกจากระบบทันทีทุกอุปกรณ์ ข้อมูลยังอยู่ครบ และเปิดใช้งานคืนได้',
    danger: true,
  },
  reinstate: {
    label: 'เปิดใช้งานคืน',
    body: 'ผู้ใช้กลับมาใช้งานได้ตามกลุ่มและบทบาทเดิม',
    danger: false,
  },
  revoke: {
    label: 'เพิกถอนสิทธิ์',
    body: 'ผู้ใช้จะออกจากระบบทันทีและใช้งานไม่ได้อีก จนกว่าจะเปิดใช้งานใหม่',
    danger: true,
  },
  reactivate: { label: 'เปิดใช้งานใหม่', body: 'ผู้ใช้กลับมาใช้งานได้อีกครั้ง', danger: false },
};

function UserDetail() {
  const { id = '' } = useParams();
  const { api, me, toast } = useApp();
  const load = useLoad(() => api.user(id), `user|${id}`);
  const spaces = useLoad(() => api.adminWorkspaces(), 'admin-ws');
  const [dialog, setDialog] = useState<
    | { kind: 'status'; action: UserAction }
    | { kind: 'role'; to: 'ADMIN' | 'USER' }
    | { kind: 'member'; workspaceId: string; name: string; role: Role | null }
    | null
  >(null);
  const [role, setRole] = useState<Role>('MEMBER');
  const [addWs, setAddWs] = useState('');
  const [run, busy, error] = useAction();
  const navigate = useNavigate();
  const finish = (msg: string) => {
    setDialog(null);
    toast(msg);
    load.reload();
  };
  return (
    <Page title="ผู้ใช้" back="/owner/users">
      <Loaded load={load}>
        {(d) => {
          const u = d.user;
          const actions: UserAction[] =
            u.status === 'ACTIVE'
              ? ['suspend', 'revoke']
              : u.status === 'SUSPENDED'
                ? ['reinstate', 'revoke']
                : u.status === 'REVOKED'
                  ? ['reactivate']
                  : [];
          const notIn = (spaces.data?.items ?? []).filter(
            (w) => !d.memberships.some((m) => m.workspaceId === w.id),
          );
          return (
            <>
              <div className="account">
                <p className="account__name f-name">{u.displayName}</p>
                <p className="f-hint">
                  {STATUS_TEXT[u.status]} · {GLOBAL_ROLE_TEXT[u.globalRole]}
                  {u.createdAt ? ` · เริ่มใช้ ${at(u.createdAt)}` : ''}
                </p>
              </div>
              {u.status === 'PENDING' ? (
                <Notice tone="info">
                  ผู้ใช้รออนุมัติ —{' '}
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => navigate('/owner/requests')}
                  >
                    ไปที่คำขอใช้งาน
                  </button>
                </Notice>
              ) : null}
              {u.id === me.user.id ? (
                <Notice tone="info">นี่คือบัญชีของคุณ — เปลี่ยนสถานะหรือสิทธิ์ของตัวเองไม่ได้</Notice>
              ) : null}
              {d.can.administer && actions.length ? (
                <div className="btn-row">
                  {actions.map((a) => (
                    <Button
                      key={a}
                      variant={ACTION_TEXT[a].danger ? 'danger' : 'dark'}
                      size="sm"
                      onClick={() => setDialog({ kind: 'status', action: a })}
                    >
                      {ACTION_TEXT[a].label}
                    </Button>
                  ))}
                </div>
              ) : null}
              {d.can.changeRole && u.globalRole !== 'OWNER' ? (
                <div className="btn-row">
                  <Button
                    size="sm"
                    onClick={() =>
                      setDialog({ kind: 'role', to: u.globalRole === 'ADMIN' ? 'USER' : 'ADMIN' })
                    }
                  >
                    {u.globalRole === 'ADMIN' ? 'ยกเลิกสิทธิ์ผู้ดูแลระบบ' : 'แต่งตั้งเป็นผู้ดูแลระบบ'}
                  </Button>
                </div>
              ) : null}

              <h3 className="section-title">กลุ่ม</h3>
              {d.memberships.length ? (
                <ul className="member-list">
                  {d.memberships.map((m) => (
                    <li key={m.workspaceId}>
                      <span className="f-name member-list__name">{m.workspaceName}</span>
                      <span className="tag">{ROLE_TEXT[m.role]}</span>
                      {d.can.administer ? (
                        <span className="member-list__act">
                          <button
                            type="button"
                            className="link-btn"
                            onClick={() => {
                              setRole(m.role);
                              setDialog({
                                kind: 'member',
                                workspaceId: m.workspaceId,
                                name: m.workspaceName,
                                role: m.role,
                              });
                            }}
                          >
                            เปลี่ยน
                          </button>
                          <button
                            type="button"
                            className="link-btn link-btn--danger"
                            onClick={() =>
                              setDialog({
                                kind: 'member',
                                workspaceId: m.workspaceId,
                                name: m.workspaceName,
                                role: null,
                              })
                            }
                          >
                            นำออก
                          </button>
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="f-hint">ยังไม่ได้อยู่ในกลุ่มใด (นอกจากกลุ่มส่วนตัว)</p>
              )}
              {d.can.administer && u.status === 'ACTIVE' && notIn.length ? (
                <div className="grid-3">
                  <select
                    className="f-select"
                    aria-label="เพิ่มเข้ากลุ่ม"
                    value={addWs}
                    onChange={(e) => setAddWs(e.target.value)}
                  >
                    <option value="">เพิ่มเข้ากลุ่ม…</option>
                    {notIn.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                  <select
                    className="f-select"
                    aria-label="บทบาท"
                    value={role}
                    onChange={(e) => setRole(e.target.value as Role)}
                  >
                    <option value="MEMBER">{ROLE_TEXT.MEMBER}</option>
                    <option value="VIEWER">{ROLE_TEXT.VIEWER}</option>
                    <option value="ADMIN">{ROLE_TEXT.ADMIN}</option>
                  </select>
                  <Button
                    size="sm"
                    disabled={!addWs}
                    busy={busy && dialog === null}
                    onClick={async () => {
                      if (await run(() => api.setMembership(u.id, addWs, role))) {
                        setAddWs('');
                        finish('เพิ่มเข้ากลุ่มแล้ว');
                      }
                    }}
                  >
                    เพิ่ม
                  </Button>
                </div>
              ) : null}

              <h3 className="section-title">ประวัติ</h3>
              {d.history.length ? (
                <ol className="timeline">
                  {d.history.map((h, i) => (
                    <li key={i}>
                      <span>{h.action}</span>
                      <span className="f-hint f-num">{at(h.at)}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="f-hint">ยังไม่มีประวัติ</p>
              )}

              <Confirm
                open={dialog?.kind === 'status'}
                title={
                  dialog?.kind === 'status'
                    ? `${ACTION_TEXT[dialog.action].label} ${u.displayName}?`
                    : ''
                }
                body={dialog?.kind === 'status' ? <p>{ACTION_TEXT[dialog.action].body}</p> : null}
                confirmLabel={dialog?.kind === 'status' ? ACTION_TEXT[dialog.action].label : ''}
                danger={dialog?.kind === 'status' && ACTION_TEXT[dialog.action].danger}
                busy={busy}
                error={error ? errorText(error) : null}
                onClose={() => setDialog(null)}
                onConfirm={async () => {
                  if (dialog?.kind !== 'status') return;
                  if (await run(() => api.setUserStatus(u.id, dialog.action))) finish('บันทึกแล้ว');
                }}
              />
              <Confirm
                open={dialog?.kind === 'role'}
                title={
                  dialog?.kind === 'role' && dialog.to === 'ADMIN'
                    ? 'แต่งตั้งเป็นผู้ดูแลระบบ?'
                    : 'ยกเลิกสิทธิ์ผู้ดูแลระบบ?'
                }
                body={
                  <p>
                    ผู้ดูแลระบบอนุมัติคำขอ จัดการผู้ใช้ทั่วไป และสร้างลิงก์เชิญได้ แต่เปลี่ยนสิทธิ์ระดับระบบ จัดการกลุ่ม LINE
                    หรือแตะบัญชีเจ้าของระบบไม่ได้ และไม่เห็นนัดหมายส่วนตัวของใคร
                  </p>
                }
                confirmLabel="ยืนยัน"
                busy={busy}
                error={error ? errorText(error) : null}
                onClose={() => setDialog(null)}
                onConfirm={async () => {
                  if (dialog?.kind !== 'role') return;
                  if (await run(() => api.setGlobalRole(u.id, dialog.to))) finish('บันทึกแล้ว');
                }}
              />
              <Confirm
                open={dialog?.kind === 'member'}
                title={
                  dialog?.kind === 'member'
                    ? dialog.role === null
                      ? `นำออกจาก ${dialog.name}?`
                      : `บทบาทใน ${dialog.name}`
                    : ''
                }
                confirmLabel={dialog?.kind === 'member' && dialog.role === null ? 'นำออก' : 'บันทึก'}
                danger={dialog?.kind === 'member' && dialog.role === null}
                busy={busy}
                error={error ? errorText(error) : null}
                onClose={() => setDialog(null)}
                onConfirm={async () => {
                  if (dialog?.kind !== 'member') return;
                  if (
                    await run(() =>
                      api.setMembership(
                        u.id,
                        dialog.workspaceId,
                        dialog.role === null ? null : role,
                      ),
                    )
                  )
                    finish('บันทึกแล้ว');
                }}
              >
                {dialog?.kind === 'member' && dialog.role !== null ? (
                  <Segmented
                    label="บทบาท"
                    value={role}
                    onChange={setRole}
                    options={[
                      { value: 'ADMIN', label: ROLE_TEXT.ADMIN },
                      { value: 'MEMBER', label: ROLE_TEXT.MEMBER },
                      { value: 'VIEWER', label: ROLE_TEXT.VIEWER },
                    ]}
                  />
                ) : null}
              </Confirm>
            </>
          );
        }}
      </Loaded>
    </Page>
  );
}

// ───────────────────────── invitations

/** Also embedded by the desktop Administration Center (/admin). */
export function Invitations() {
  const { api, toast } = useApp();
  const load = useLoad(() => api.invitations(), 'invitations');
  const spaces = useLoad(() => api.adminWorkspaces(), 'admin-ws');
  const [ws, setWs] = useState('');
  const [role, setRole] = useState<Role>('MEMBER');
  const [hours, setHours] = useState(24);
  const [note, setNote] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const [revoke, setRevoke] = useState<string | null>(null);
  const [run, busy, error] = useAction();
  const STATE = {
    valid: 'ใช้ได้',
    used: 'ใช้แล้ว',
    revoked: 'ยกเลิกแล้ว',
    expired: 'หมดอายุ',
  } as const;
  return (
    <Page title="ลิงก์เชิญ" back="/owner">
      <form
        className="form card-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await run(() => api.createInvitation(ws, role, hours, note.trim() || null));
          if (r) {
            setLink(r.link);
            setNote('');
            load.reload();
          }
        }}
      >
        <Field label="กลุ่ม">
          <select className="f-select" value={ws} onChange={(e) => setWs(e.target.value)} required>
            <option value="">— เลือก —</option>
            {(spaces.data?.items ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid-2">
          <Field label="บทบาท">
            <select
              className="f-select"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              <option value="MEMBER">{ROLE_TEXT.MEMBER}</option>
              <option value="VIEWER">{ROLE_TEXT.VIEWER}</option>
              <option value="ADMIN">{ROLE_TEXT.ADMIN}</option>
            </select>
          </Field>
          <Field label="หมดอายุใน">
            <select
              className="f-select"
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
            >
              <option value={1}>1 ชั่วโมง</option>
              <option value={24}>24 ชั่วโมง</option>
              <option value={72}>3 วัน</option>
              <option value={168}>7 วัน</option>
            </select>
          </Field>
        </div>
        <Field label="โน้ตสำหรับคุณ (ไม่บังคับ)" hint="ผู้รับเชิญไม่เห็นโน้ตนี้">
          <input
            className="f-input"
            maxLength={80}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        {error ? <Notice tone="caution">{errorText(error)}</Notice> : null}
        <Button type="submit" variant="dark" busy={busy} disabled={!ws}>
          สร้างลิงก์เชิญ
        </Button>
      </form>
      {link ? (
        <div className="once" role="alert">
          <p className="f-label">ลิงก์นี้แสดงครั้งเดียว — คัดลอกแล้วส่งให้ผู้รับเชิญทาง LINE</p>
          <code className="once__link">{link}</code>
          <div className="btn-row">
            <Button
              size="sm"
              icon={Copy}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link);
                  toast('คัดลอกแล้ว');
                } catch {
                  toast('คัดลอกไม่ได้ — กดค้างที่ลิงก์เพื่อคัดลอก', 'caution');
                }
              }}
            >
              คัดลอก
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setLink(null)}>
              ซ่อน
            </Button>
          </div>
          <p className="f-hint">ใช้ได้ครั้งเดียว · ผู้ใช้ต้องได้รับอนุมัติก่อนเข้ากลุ่ม · ไม่ให้สิทธิ์ผู้ดูแลระบบ</p>
        </div>
      ) : null}
      <h3 className="section-title">ลิงก์ที่สร้างไว้</h3>
      <Loaded load={load}>
        {(d) =>
          d.items.length ? (
            <ul className="member-list">
              {d.items.map((i) => (
                <li key={i.id}>
                  <span className="member-list__name">
                    <span className="f-name">{i.workspaceName}</span> · {ROLE_TEXT[i.role]}
                    {i.note ? <span className="f-hint"> · {i.note}</span> : null}
                    <span className="f-hint f-num"> · หมดอายุ {at(i.expiresAt)}</span>
                  </span>
                  <span className="tag">{STATE[i.state]}</span>
                  {i.state === 'valid' ? (
                    <button
                      type="button"
                      className="link-btn link-btn--danger"
                      onClick={() => setRevoke(i.id)}
                    >
                      ยกเลิก
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="ยังไม่มีลิงก์เชิญ" />
          )
        }
      </Loaded>
      <Confirm
        open={revoke !== null}
        title="ยกเลิกลิงก์เชิญนี้?"
        body={<p>ลิงก์จะใช้ไม่ได้ทันที</p>}
        confirmLabel="ยกเลิกลิงก์"
        danger
        busy={busy}
        error={error ? errorText(error) : null}
        onClose={() => setRevoke(null)}
        onConfirm={async () => {
          if (!revoke) return;
          if (await run(() => api.revokeInvitation(revoke))) {
            setRevoke(null);
            toast('ยกเลิกลิงก์แล้ว');
            load.reload();
          }
        }}
      />
    </Page>
  );
}

// ───────────────────────── LINE groups (owner only)

/** Also embedded by the desktop Administration Center (/admin). */
export function LineGroups() {
  const { api, me, reloadMe, toast } = useApp();
  const load = useLoad(() => api.adminDestinations(), 'admin-dest');
  const spaces = useLoad(() => api.adminWorkspaces(), 'admin-ws');
  const [edit, setEdit] = useState<AdminDestinationDto | null>(null);
  const [form, setForm] = useState<{
    label: string;
    workspaceId: string;
    status: 'ACTIVE' | 'DISABLED';
    audienceSize: string;
  }>({ label: '', workspaceId: '', status: 'ACTIVE', audienceSize: '' });
  const [run, busy, error] = useAction();
  if (!me.permissions.manageDestinations)
    return (
      <Page title="กลุ่ม LINE" back="/owner">
        <Notice tone="info">เฉพาะเจ้าของระบบ</Notice>
      </Page>
    );
  const STATE = {
    PENDING: 'รอลงทะเบียน',
    ACTIVE: 'ใช้งาน',
    DISABLED: 'ปิดอยู่',
    REMOVED: 'บอทถูกนำออก',
  } as const;
  return (
    <Page title="กลุ่ม LINE" back="/owner">
      <Notice tone="info">
        กลุ่มจะปรากฏที่นี่เมื่อมีคนเชิญบอท FLOW เข้ากลุ่ม LINE การเข้ากลุ่มเองไม่ให้สิทธิ์ใด ๆ — ต้องผูกกับกลุ่มใน FLOW ก่อน
        ผู้ดูแลกลุ่มนั้นจึงส่งแจ้งเตือนเข้าได้ (ยังไม่มีการส่งข้อความจริง)
      </Notice>
      <Loaded load={load}>
        {(d) =>
          d.items.length ? (
            <ul className="req-list">
              {d.items.map((g) => (
                <li key={g.id} className="req">
                  <div className="req__who">
                    <span className="f-name req__name">{g.label}</span>
                    <span className="tag">{STATE[g.status]}</span>
                  </div>
                  <p className="f-hint">
                    {g.workspaceId
                      ? `ผูกกับ: ${spaces.data?.items.find((w) => w.id === g.workspaceId)?.name ?? '—'}`
                      : 'ยังไม่ได้ผูกกับกลุ่มใน FLOW'}
                    {g.audienceSize ? ` · ~${g.audienceSize} คน` : ''} · สิทธิ์ส่งเพิ่มเติม {g.grantCount}{' '}
                    คน
                  </p>
                  {g.status !== 'REMOVED' ? (
                    <div className="req__act">
                      <Button
                        size="sm"
                        variant={g.status === 'PENDING' ? 'dark' : 'secondary'}
                        onClick={() => {
                          setForm({
                            label: g.label,
                            workspaceId: g.workspaceId ?? '',
                            status: g.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE',
                            audienceSize: g.audienceSize ? String(g.audienceSize) : '',
                          });
                          setEdit(g);
                        }}
                      >
                        {g.status === 'PENDING' ? 'ลงทะเบียน' : 'ตั้งค่า'}
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="ยังไม่มีกลุ่ม LINE" body="เชิญบอทเข้ากลุ่ม LINE ก่อน แล้วกลุ่มจะแสดงที่นี่" />
          )
        }
      </Loaded>
      <Confirm
        open={edit !== null}
        title="ตั้งค่ากลุ่ม LINE"
        confirmLabel="บันทึก"
        busy={busy}
        error={error ? errorText(error) : null}
        onClose={() => setEdit(null)}
        onConfirm={async () => {
          if (!edit) return;
          const size = form.audienceSize ? Number(form.audienceSize) : null;
          const ok = await run(() =>
            api.configureDestination(edit.id, {
              label: form.label.trim(),
              workspaceId: form.workspaceId || null,
              status: form.status,
              audienceSize: size && Number.isInteger(size) ? size : null,
            }),
          );
          if (ok) {
            setEdit(null);
            toast('บันทึกแล้ว');
            load.reload();
            await reloadMe();
          }
        }}
      >
        <Field label="ชื่อที่แสดงใน FLOW">
          <input
            className="f-input"
            maxLength={60}
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
          />
        </Field>
        <Field label="ผูกกับกลุ่มใน FLOW">
          <select
            className="f-select"
            value={form.workspaceId}
            onChange={(e) => setForm({ ...form, workspaceId: e.target.value })}
          >
            <option value="">— ยังไม่ผูก —</option>
            {(spaces.data?.items ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid-2">
          <Field label="จำนวนคนโดยประมาณ" hint="ใช้ประมาณการข้อความ">
            <input
              className="f-input"
              inputMode="numeric"
              value={form.audienceSize}
              onChange={(e) =>
                setForm({ ...form, audienceSize: e.target.value.replace(/\D/g, '').slice(0, 3) })
              }
            />
          </Field>
          <Field label="สถานะ">
            <select
              className="f-select"
              value={form.status}
              onChange={(e) =>
                setForm({ ...form, status: e.target.value as 'ACTIVE' | 'DISABLED' })
              }
            >
              <option value="ACTIVE">ใช้งาน</option>
              <option value="DISABLED">ปิด</option>
            </select>
          </Field>
        </div>
      </Confirm>
    </Page>
  );
}

// ───────────────────────── audit

/** Also embedded by the desktop Administration Center (/admin). */
export function Audit() {
  const { api } = useApp();
  const [offset, setOffset] = useState(0);
  const load = useLoad(() => api.audit(offset), `audit|${offset}`);
  return (
    <Page title="บันทึกการตรวจสอบ" back="/owner">
      <p className="f-hint">แสดงเฉพาะว่าใครทำอะไรเมื่อไร — ไม่มีชื่อหรือรายละเอียดนัดหมาย</p>
      <Loaded load={load}>
        {(d) => (
          <>
            <ol className="timeline">
              {d.items.map((a, i) => (
                <li key={`${a.at}${i}`}>
                  <span>
                    <span className="f-name">{a.actor}</span> · <code>{a.action}</code>
                  </span>
                  <span className="f-hint f-num">{at(a.at)}</span>
                </li>
              ))}
            </ol>
            <div className="btn-row">
              <Button
                size="sm"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - 50))}
              >
                ใหม่กว่า
              </Button>
              <Button size="sm" disabled={!d.hasMore} onClick={() => setOffset(offset + 50)}>
                เก่ากว่า
              </Button>
            </div>
          </>
        )}
      </Loaded>
    </Page>
  );
}

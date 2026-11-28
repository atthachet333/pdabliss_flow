/**
 * PDA BLISS FLOW — Platform Administration Center (/admin), desktop-first.
 *
 * Same origin, API, session and database as the LIFF app; only the layout differs. Every
 * page calls the existing authorized /api/v1 endpoints — the server decides what each role
 * may see or do, this UI only mirrors it. Areas that depend on the EP03 notification engine
 * show an honest "not enabled yet" page instead of numbers.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router';
import { brandArt } from '../../brand/assets';
import {
  Activity,
  ArrowLeft,
  Bell,
  Building2,
  Gauge,
  HeartPulse,
  Inbox,
  KeyRound,
  LayoutDashboard,
  Link2,
  LogOut,
  MessageCircle,
  ScrollText,
  Settings,
  UserRound,
  Users,
} from '../../components/icons';
import type { LucideIcon } from '../../components/icons';
import { Button, Notice } from '../../components/ui';
import { errorCode, errorText, useApp } from '../core';
import { Confirm } from '../ui';
import './admin.css';
import { DashboardPage } from './Dashboard';
import {
  ActivityPage,
  FriendsPage,
  HealthPage,
  NotificationsPage,
  QuotaPage,
  SettingsPage,
} from './Operations';
import { RequestsPage, UserDetailPage, UsersPage } from './People';
import {
  AuditPage,
  GroupsPage,
  InvitationsPage,
  PermissionsPage,
  WorkspaceDetailPage,
  WorkspacesPage,
} from './Organization';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  owner?: boolean;
}

const NAV: { title: string; items: NavItem[] }[] = [
  { title: 'ภาพรวม', items: [{ to: '/admin', label: 'แดชบอร์ด', icon: LayoutDashboard }] },
  {
    title: 'ผู้ใช้และสิทธิ์',
    items: [
      { to: '/admin/requests', label: 'คำขอเข้าใช้งาน', icon: Inbox },
      { to: '/admin/users', label: 'ผู้ใช้', icon: UserRound },
      { to: '/admin/workspaces', label: 'กลุ่มงาน', icon: Building2 },
      { to: '/admin/permissions', label: 'บทบาทและสิทธิ์', icon: KeyRound },
      { to: '/admin/invitations', label: 'ลิงก์เชิญ', icon: Link2 },
    ],
  },
  {
    title: 'LINE',
    items: [
      { to: '/admin/groups', label: 'กลุ่ม LINE', icon: MessageCircle, owner: true },
      { to: '/admin/friends', label: 'เพื่อน LINE', icon: Users, owner: true },
      { to: '/admin/quota', label: 'โควตาข้อความ', icon: Gauge, owner: true },
    ],
  },
  {
    title: 'การทำงานของระบบ',
    items: [
      { to: '/admin/activity', label: 'ศูนย์กิจกรรม', icon: Activity, owner: true },
      { to: '/admin/notifications', label: 'การแจ้งเตือน', icon: Bell, owner: true },
      { to: '/admin/health', label: 'สถานะระบบ', icon: HeartPulse, owner: true },
      { to: '/admin/audit', label: 'บันทึกความปลอดภัย', icon: ScrollText },
      { to: '/admin/settings', label: 'การตั้งค่าระบบ', icon: Settings, owner: true },
    ],
  },
];

const TITLES: [RegExp, string, string?][] = [
  [/^\/admin\/?$/, 'แดชบอร์ด'],
  [/^\/admin\/requests/, 'คำขอเข้าใช้งาน', 'ผู้ใช้และสิทธิ์'],
  [/^\/admin\/users\/.+/, 'รายละเอียดผู้ใช้', 'ผู้ใช้'],
  [/^\/admin\/users/, 'ผู้ใช้', 'ผู้ใช้และสิทธิ์'],
  [/^\/admin\/workspaces\/.+/, 'รายละเอียดกลุ่มงาน', 'กลุ่มงาน'],
  [/^\/admin\/workspaces/, 'กลุ่มงาน', 'ผู้ใช้และสิทธิ์'],
  [/^\/admin\/permissions/, 'บทบาทและสิทธิ์', 'ผู้ใช้และสิทธิ์'],
  [/^\/admin\/invitations/, 'ลิงก์เชิญ', 'ผู้ใช้และสิทธิ์'],
  [/^\/admin\/groups/, 'กลุ่ม LINE', 'LINE'],
  [/^\/admin\/friends/, 'เพื่อน LINE', 'LINE'],
  [/^\/admin\/quota/, 'โควตาข้อความ LINE', 'LINE'],
  [/^\/admin\/activity/, 'ศูนย์กิจกรรม', 'การทำงานของระบบ'],
  [/^\/admin\/notifications/, 'การแจ้งเตือน', 'การทำงานของระบบ'],
  [/^\/admin\/health/, 'สถานะระบบ', 'การทำงานของระบบ'],
  [/^\/admin\/audit/, 'บันทึกความปลอดภัย', 'การทำงานของระบบ'],
  [/^\/admin\/settings/, 'การตั้งค่าระบบ', 'การทำงานของระบบ'],
];

/**
 * Runs a sensitive privileged action. When the server answers REAUTH_REQUIRED the owner is
 * asked to confirm with LINE (no password), and the action is retried once afterwards.
 */
export function useSensitive() {
  const { reauthenticate } = useApp();
  const [prompt, setPrompt] = useState<null | { retry: () => Promise<unknown> }>(null);
  const [state, setState] = useState<'idle' | 'busy' | 'unavailable'>('idle');
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await fn();
    } catch (e) {
      if (errorCode(e) === 'REAUTH_REQUIRED') {
        setState('idle');
        setPrompt({ retry: fn });
        return undefined;
      }
      throw e;
    }
  }, []);
  const dialog = (
    <Confirm
      open={prompt !== null}
      title="ยืนยันตัวตนกับ LINE อีกครั้ง"
      body={
        <p>
          การเปลี่ยนสถานะบัญชี บทบาท หรือการนำออกจากกลุ่ม ต้องยืนยันตัวตนกับ LINE ภายใน 15 นาทีล่าสุด — FLOW
          ไม่มีรหัสผ่านแยก
          {state === 'unavailable'
            ? ' · ยืนยันอัตโนมัติไม่ได้ในขณะนี้ กรุณาปิดแล้วเปิด FLOW จาก LINE ใหม่ หรือเข้าสู่ระบบด้วย LINE อีกครั้ง'
            : ''}
        </p>
      }
      confirmLabel="ยืนยันด้วย LINE"
      busy={state === 'busy'}
      onClose={() => setPrompt(null)}
      onConfirm={async () => {
        setState('busy');
        const r = await reauthenticate();
        if (r === 'ok' && prompt) {
          const retry = prompt.retry;
          setPrompt(null);
          setState('idle');
          await retry().catch(() => undefined);
          return;
        }
        setState(r === 'redirecting' ? 'busy' : 'unavailable');
      }}
    />
  );
  return { run, dialog };
}

export function AdminPage({
  title,
  intro,
  actions,
  children,
}: {
  title: string;
  intro?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    document.title = `${title} · FLOW Admin`;
  }, [title]);
  return (
    <section className="adm-page" aria-labelledby="adm-title">
      <div className="adm-page__head">
        <div>
          <h1 id="adm-title" className="adm-page__title">
            {title}
          </h1>
          {intro ? <p className="adm-page__intro">{intro}</p> : null}
        </div>
        {actions ? <div className="adm-page__actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Honest placeholder for capabilities that arrive with the EP03 notification engine. */
export function NotEnabled({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="adm-ne" role="note">
      <span className="adm-ne__badge">ยังไม่เปิดใช้งาน · EP03</span>
      <h2 className="adm-ne__title">{title}</h2>
      <div className="adm-ne__body">{children}</div>
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="adm-error" role="alert">
      <Notice tone="caution">{errorText(error)}</Notice>
      <Button onClick={onRetry}>ลองอีกครั้ง</Button>
    </div>
  );
}

function NotFoundAdmin() {
  return (
    <AdminPage title="ไม่พบหน้านี้">
      <p>หน้านี้ไม่มีอยู่ หรือคุณไม่มีสิทธิ์เข้าถึง</p>
      <Link className="f-btn" to="/admin">
        กลับแดชบอร์ด
      </Link>
    </AdminPage>
  );
}

export default function AdminCenter() {
  const { me, logout } = useApp();
  const location = useLocation();
  const owner = me.permissions.platformOperations;
  const mainRef = useRef<HTMLElement>(null);
  const [first, setFirst] = useState(true);
  const match = TITLES.find(([re]) => re.test(location.pathname));
  // Focus moves to the page content on navigation (not on the very first render).
  useEffect(() => {
    if (first) return setFirst(false);
    mainRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);
  const pending = me.adminBadge?.pendingRequests ?? 0;
  return (
    <div className="adm">
      <a className="adm-skip" href="#adm-main">
        ข้ามไปยังเนื้อหา
      </a>
      <aside className="adm-side" aria-label="เมนูผู้ดูแลระบบ">
        <div className="adm-side__brand">
          <img src={brandArt.flowWordmark} alt="FLOW" className="adm-side__mark" />
          <span className="adm-side__sub">Administration Center</span>
        </div>
        <nav className="adm-nav">
          {NAV.map((g) => {
            const items = g.items.filter((i) => owner || !i.owner);
            if (!items.length) return null;
            return (
              <div key={g.title} className="adm-nav__group">
                <p className="adm-nav__title">{g.title}</p>
                {items.map((i) => (
                  <NavLink key={i.to} to={i.to} end={i.to === '/admin'} className="adm-nav__link">
                    <i.icon aria-hidden />
                    <span>{i.label}</span>
                    {i.to === '/admin/requests' && pending > 0 ? (
                      <span className="adm-nav__badge" aria-label={`รอดำเนินการ ${pending} รายการ`}>
                        {pending}
                      </span>
                    ) : null}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="adm-side__foot">
          <p className="adm-side__who f-name" title={me.user.displayName}>
            {me.user.displayName}
            <span>{me.user.globalRole === 'OWNER' ? 'เจ้าของระบบ' : 'ผู้ดูแลระบบ'}</span>
          </p>
          <Link to="/today" className="adm-side__link">
            <ArrowLeft aria-hidden /> กลับไปแอป FLOW
          </Link>
          <button type="button" className="adm-side__link" onClick={logout}>
            <LogOut aria-hidden /> ออกจากระบบ FLOW
          </button>
        </div>
      </aside>
      <div className="adm-body">
        <header className="adm-top">
          <nav aria-label="ตำแหน่งปัจจุบัน" className="adm-crumbs">
            <ol>
              <li>
                <Link to="/admin">Admin</Link>
              </li>
              {match?.[2] ? <li>{match[2]}</li> : null}
              {match && match[1] !== 'แดชบอร์ด' ? <li aria-current="page">{match[1]}</li> : null}
            </ol>
          </nav>
          <p className="adm-top__note">
            ผู้ดูแลระบบจัดการบัญชีและการทำงานของระบบ — ไม่เห็นเนื้อหานัดหมายส่วนตัวของผู้ใช้
          </p>
        </header>
        <main className="adm-main" id="adm-main" ref={mainRef} tabIndex={-1}>
          <Routes>
            <Route path="/admin">
              <Route index element={<DashboardPage />} />
              <Route path="requests" element={<RequestsPage />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="users/:id" element={<UserDetailPage />} />
              <Route path="workspaces" element={<WorkspacesPage />} />
              <Route path="workspaces/:id" element={<WorkspaceDetailPage />} />
              <Route path="permissions" element={<PermissionsPage />} />
              <Route path="invitations" element={<InvitationsPage />} />
              <Route path="audit" element={<AuditPage />} />
              {owner ? (
                <>
                  <Route path="groups" element={<GroupsPage />} />
                  <Route path="friends" element={<FriendsPage />} />
                  <Route path="quota" element={<QuotaPage />} />
                  <Route path="activity" element={<ActivityPage />} />
                  <Route path="notifications" element={<NotificationsPage />} />
                  <Route path="health" element={<HealthPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                </>
              ) : null}
              <Route path="*" element={<NotFoundAdmin />} />
            </Route>
          </Routes>
        </main>
      </div>
    </div>
  );
}

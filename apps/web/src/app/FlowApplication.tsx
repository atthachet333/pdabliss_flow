/**
 * The signed-in application (EP02): shell, bottom navigation and every route.
 * Rendered only for ACTIVE accounts; the server re-checks every permission per request.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router';
import type { MeDto } from '@flow/shared';
import type { FlowApiClient } from '../auth/api-client';
import {
  CalendarDays,
  CalendarPlus,
  House,
  Settings,
  ShieldCheck,
  Users,
} from '../components/icons';
import { Skeleton } from '../components/ui';
import { brandArt } from '../brand/assets';
import { FlowApp } from './api';
import { AppProvider, type AppCtx } from './core';
import { Toasts, useToasts } from './ui';
import { TodayPage } from './pages/Today';
import { CalendarPage } from './pages/Calendar';
import { AppointmentDetailPage } from './pages/AppointmentDetail';
import { AppointmentFormPage } from './pages/AppointmentForm';
import { GroupsPage, GroupDetailPage } from './pages/Groups';
import { HistoryPage, SearchPage } from './pages/Lists';
import { PreferencesPage, PrivacySettingsPage, SettingsPage } from './pages/Settings';
import { LegalPage } from './pages/Legal';
import { InvitePage } from './pages/Invite';

const OwnerConsole = lazy(() => import('./pages/owner/OwnerConsole'));

const WS_KEY = 'flow.activeWorkspace';
function readWs(): string | 'all' {
  try {
    return window.sessionStorage.getItem(WS_KEY) ?? 'all';
  } catch {
    return 'all';
  }
}

function TabBar({ me }: { me: MeDto }) {
  const badge = me.adminBadge ? me.adminBadge.pendingRequests + me.adminBadge.pendingGroups : 0;
  return (
    <nav className="f-tabbar app-tabbar" aria-label="เมนูหลัก">
      <NavLink to="/today">
        <House aria-hidden />
        วันนี้
      </NavLink>
      <NavLink to="/calendar">
        <CalendarDays aria-hidden />
        ปฏิทิน
      </NavLink>
      <NavLink to="/appointments/new" className="app-tabbar__create">
        <CalendarPlus aria-hidden />
        สร้างนัด
      </NavLink>
      <NavLink to="/groups">
        <Users aria-hidden />
        กลุ่ม
      </NavLink>
      <NavLink to="/settings" className="app-tabbar__settings">
        <Settings aria-hidden />
        ตั้งค่า
        {badge > 0 ? (
          <span className="dot" aria-label={`มีรายการรอดำเนินการ ${badge} รายการ`}>
            {badge}
          </span>
        ) : null}
      </NavLink>
    </nav>
  );
}

export function FlowApplication({
  client,
  onLogout,
  onAccountChanged,
}: {
  client: FlowApiClient;
  onLogout: () => void;
  /** The server says this account can no longer use the app (suspended, revoked…). */
  onAccountChanged: () => void;
}) {
  const api = useMemo(() => new FlowApp(client), [client]);
  const [me, setMe] = useState<MeDto | null>(null);
  const [failed, setFailed] = useState(false);
  const [workspaceId, setWs] = useState<string | 'all'>(readWs);
  const toasts = useToasts();
  const location = useLocation();

  const reloadMe = useCallback(async () => {
    try {
      const m = await api.me();
      if (m.user.status !== 'ACTIVE') return onAccountChanged();
      setMe(m);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [api, onAccountChanged]);

  useEffect(() => {
    void reloadMe();
  }, [reloadMe]);

  // Privileges can change at any time (removal, suspension): refresh on navigation.
  useEffect(() => {
    if (me) void reloadMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const setWorkspaceId = useCallback((id: string | 'all') => {
    setWs(id);
    try {
      window.sessionStorage.setItem(WS_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  if (!me)
    return (
      <div className="app app--loading" aria-busy="true">
        {failed ? (
          <div className="load-error">
            <p>เชื่อมต่อ FLOW ไม่ได้ในขณะนี้</p>
            <button type="button" className="f-btn" onClick={() => void reloadMe()}>
              ลองอีกครั้ง
            </button>
          </div>
        ) : (
          <>
            <Skeleton height={48} radius={16} />
            <Skeleton height={140} radius={20} />
            <Skeleton height={72} radius={16} />
          </>
        )}
      </div>
    );

  const active =
    workspaceId !== 'all' && !me.workspaces.some((w) => w.id === workspaceId) ? 'all' : workspaceId;
  const ctx: AppCtx = {
    api,
    me,
    reloadMe,
    workspaceId: active,
    setWorkspaceId,
    logout: onLogout,
    toast: toasts.push,
  };

  return (
    <AppProvider value={ctx}>
      <div className="app">
        <header className="app-bar">
          <img src={brandArt.flowWordmark} alt="FLOW" className="app-bar__mark" />
          <span className="app-bar__who f-name" title={me.user.displayName}>
            {me.user.displayName}
          </span>
          {me.permissions.ownerConsole ? (
            <NavLink to="/owner" className="app-bar__owner" aria-label="คอนโซลเจ้าของระบบ">
              <ShieldCheck aria-hidden />
              {me.adminBadge && me.adminBadge.pendingRequests > 0 ? (
                <span className="dot">{me.adminBadge.pendingRequests}</span>
              ) : null}
            </NavLink>
          ) : null}
        </header>
        <main className="app-main" id="main">
          <Routes>
            <Route path="/" element={<Navigate to="/today" replace />} />
            <Route path="/today" element={<TodayPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/appointments/new" element={<AppointmentFormPage mode="create" />} />
            <Route path="/appointments/:id" element={<AppointmentDetailPage />} />
            <Route path="/appointments/:id/edit" element={<AppointmentFormPage mode="edit" />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/groups" element={<GroupsPage />} />
            <Route path="/groups/:id" element={<GroupDetailPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/settings/preferences" element={<PreferencesPage />} />
            <Route path="/settings/privacy" element={<PrivacySettingsPage />} />
            <Route path="/privacy" element={<LegalPage doc="privacy" />} />
            <Route path="/terms" element={<LegalPage doc="terms" />} />
            <Route path="/invite/:token" element={<InvitePage />} />
            <Route
              path="/owner/*"
              element={
                me.permissions.ownerConsole ? (
                  <Suspense fallback={<Skeleton height={200} radius={20} />}>
                    <OwnerConsole />
                  </Suspense>
                ) : (
                  <Navigate to="/today" replace />
                )
              }
            />
            <Route path="*" element={<Navigate to="/today" replace />} />
          </Routes>
        </main>
        <TabBar me={me} />
        <Toasts items={toasts.items} />
      </div>
    </AppProvider>
  );
}

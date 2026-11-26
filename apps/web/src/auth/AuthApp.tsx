import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useLocation, useMatch, useNavigate } from 'react-router';
import { FlowApp } from '../app/api';
import { FlowApplication } from '../app/FlowApplication';
import { InviteView } from '../app/pages/Invite';
import { FlowApiClient } from './api-client';
import { AuthLayout, AuthScreen } from './AuthScreen';
import { AuthController, LoginGuard } from './flow';
import { loadRealLiff } from './liff';

function sessionStorageOrNull(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** LIFF entry point: authenticate with LINE, then the application or the account screen. */
export default function AuthApp() {
  const location = useLocation();
  const navigate = useNavigate();
  const { controller, client } = useMemo(() => {
    const c = new FlowApiClient();
    return {
      client: c,
      controller: new AuthController({
        api: c,
        loadLiff: loadRealLiff,
        guard: new LoginGuard(sessionStorageOrNull()),
        location: { origin: window.location.origin, pathname: window.location.pathname },
      }),
    };
    // The controller lives for the page; the path at first load is the login redirect target.
  }, []);
  const api = useMemo(() => new FlowApp(client), [client]);
  const view = useSyncExternalStore(controller.subscribe, controller.getView, controller.getView);
  const invite = useMatch('/invite/:token');

  useEffect(() => {
    void controller.start();
  }, [controller]);

  const logout = useCallback(() => void controller.logout(), [controller]);
  const refresh = useCallback(() => void controller.refresh(), [controller]);

  if (view.kind === 'approved')
    return (
      <FlowApplication
        client={client}
        onLogout={logout}
        onAccountChanged={refresh}
        key={view.user.id}
      />
    );

  if (
    view.kind === 'account' &&
    invite?.params.token &&
    (view.account === 'new' || view.account === 'pending')
  ) {
    return (
      <AuthLayout>
        <section className="auth-card">
          <InviteView
            key={invite.params.token}
            api={api}
            token={invite.params.token}
            onRequested={() => {
              navigate('/groups', { replace: true });
              refresh();
            }}
          />
        </section>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <AuthScreen
        key={location.pathname}
        view={view}
        actions={{
          onLogin: () => void controller.login(),
          onRetry: () => void controller.retry(),
          onLogout: logout,
          onCheckLine: () => client.lineStatus(),
          onRequestAccess: async (message) => {
            await api.requestAccess(message);
            await controller.refresh();
          },
        }}
      />
    </AuthLayout>
  );
}

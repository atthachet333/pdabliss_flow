import { useEffect, useMemo, useSyncExternalStore } from 'react';
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

/** LIFF entry point (EP01): authenticate with LINE, then show the foundation landing. */
export default function AuthApp() {
  const { controller, api } = useMemo(() => {
    const client = new FlowApiClient();
    return {
      api: client,
      controller: new AuthController({
        api: client,
        loadLiff: loadRealLiff,
        guard: new LoginGuard(sessionStorageOrNull()),
        location: { origin: window.location.origin, pathname: window.location.pathname },
      }),
    };
  }, []);

  const view = useSyncExternalStore(controller.subscribe, controller.getView, controller.getView);

  useEffect(() => {
    void controller.start();
  }, [controller]);

  return (
    <AuthLayout>
      <AuthScreen
        view={view}
        actions={{
          onLogin: () => void controller.login(),
          onRetry: () => void controller.retry(),
          onLogout: () => void controller.logout(),
          onCheckLine: () => api.lineStatus(),
        }}
      />
    </AuthLayout>
  );
}

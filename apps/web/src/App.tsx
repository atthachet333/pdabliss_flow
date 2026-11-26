import { lazy, Suspense } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router';
import { AuthLayout } from './auth/AuthScreen';
import { SallyImage, Skeleton } from './components/ui';
import { isAppRoute } from './routes';

/**
 * Dev-only pages (design showcase, EP01 auth-state gallery) exist only in development
 * and in the local "showcase" QA build. In a production build this condition is
 * statically false, so their lazy chunks and routes are removed by the bundler
 * (verified by scripts/check-showcase-excluded.mjs).
 */
const DEV_PAGES = import.meta.env.DEV || import.meta.env.MODE === 'showcase';
const DesignShowcase = DEV_PAGES ? lazy(() => import('./showcase/DesignShowcase')) : null;
const AuthStatesShowcase = DEV_PAGES ? lazy(() => import('./showcase/AuthStatesShowcase')) : null;
const AuthApp = lazy(() => import('./auth/AuthApp'));

function NotFound() {
  return (
    <main className="welcome">
      <SallyImage expression="thoughtful" size={104} decorative />
      <h1>ไม่พบหน้านี้ค่ะ</h1>
      <p className="f-muted">ลิงก์อาจไม่ถูกต้อง หรือคุณอาจไม่มีสิทธิ์เข้าถึงหน้านี้</p>
      <Link className="f-btn" to="/">
        กลับหน้าแรก
      </Link>
    </main>
  );
}

function PageFallback() {
  return (
    <div className="welcome" aria-busy="true">
      <Skeleton width={180} height={28} />
      <Skeleton width={280} height={16} />
    </div>
  );
}

function AuthFallback() {
  return (
    <AuthLayout>
      <section className="auth-card" aria-busy="true">
        <SallyImage variant="portrait" size={176} decorative />
        <Skeleton width={240} height={24} />
      </section>
    </AuthLayout>
  );
}

/**
 * One AuthApp instance for every application path, so navigating inside the app never
 * re-runs login. Paths outside the allow-list get the not-found page (as the gateway does).
 */
function Application() {
  const { pathname } = useLocation();
  // After the invitation page strips its token the router still holds the old path; any path
  // that started as an app path stays inside the app.
  if (!isAppRoute(pathname) && !pathname.startsWith('/invite/')) return <NotFound />;
  return (
    <Suspense fallback={<AuthFallback />}>
      <AuthApp />
    </Suspense>
  );
}

export function App() {
  return (
    <Routes>
      {DesignShowcase ? (
        <Route
          path="/dev/design-showcase"
          element={
            <Suspense fallback={<PageFallback />}>
              <DesignShowcase />
            </Suspense>
          }
        />
      ) : null}
      {AuthStatesShowcase ? (
        <Route
          path="/dev/auth-states"
          element={
            <Suspense fallback={<PageFallback />}>
              <AuthStatesShowcase />
            </Suspense>
          }
        />
      ) : null}
      <Route path="*" element={<Application />} />
    </Routes>
  );
}

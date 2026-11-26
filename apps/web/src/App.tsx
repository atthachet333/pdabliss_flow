import { lazy, Suspense } from 'react';
import { Link, Route, Routes } from 'react-router';
import { brandArt } from './brand/assets';
import { SallyImage, Skeleton } from './components/ui';

/**
 * The design showcase exists only in development (and the local "showcase" QA build).
 * In a production build this condition is statically false, so the lazy chunk and its
 * route are removed by the bundler.
 */
const SHOWCASE_ENABLED = import.meta.env.DEV || import.meta.env.MODE === 'showcase';
const DesignShowcase = SHOWCASE_ENABLED ? lazy(() => import('./showcase/DesignShowcase')) : null;

function Welcome() {
  return (
    <main className="welcome">
      <img src={brandArt.flowWordmark} alt="FLOW" className="welcome__mark" />
      <SallyImage variant="portrait" size={200} decorative />
      <h1>ทุกนัดหมาย ถูกเวลา ถูกคน ถูกกลุ่ม</h1>
      <p className="f-muted">
        สวัสดีค่ะ Sally มารายงานตัวแล้ว — FLOW อยู่ในขั้นวางรากฐาน (EP00) ยังไม่เปิดใช้งานจริง
      </p>
      {SHOWCASE_ENABLED ? (
        <Link className="f-btn f-btn--dark" to="/dev/design-showcase">
          เปิด Design Showcase (dev)
        </Link>
      ) : null}
      <p className="welcome__sig">Designed &amp; Engineered by PDA BLISS</p>
    </main>
  );
}

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

function ShowcaseFallback() {
  return (
    <div className="welcome" aria-busy="true">
      <Skeleton width={180} height={28} />
      <Skeleton width={280} height={16} />
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Welcome />} />
      {DesignShowcase ? (
        <Route
          path="/dev/design-showcase"
          element={
            <Suspense fallback={<ShowcaseFallback />}>
              <DesignShowcase />
            </Suspense>
          }
        />
      ) : null}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

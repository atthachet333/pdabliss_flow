/**
 * /dev/auth-states — DEVELOPMENT ONLY. Renders every EP01 auth screen (A–K) with
 * SIMULATED identities for visual QA. Excluded from production builds and blocked by
 * the dev gateway. No LIFF, no network.
 */
import { AuthScreen } from '../auth/AuthScreen';
import type { AuthView, LineStatus, SessionUser } from '../auth/types';
import { brandArt } from '../brand/assets';

export const AUTH_STATES_MARKER = 'FLOW_AUTH_STATES_DEV_ONLY';

const SIM_STATUS: LineStatus = {
  bot: { basicId: '@sim-only', displayName: 'Sally (จำลอง)' },
  quota: { type: 'limited', value: 300 },
  consumption: { totalUsage: 0 },
  webhook: { received: 0, duplicates: 0, unknown: 0, pendingGroups: 0 },
  checkedAt: '2026-11-26T04:00:00.000Z',
};

/** Frozen clock so the rate-limit countdown screenshots are deterministic. */
const SIM_NOW = Date.UTC(2026, 10, 26, 4, 0, 0);
const simNow = () => SIM_NOW;

/** Synthetic identities only (no real LINE data). Long emoji name exercises F08 wrapping. */
const SIM_OWNER: SessionUser = {
  id: '00000000-0000-4000-8000-000000000001',
  displayName: 'ผู้ทดสอบจำลอง',
  status: 'ACTIVE',
  globalRole: 'OWNER',
};
const SIM_NEW: SessionUser = {
  id: '00000000-0000-4000-8000-000000000002',
  displayName: 'คุณสมศรี มีความสุขมากมาย 🌸✨🎉 (บัญชีจำลอง)',
  status: 'NEW',
  globalRole: 'USER',
};

const STATES: { id: string; label: string; view: AuthView }[] = [
  { id: 'A', label: 'A · เริ่มต้น', view: { kind: 'initializing' } },
  { id: 'B', label: 'B · ยืนยันตัวตนกับ LINE', view: { kind: 'authenticating' } },
  { id: 'C', label: 'C · ต้องเข้าสู่ระบบ', view: { kind: 'login-required' } },
  {
    id: 'D',
    label: 'D · เข้าสู่ระบบแล้ว (จำลอง)',
    view: { kind: 'approved', user: SIM_OWNER, expiresAt: '2026-11-26T12:00:00.000Z' },
  },
  {
    id: 'E1',
    label: 'E · ผู้ใช้ใหม่ ขอสิทธิ์ในแอป',
    view: { kind: 'account', account: 'new', user: SIM_NEW },
  },
  {
    id: 'E2',
    label: 'E · รอการอนุมัติ',
    view: { kind: 'account', account: 'pending', user: SIM_NEW },
  },
  {
    id: 'E3',
    label: 'E · ไม่อนุมัติ',
    view: { kind: 'account', account: 'rejected', user: SIM_NEW },
  },
  {
    id: 'E4',
    label: 'E · ระงับชั่วคราว',
    view: { kind: 'account', account: 'suspended', user: SIM_NEW },
  },
  { id: 'F', label: 'F · ไม่มีสิทธิ์', view: { kind: 'denied', reason: 'revoked' } },
  { id: 'G', label: 'G · เซสชันหมดอายุ', view: { kind: 'expired', inClient: false } },
  { id: 'H', label: 'H · เครือข่ายขัดข้อง', view: { kind: 'unavailable', cause: 'network' } },
  { id: 'H2', label: 'H · LINE ไม่พร้อม', view: { kind: 'unavailable', cause: 'line' } },
  { id: 'I', label: 'I · กำลังลองใหม่', view: { kind: 'retrying' } },
  { id: 'J', label: 'J · ออกจากระบบแล้ว', view: { kind: 'logged-out' } },
  {
    id: 'K',
    label: 'K · ลองบ่อยเกินไป (นับถอยหลัง)',
    view: { kind: 'rate-limited', retryAt: SIM_NOW + 272_000 },
  },
  { id: 'K2', label: 'K · ลองใหม่ได้แล้ว', view: { kind: 'rate-limited', retryAt: SIM_NOW } },
];

const noop = () => undefined;

export default function AuthStatesShowcase() {
  return (
    <div className="sc sc--single" data-marker={AUTH_STATES_MARKER}>
      <div className="sc-devbar" role="note">
        <strong>DEV ONLY</strong>
        <span>EP01 auth states · ตัวตนจำลองทั้งหมด · ไม่มีการเชื่อมต่อ LINE</span>
      </div>
      <main className="auth-states">
        <header className="auth-states__head">
          <img src={brandArt.flowWordmark} alt="FLOW" className="auth__mark" />
          <h1>EP01 — หน้าจอการเข้าสู่ระบบ (A–K)</h1>
        </header>
        <div className="auth-states__grid">
          {STATES.map((s) => (
            <figure key={s.id} className="auth-states__item" id={`state-${s.id}`}>
              <figcaption>
                <span className="f-proto">จำลอง</span> {s.label}
              </figcaption>
              <div className="auth auth--framed">
                <AuthScreen
                  view={s.view}
                  now={simNow}
                  actions={{
                    onLogin: noop,
                    onRetry: noop,
                    onLogout: noop,
                    onCheckLine: async () => SIM_STATUS,
                    onRequestAccess: async () => undefined,
                  }}
                />
              </div>
            </figure>
          ))}
        </div>
      </main>
    </div>
  );
}

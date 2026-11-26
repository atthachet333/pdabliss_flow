/**
 * /dev/auth-states — DEVELOPMENT ONLY. Renders every EP01 auth screen (A–K) with
 * SIMULATED identities for visual QA. Excluded from production builds and blocked by
 * the dev gateway. No LIFF, no network.
 */
import { AuthScreen } from '../auth/AuthScreen';
import type { AuthView, LineStatus } from '../auth/types';
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

const STATES: { id: string; label: string; view: AuthView }[] = [
  { id: 'A', label: 'A · เริ่มต้น', view: { kind: 'initializing' } },
  { id: 'B', label: 'B · ยืนยันตัวตนกับ LINE', view: { kind: 'authenticating' } },
  { id: 'C', label: 'C · ต้องเข้าสู่ระบบ', view: { kind: 'login-required' } },
  {
    id: 'D',
    label: 'D · เจ้าของระบบ (จำลอง)',
    view: {
      kind: 'approved',
      user: { displayName: 'ผู้ทดสอบจำลอง', role: 'owner' },
      expiresAt: '2026-11-26T12:00:00.000Z',
    },
  },
  {
    id: 'D2',
    label: 'D · ผู้ทดสอบ (จำลอง)',
    view: {
      kind: 'approved',
      user: { displayName: null, role: 'tester' },
      expiresAt: '2026-11-26T12:00:00.000Z',
    },
  },
  { id: 'E', label: 'E · รอการอนุมัติ', view: { kind: 'not-approved', enrollmentRef: 'SIM0-0000' } },
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

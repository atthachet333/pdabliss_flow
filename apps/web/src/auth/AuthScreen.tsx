/**
 * Presentational auth screens (EP01 A–K; EP02 account states). Pure props → markup, so the
 * dev-only /dev/auth-states page can render every state with simulated identities.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { formatThaiDate, formatThaiTime } from '@flow/shared';
import { brandArt } from '../brand/assets';
import type { SallyExpression } from '../brand/assets';
import { Lock, LogOut, RefreshCw, ShieldCheck, Smartphone } from '../components/icons';
import { Button, Notice, SallyImage } from '../components/ui';
import { RETRY_COOLDOWN_MS } from './flow';
import type { AuthView, LineStatus, UnavailableCause } from './types';

const TZ = 'Asia/Bangkok';

export interface AuthScreenActions {
  onLogin: () => void;
  onRetry: () => void;
  onLogout: () => void;
  onCheckLine?: () => Promise<LineStatus>;
  /** EP02: in-app access request (no reference codes, no command line). */
  onRequestAccess?: (message: string) => Promise<void>;
}

function Shell({
  expression,
  portrait,
  eyebrow,
  title,
  children,
  busy,
  live,
}: {
  expression?: SallyExpression;
  portrait?: boolean;
  eyebrow?: string;
  title: string;
  children?: ReactNode;
  busy?: boolean;
  live?: boolean;
}) {
  return (
    <section
      className="auth-card"
      aria-busy={busy || undefined}
      aria-live={live ? 'polite' : undefined}
    >
      <div className="auth-card__art">
        {portrait ? (
          <SallyImage variant="portrait" size={176} decorative />
        ) : (
          <SallyImage expression={expression ?? 'default'} size={128} decorative />
        )}
      </div>
      {eyebrow ? <p className="f-eyebrow">{eyebrow}</p> : null}
      <h1 className="auth-card__title f-name">{title}</h1>
      {children}
    </section>
  );
}

/** Re-renders every second until `until` (epoch ms) has passed; returns the current time. */
function useTicker(until: number, now: () => number): number {
  const [t, setT] = useState(now);
  useEffect(() => {
    if (t >= until) return undefined;
    const id = setInterval(() => setT(now()), 1000);
    return () => clearInterval(id);
  }, [t, until, now]);
  return t;
}

/**
 * Retry button that stays disabled for RETRY_COOLDOWN_MS after it appears, so rapid taps
 * cannot fire a burst of login requests (the controller enforces the same rule).
 */
function RetryButton({
  onRetry,
  children,
  variant,
}: {
  onRetry: () => void;
  children: ReactNode;
  variant?: 'dark';
}) {
  const [readyAt] = useState(() => Date.now() + RETRY_COOLDOWN_MS);
  const t = useTicker(readyAt, Date.now);
  const waiting = t < readyAt;
  return (
    <Button
      variant={variant}
      icon={RefreshCw}
      disabled={waiting}
      aria-disabled={waiting || undefined}
      onClick={onRetry}
    >
      {children}
    </Button>
  );
}

function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} วินาที`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')} นาที`;
}

const ACCOUNT_TEXT = {
  new: {
    expression: 'default',
    eyebrow: 'ขอสิทธิ์ใช้งาน',
    title: 'ยินดีต้อนรับสู่ FLOW ค่ะ',
    body: 'บัญชี LINE ของคุณยืนยันตัวตนแล้ว ส่งคำขอใช้งานได้จากหน้านี้เลย เจ้าของระบบจะตรวจสอบและอนุมัติในแอป',
  },
  pending: {
    expression: 'thoughtful',
    eyebrow: 'รอการอนุมัติ',
    title: 'ส่งคำขอใช้งานแล้วค่ะ',
    body: 'เจ้าของระบบจะเห็นคำขอของคุณในแอปทันที เมื่ออนุมัติแล้ว กด “ตรวจสอบอีกครั้ง” ได้เลย ไม่ต้องเข้าสู่ระบบใหม่',
  },
  rejected: {
    expression: 'empty',
    eyebrow: 'ยังไม่ได้รับอนุมัติ',
    title: 'คำขอครั้งก่อนยังไม่ได้รับอนุมัติ',
    body: 'หากต้องการใช้งาน ส่งคำขอใหม่พร้อมข้อความสั้น ๆ ถึงเจ้าของระบบได้ค่ะ',
  },
  suspended: {
    expression: 'error',
    eyebrow: 'ระงับการใช้งานชั่วคราว',
    title: 'บัญชีนี้ถูกระงับการใช้งานชั่วคราว',
    body: 'ข้อมูลของคุณยังอยู่ครบ กรุณาติดต่อเจ้าของระบบเพื่อเปิดใช้งานอีกครั้งค่ะ',
  },
} as const;

function AccessRequestForm({ onSubmit }: { onSubmit: (message: string) => Promise<void> }) {
  const [message, setMessage] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'error'>('idle');
  return (
    <form
      className="auth-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (state === 'sending') return;
        setState('sending');
        onSubmit(message.trim()).catch(() => setState('error'));
      }}
    >
      <label className="f-field">
        <span className="f-label">ข้อความถึงเจ้าของระบบ (ไม่บังคับ)</span>
        <textarea
          className="f-textarea"
          maxLength={200}
          rows={2}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="เช่น ชื่อเล่น หรือกลุ่มที่ต้องการเข้าร่วม"
        />
      </label>
      {state === 'error' ? (
        <Notice tone="caution">ส่งคำขอไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่อีกครั้งค่ะ</Notice>
      ) : null}
      <Button type="submit" variant="dark" busy={state === 'sending'}>
        ส่งคำขอใช้งาน
      </Button>
    </form>
  );
}

/** K — HTTP 429: explains the pause, counts down to the server's Retry-After, no auto retry. */
function RateLimited({
  retryAt,
  onRetry,
  now,
}: {
  retryAt: number;
  onRetry: () => void;
  now: () => number;
}) {
  const t = useTicker(retryAt, now);
  const remaining = Math.max(0, Math.ceil((retryAt - t) / 1000));
  const ready = remaining === 0;
  const [initialMinutes] = useState(() => Math.max(1, Math.ceil(remaining / 60)));
  return (
    <Shell expression="reminder" eyebrow="พักสักครู่" title="ลองเข้าสู่ระบบบ่อยเกินไปค่ะ">
      <p className="f-muted">
        เพื่อความปลอดภัย FLOW หยุดรับการเข้าสู่ระบบจากอุปกรณ์นี้ชั่วคราว บัญชีและสิทธิ์ใช้งานของคุณยังอยู่ครบ ไม่ต้องกังวลนะคะ
      </p>
      <p className="auth-countdown" role="timer" aria-live="off" aria-atomic="true">
        {ready ? (
          'ลองใหม่ได้แล้วค่ะ'
        ) : (
          <>
            ลองใหม่ได้ในอีก{' '}
            <span className="auth-countdown__value f-num">{formatWait(remaining)}</span>
          </>
        )}
      </p>
      <p className="f-sr-only" aria-live="polite">
        {ready ? 'ลองใหม่ได้แล้วค่ะ' : `ลองใหม่ได้ในอีกประมาณ ${initialMinutes} นาที`}
      </p>
      <Button variant="dark" icon={RefreshCw} disabled={!ready} onClick={onRetry}>
        ลองอีกครั้ง
      </Button>
      <p className="f-hint">Sally จะไม่ลองใหม่เองอัตโนมัติ และการกดซ้ำระหว่างรอจะไม่ทำให้เร็วขึ้นค่ะ</p>
    </Shell>
  );
}

const UNAVAILABLE_TEXT: Record<UnavailableCause, { title: string; body: string }> = {
  network: {
    title: 'เชื่อมต่อไม่ได้ในขณะนี้',
    body: 'กรุณาตรวจสอบอินเทอร์เน็ต แล้วลองใหม่อีกครั้งนะคะ',
  },
  line: {
    title: 'ยังติดต่อ LINE ไม่ได้ค่ะ',
    body: 'บริการของ LINE อาจไม่พร้อมชั่วคราว หรือควรเปิด FLOW จากแอป LINE อีกครั้ง',
  },
  server: {
    title: 'ระบบยังไม่พร้อมให้บริการ',
    body: 'ขออภัยค่ะ Sally ยังไม่สามารถดำเนินการรายการนี้ได้ กรุณาลองใหม่อีกครั้งนะคะ',
  },
  config: {
    title: 'FLOW ยังไม่เปิดให้เข้าสู่ระบบ',
    body: 'ผู้ดูแลระบบยังตั้งค่าการเชื่อมต่อ LINE ไม่ครบ กรุณาติดต่อผู้ดูแลค่ะ',
  },
  'login-loop': {
    title: 'เข้าสู่ระบบไม่สำเร็จ',
    body: 'Sally หยุดการพาไปหน้า LINE ซ้ำ ๆ เพื่อความปลอดภัย กรุณาปิดหน้านี้แล้วเปิด FLOW จากแอป LINE ค่ะ',
  },
};

export function LineStatusPanel({ check }: { check: () => Promise<LineStatus> }) {
  const [state, setState] = useState<
    { kind: 'idle' } | { kind: 'loading' } | { kind: 'ok'; s: LineStatus } | { kind: 'error' }
  >({ kind: 'idle' });
  return (
    <div className="auth-owner">
      <p className="auth-owner__title">
        <ShieldCheck aria-hidden className="inline-icon" /> สำหรับเจ้าของระบบ
      </p>
      {state.kind === 'ok' ? (
        <dl className="auth-dl">
          <div>
            <dt>บัญชี LINE</dt>
            <dd>
              {state.s.bot.displayName} ({state.s.bot.basicId})
            </dd>
          </div>
          <div>
            <dt>โควตาข้อความเดือนนี้ (จาก LINE)</dt>
            <dd className="f-num">
              {state.s.quota.type === 'limited' ? `${state.s.quota.value ?? '—'} ข้อความ` : 'ไม่จำกัด'}
            </dd>
          </div>
          <div>
            <dt>ใช้ไปแล้วเดือนนี้</dt>
            <dd className="f-num">{state.s.consumption.totalUsage} ข้อความ</dd>
          </div>
          <div>
            <dt>Webhook ที่ได้รับ (รอบนี้)</dt>
            <dd className="f-num">
              {state.s.webhook.received} เหตุการณ์ · กลุ่มรอลงทะเบียน {state.s.webhook.pendingGroups}
            </dd>
          </div>
        </dl>
      ) : state.kind === 'error' ? (
        <Notice tone="caution">
          ยังอ่านข้อมูลจาก LINE ไม่ได้ — ตรวจสอบ Channel access token ในไฟล์ลับของเครื่อง
        </Notice>
      ) : null}
      <Button
        size="sm"
        busy={state.kind === 'loading'}
        icon={RefreshCw}
        onClick={() => {
          setState({ kind: 'loading' });
          check().then(
            (s) => setState({ kind: 'ok', s }),
            () => setState({ kind: 'error' }),
          );
        }}
      >
        ตรวจสอบการเชื่อมต่อ LINE (อ่านอย่างเดียว)
      </Button>
      <p className="f-hint">อ่านข้อมูลอย่างเดียว — ไม่มีการส่งข้อความ LINE ใด ๆ</p>
    </div>
  );
}

export function AuthScreen({
  view,
  actions,
  now = Date.now,
}: {
  view: AuthView;
  actions: AuthScreenActions;
  /** Clock for the rate-limit countdown (the dev states page freezes it). */
  now?: () => number;
}) {
  switch (view.kind) {
    case 'initializing': // A
      return (
        <Shell portrait eyebrow="PDA BLISS FLOW" title="สวัสดีค่ะ Sally กำลังเตรียมระบบให้นะคะ" busy live>
          <div className="auth-progress" aria-hidden>
            <span />
            <span />
            <span />
          </div>
          <p className="f-muted">เรื่องเวลาปล่อยให้ Sally ดูแลนะคะ</p>
        </Shell>
      );
    case 'authenticating': // B
      return (
        <Shell expression="thoughtful" title="กำลังยืนยันตัวตนกับ LINE…" busy live>
          <div className="auth-progress" aria-hidden>
            <span />
            <span />
            <span />
          </div>
          <p className="f-muted">ใช้เวลาเพียงไม่กี่วินาทีค่ะ</p>
        </Shell>
      );
    case 'login-required': // C
      return (
        <Shell portrait eyebrow="เข้าสู่ระบบ" title="เข้าสู่ระบบด้วยบัญชี LINE">
          <p className="f-muted">FLOW ใช้บัญชี LINE ของคุณยืนยันตัวตน โดยไม่ขอรหัสผ่านและไม่ขออีเมล</p>
          <Button variant="dark" size="lg" icon={Lock} onClick={actions.onLogin}>
            เข้าสู่ระบบด้วย LINE
          </Button>
          <p className="f-hint">
            <Smartphone aria-hidden className="inline-icon" /> เปิดจากแอป LINE จะเข้าสู่ระบบให้อัตโนมัติ
          </p>
        </Shell>
      );
    case 'approved': {
      // D — the application replaces this card (AuthApp); kept for the states gallery.
      const exp = new Date(view.expiresAt);
      return (
        <Shell
          expression="happy"
          eyebrow="พร้อมใช้งาน"
          title={`ยินดีต้อนรับค่ะ คุณ${view.user.displayName}`}
        >
          <p className="auth-role">
            <ShieldCheck aria-hidden className="inline-icon" /> เข้าสู่ระบบแล้ว
          </p>
          <p className="f-hint f-num">
            เซสชันหมดอายุ {formatThaiDate(exp, TZ).short} {formatThaiTime(exp, TZ)}
          </p>
        </Shell>
      );
    }
    case 'account': {
      // E — EP02: signed in, waiting for (or blocked from) access. No reference codes.
      const t = ACCOUNT_TEXT[view.account];
      return (
        <Shell expression={t.expression} eyebrow={t.eyebrow} title={t.title}>
          <p className="auth-who f-name">
            <ShieldCheck aria-hidden className="inline-icon" /> {view.user.displayName}
          </p>
          <p className="f-muted">{t.body}</p>
          {(view.account === 'new' || view.account === 'rejected') && actions.onRequestAccess ? (
            <AccessRequestForm onSubmit={actions.onRequestAccess} />
          ) : null}
          {view.account === 'pending' ? (
            <RetryButton variant="dark" onRetry={actions.onRetry}>
              ตรวจสอบอีกครั้ง
            </RetryButton>
          ) : null}
          <Button variant="ghost" size="sm" icon={LogOut} onClick={actions.onLogout}>
            ออกจากระบบ
          </Button>
        </Shell>
      );
    }
    case 'denied': // F
      return (
        <Shell expression="error" eyebrow="ไม่มีสิทธิ์เข้าถึง" title="สิทธิ์การใช้งานของบัญชีนี้ถูกยกเลิกแล้ว">
          <p className="f-muted">หากคิดว่าเป็นความผิดพลาด กรุณาติดต่อเจ้าของระบบค่ะ</p>
        </Shell>
      );
    case 'expired': // G
      return (
        <Shell expression="empty" eyebrow="เซสชันหมดอายุ" title="หมดเวลาการใช้งานแล้วค่ะ">
          {view.inClient ? (
            <p className="f-muted">กรุณาปิดหน้านี้ แล้วเปิด FLOW จากแอป LINE อีกครั้งนะคะ</p>
          ) : (
            <>
              <p className="f-muted">เพื่อความปลอดภัย กรุณาเข้าสู่ระบบอีกครั้งค่ะ</p>
              <Button variant="dark" icon={Lock} onClick={actions.onLogin}>
                เข้าสู่ระบบอีกครั้ง
              </Button>
            </>
          )}
        </Shell>
      );
    case 'unavailable': {
      // H
      const t = UNAVAILABLE_TEXT[view.cause];
      return (
        <Shell expression="error" eyebrow="ขัดข้องชั่วคราว" title={t.title}>
          <p className="f-muted">{t.body}</p>
          {view.cause !== 'config' && view.cause !== 'login-loop' ? (
            <RetryButton variant="dark" onRetry={actions.onRetry}>
              ลองอีกครั้ง
            </RetryButton>
          ) : null}
        </Shell>
      );
    }
    case 'retrying': // I
      return (
        <Shell expression="thoughtful" title="กำลังลองใหม่อีกครั้ง…" busy live>
          <div className="auth-progress" aria-hidden>
            <span />
            <span />
            <span />
          </div>
        </Shell>
      );
    case 'rate-limited': // K
      return <RateLimited retryAt={view.retryAt} onRetry={actions.onRetry} now={now} />;
    case 'logged-out': // J
      return (
        <Shell expression="default" eyebrow="ออกจากระบบแล้ว" title="ออกจากระบบเรียบร้อยแล้วค่ะ">
          <p className="f-muted">เซสชันบนอุปกรณ์นี้สิ้นสุดแล้ว แล้วพบกันใหม่นะคะ</p>
          <Button variant="dark" icon={Lock} onClick={actions.onLogin}>
            เข้าสู่ระบบอีกครั้ง
          </Button>
        </Shell>
      );
  }
}

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth">
      <header className="auth__bar">
        <img src={brandArt.flowWordmark} alt="FLOW" className="auth__mark" />
      </header>
      {children}
      <footer className="auth__sig">Designed &amp; Engineered by PDA BLISS</footer>
    </main>
  );
}

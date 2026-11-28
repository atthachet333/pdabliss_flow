/**
 * Authentication controller (framework-free, unit-tested). EP01 contract; EP02 adds the
 * account states (new / pending / rejected / suspended) — every verified user has a session.
 *
 * Sequence (per LINE LIFF guidance):
 *  1. Ask the API whether auth is configured and which LIFF ID to use (non-secret).
 *  2. liff.init() — must finish before any URL change; it also completes a pending
 *     LINE Login redirect and strips credentials from the URL.
 *  3. Reuse an existing FLOW session if the API still accepts it.
 *  4. Otherwise send the LINE-issued ID token (never profile data) to the API once.
 *     The token is held only in a local variable — never stored, logged or put in a URL.
 *  5. In the LINE in-app (LIFF) browser, login is automatic; liff.login() is only used in
 *     external browsers, at most twice per 3 minutes (redirect-loop guard).
 *
 * Request discipline (EP01 findings F01–F04):
 *  - Single flight: start/retry/login/logout never overlap; a second call while one is
 *    running joins it instead of sending another config/session/exchange sequence.
 *  - HTTP 429 → dedicated `rate-limited` state with the server's Retry-After (validated,
 *    60 s fallback). retry() is refused until that time. Nothing retries automatically.
 *  - User retries are also debounced (RETRY_COOLDOWN_MS) so rapid taps cannot burn the
 *    server's login budget.
 */
import {
  ApiNetworkError,
  ApiRateLimitedError,
  type AuthApiPort,
  DEFAULT_RETRY_AFTER_SECONDS,
  type AuthView,
  type LiffPort,
  type SignedIn,
  type UnavailableCause,
} from './types';

export interface GuardStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Minimum time between two user-initiated retries. */
export const RETRY_COOLDOWN_MS = 3000;

const GUARD_KEY = 'flow.loginAttempts';
const MAX_ATTEMPTS = 2;
const WINDOW_MS = 3 * 60_000;

/** Counts login redirects only (no tokens). Prevents infinite LINE Login loops. */
export class LoginGuard {
  constructor(
    private readonly storage: GuardStorage | null,
    private readonly now: () => number = () => Date.now(),
  ) {}
  allow(): boolean {
    const t = this.now();
    let state = { count: 0, firstAt: t };
    try {
      const raw = this.storage?.getItem(GUARD_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { count?: unknown; firstAt?: unknown };
        if (
          typeof parsed.count === 'number' &&
          typeof parsed.firstAt === 'number' &&
          t - parsed.firstAt < WINDOW_MS
        ) {
          state = { count: parsed.count, firstAt: parsed.firstAt };
        }
      }
    } catch {
      /* storage unavailable: fall through with a fresh window */
    }
    if (state.count >= MAX_ATTEMPTS) return false;
    try {
      this.storage?.setItem(
        GUARD_KEY,
        JSON.stringify({ count: state.count + 1, firstAt: state.firstAt }),
      );
    } catch {
      /* ignore */
    }
    return true;
  }
  reset(): void {
    try {
      this.storage?.removeItem(GUARD_KEY);
    } catch {
      /* ignore */
    }
  }
}

export interface AuthControllerDeps {
  api: AuthApiPort;
  loadLiff: () => Promise<LiffPort>;
  guard: LoginGuard;
  location: { origin: string; pathname: string };
  now?: () => number;
}

export class AuthController {
  private view: AuthView = { kind: 'initializing' };
  private readonly listeners = new Set<(v: AuthView) => void>();
  private liff: LiffPort | null = null;
  private readonly now: () => number;
  private inflight: Promise<void> | null = null;
  private lastAttemptAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly deps: AuthControllerDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  getView = (): AuthView => this.view;

  subscribe = (fn: (v: AuthView) => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(view: AuthView): void {
    this.view = view;
    for (const l of this.listeners) l(view);
  }

  private unavailable(cause: UnavailableCause): void {
    this.set({ kind: 'unavailable', cause });
  }

  private causeOf(err: unknown): UnavailableCause {
    return err instanceof ApiNetworkError ? 'network' : 'server';
  }

  /** Maps an API failure to the right screen (429 gets its own state, never "unavailable"). */
  private fail(err: unknown): void {
    if (err instanceof ApiRateLimitedError) return this.rateLimited(err.retryAfterSeconds);
    return this.unavailable(this.causeOf(err));
  }

  private rateLimited(retryAfterSeconds: number | null): void {
    const seconds = retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS;
    this.set({ kind: 'rate-limited', retryAt: this.now() + seconds * 1000 });
  }

  /** Single flight: while an operation runs, further calls join it. */
  private single(op: () => Promise<void>): Promise<void> {
    if (this.inflight) return this.inflight;
    const run = (async () => {
      try {
        await op();
      } finally {
        this.inflight = null;
      }
    })();
    this.inflight = run;
    return run;
  }

  /** True while start/retry/login/logout is in progress (UI disables its buttons). */
  isBusy = (): boolean => this.inflight !== null;

  /** Clean redirect target: same page, no query or hash (no credentials ever echoed back). */
  private redirectUri(): string {
    return `${this.deps.location.origin}${this.deps.location.pathname}`;
  }

  start(): Promise<void> {
    return this.single(() => this.run());
  }

  private async run(): Promise<void> {
    this.lastAttemptAt = this.now();
    if (this.view.kind !== 'retrying') this.set({ kind: 'initializing' });

    let config: { authConfigured: boolean; liffId: string | null };
    try {
      config = await this.deps.api.getConfig();
    } catch (err) {
      return this.fail(err);
    }
    if (!config.authConfigured || !config.liffId) return this.unavailable('config');

    try {
      this.liff = this.liff ?? (await this.deps.loadLiff());
      await this.liff.init(config.liffId);
    } catch {
      return this.unavailable('line');
    }
    const liff = this.liff;

    let session;
    try {
      session = await this.deps.api.getSession();
    } catch (err) {
      return this.fail(err);
    }
    if ('user' in session) return this.signedIn(session);
    // A session ended by the server (rotation, suspension, revocation) is not a verdict on the
    // account: fall through to a fresh LINE exchange, which returns the current account state.

    if (!liff.isLoggedIn()) {
      if (liff.isInClient()) return this.unavailable('line');
      return this.set(
        session.state === 'expired'
          ? { kind: 'expired', inClient: false }
          : { kind: 'login-required' },
      );
    }
    return this.exchange();
  }

  private async exchange(): Promise<void> {
    const liff = this.liff;
    if (!liff) return this.unavailable('line');
    this.set({ kind: 'authenticating' });
    const idToken = liff.getIDToken();
    const exp = liff.getIdTokenExp();
    if (!idToken || (exp !== null && exp * 1000 <= this.now() + 30_000)) return this.relogin();

    let result;
    try {
      result = await this.deps.api.exchange(idToken);
    } catch (err) {
      return this.fail(err);
    }
    if ('user' in result) return this.signedIn(result);
    switch (result.state) {
      case 'token-expired':
        return this.relogin();
      case 'token-invalid':
      case 'line-unavailable':
        return this.unavailable('line');
      case 'rate-limited':
        return this.rateLimited(result.retryAfterSeconds);
    }
  }

  /** A live session: the application (approved) or the matching account screen. */
  private signedIn(s: SignedIn): void {
    this.deps.guard.reset();
    if (s.state === 'approved')
      return this.set({ kind: 'approved', user: s.user, expiresAt: s.expiresAt });
    if (s.state === 'account-revoked') return this.set({ kind: 'denied', reason: 'revoked' });
    return this.set({ kind: 'account', account: s.state, user: s.user });
  }

  /** Re-reads the session (e.g. after an access request or an invitation). One flight. */
  refresh(): Promise<void> {
    return this.single(async () => {
      let session;
      try {
        session = await this.deps.api.getSession();
      } catch (err) {
        return this.fail(err);
      }
      if ('user' in session) return this.signedIn(session);
      return this.set(
        session.state === 'expired'
          ? { kind: 'expired', inClient: this.liff?.isInClient() ?? false }
          : { kind: 'login-required' },
      );
    });
  }

  /** Expired/missing token. LIFF browser: user reopens FLOW. External browser: guarded login. */
  private relogin(): void {
    const liff = this.liff;
    if (!liff) return this.unavailable('line');
    if (liff.isInClient()) return this.set({ kind: 'expired', inClient: true });
    if (!this.deps.guard.allow()) return this.unavailable('login-loop');
    if (liff.isLoggedIn()) liff.logout();
    this.set({ kind: 'authenticating' });
    liff.login(this.redirectUri());
  }

  /**
   * Fresh LINE verification for sensitive administration (server answered REAUTH_REQUIRED).
   * A valid LIFF ID token is exchanged again (the server verifies it with LINE and rotates
   * the session); otherwise an external browser goes through a guarded LINE login that
   * returns to `returnPath` (same origin, path only). The LINE app itself cannot be forced to
   * re-login: the user reopens FLOW from LINE. There is no password fallback.
   */
  async reauthenticate(returnPath: string): Promise<'ok' | 'redirecting' | 'unavailable'> {
    const liff = this.liff;
    if (!liff) return 'unavailable';
    const token = liff.isLoggedIn() ? liff.getIDToken() : null;
    const exp = liff.getIdTokenExp();
    const fresh = !!token && (exp === null || exp * 1000 > this.now() + 30_000);
    if (!fresh) {
      if (liff.isInClient() || !this.deps.guard.allow()) return 'unavailable';
      if (liff.isLoggedIn()) liff.logout();
      const path = returnPath.startsWith('/') && !returnPath.startsWith('//') ? returnPath : '/';
      liff.login(`${this.deps.location.origin}${path.split(/[?#]/)[0]}`);
      return 'redirecting';
    }
    try {
      const result = await this.deps.api.exchange(token as string);
      if ('user' in result && result.state === 'approved') {
        this.set({ kind: 'approved', user: result.user, expiresAt: result.expiresAt });
        return 'ok';
      }
    } catch {
      /* falls through */
    }
    return 'unavailable';
  }

  /** "Log in with LINE" button (external browsers). */
  login(): Promise<void> {
    return this.single(async () => {
      if (!this.liff || this.liff.isInClient()) return this.run();
      if (!this.deps.guard.allow()) return this.unavailable('login-loop');
      this.set({ kind: 'authenticating' });
      this.liff.login(this.redirectUri());
    });
  }

  /**
   * User-initiated retry. Refused (no request) while another operation runs, before a
   * rate-limit's permitted time, or within RETRY_COOLDOWN_MS of the previous attempt.
   */
  retry(): Promise<void> {
    if (this.inflight) return this.inflight;
    const t = this.now();
    if (this.view.kind === 'rate-limited' && t < this.view.retryAt) return Promise.resolve();
    if (t - this.lastAttemptAt < RETRY_COOLDOWN_MS) return Promise.resolve();
    return this.single(async () => {
      this.set({ kind: 'retrying' });
      await this.run();
    });
  }

  /**
   * Application logout: ends the FLOW server session (revoked server-side, cookie cleared).
   * It never logs the user out of LINE itself and never touches their approved membership.
   * External browsers also drop the LIFF token this site holds, so a shared computer does not
   * silently sign back in; inside the LINE app the LINE identity stays and "sign in again"
   * is one tap.
   */
  logout(): Promise<void> {
    return this.single(async () => {
      try {
        await this.deps.api.logout();
      } catch {
        /* the server session expires on its own; continue clearing local LINE state */
      }
      const liff = this.liff;
      if (liff && !liff.isInClient() && liff.isLoggedIn()) liff.logout();
      this.deps.guard.reset();
      this.set({ kind: 'logged-out' });
    });
  }
}

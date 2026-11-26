/** Authentication view model — every screen the user can see (EP01 A–K, EP02 account states). */
export type UnavailableCause = 'network' | 'line' | 'server' | 'config' | 'login-loop';

export type GlobalRole = 'OWNER' | 'ADMIN' | 'USER';
export type AccountStatus = 'NEW' | 'PENDING' | 'ACTIVE' | 'REJECTED' | 'SUSPENDED' | 'REVOKED';
/** Verified user with a FLOW session (any status). Never contains a LINE user id. */
export interface SessionUser {
  id: string;
  displayName: string;
  status: AccountStatus;
  globalRole: GlobalRole;
}
/** Signed-in, but not (or no longer) allowed to use the application. */
export type LimitedAccount = 'new' | 'pending' | 'rejected' | 'suspended';

export type AuthView =
  | { kind: 'initializing' } // A
  | { kind: 'authenticating' } // B
  | { kind: 'login-required' } // C
  | { kind: 'approved'; user: SessionUser; expiresAt: string } // D → the application
  | { kind: 'account'; account: LimitedAccount; user: SessionUser } // E (EP02: in-app request)
  | { kind: 'denied'; reason: 'revoked' } // F
  | { kind: 'expired'; inClient: boolean } // G
  | { kind: 'unavailable'; cause: UnavailableCause } // H
  | { kind: 'retrying' } // I
  | { kind: 'logged-out' } // J
  /** K: the server answered 429. `retryAt` = epoch ms when a retry is permitted. */
  | { kind: 'rate-limited'; retryAt: number };

/** A live FLOW session; `state` is the account state (only "approved" may use the app). */
export type SignedIn = {
  state: 'approved' | LimitedAccount | 'account-revoked';
  user: SessionUser;
  expiresAt: string;
};

export type SessionResult = SignedIn | { state: 'unauthenticated' | 'expired' | 'revoked' };

export type ExchangeResult =
  | SignedIn
  | { state: 'token-expired' }
  | { state: 'token-invalid' }
  | { state: 'line-unavailable' }
  | { state: 'rate-limited'; retryAfterSeconds: number | null };

export interface LineStatus {
  bot: { basicId: string; displayName: string };
  quota: { type: 'none' | 'limited'; value: number | null };
  consumption: { totalUsage: number };
  webhook: { received: number; duplicates: number; unknown: number; pendingGroups: number };
  checkedAt: string;
}

export interface AuthApiPort {
  getConfig(): Promise<{ authConfigured: boolean; liffId: string | null }>;
  getSession(): Promise<SessionResult>;
  exchange(idToken: string): Promise<ExchangeResult>;
  logout(): Promise<void>;
  lineStatus(): Promise<LineStatus>;
}

/** Narrow view of the LIFF SDK so the flow can be tested without LINE. */
export interface LiffPort {
  init(liffId: string): Promise<void>;
  isInClient(): boolean;
  isLoggedIn(): boolean;
  login(redirectUri: string): void;
  logout(): void;
  getIDToken(): string | null;
  /** `exp` (seconds) of the current ID token, if any. */
  getIdTokenExp(): number | null;
}

export class ApiNetworkError extends Error {
  constructor() {
    super('network');
    this.name = 'ApiNetworkError';
  }
}

export class ApiServerError extends Error {
  constructor(public readonly status: number) {
    super(`server ${status}`);
    this.name = 'ApiServerError';
  }
}

/** HTTP 429 from the API. `retryAfterSeconds` is null when the header was missing or invalid. */
export class ApiRateLimitedError extends Error {
  constructor(public readonly retryAfterSeconds: number | null) {
    super('rate-limited');
    this.name = 'ApiRateLimitedError';
  }
}

/** Upper bound for a server-provided wait (the API's longest window is 5 minutes). */
export const MAX_RETRY_AFTER_SECONDS = 900;
/** Used when Retry-After is missing or invalid: wait, never retry immediately. */
export const DEFAULT_RETRY_AFTER_SECONDS = 60;

/**
 * Parses a Retry-After header (RFC 9110: delay-seconds or HTTP-date).
 * Returns whole seconds in [1, MAX_RETRY_AFTER_SECONDS], or null if missing/invalid.
 */
export function parseRetryAfter(value: string | null | undefined, now: number): number | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v) return null;
  let seconds: number;
  if (/^\d{1,7}$/.test(v)) seconds = Number(v);
  else {
    const at = Date.parse(v);
    if (!Number.isFinite(at) || !/[A-Za-z]/.test(v)) return null;
    seconds = Math.ceil((at - now) / 1000);
  }
  if (!Number.isFinite(seconds)) return null;
  // "0" or a date already reached: the server allows an immediate retry; still wait 1 s.
  return Math.min(Math.max(seconds, 1), MAX_RETRY_AFTER_SECONDS);
}

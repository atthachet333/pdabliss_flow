/**
 * Same-origin client for the FLOW API (auth + /api/v1).
 * - Session lives in an HttpOnly cookie (JavaScript cannot read it).
 * - The CSRF token is kept ONLY in memory for this page lifetime.
 * - The LINE ID token is sent once, in a POST body, and never stored.
 */
import {
  ApiNetworkError,
  ApiRateLimitedError,
  ApiServerError,
  type AuthApiPort,
  type ExchangeResult,
  type LineStatus,
  parseRetryAfter,
  type SessionResult,
  type SessionUser,
  type SignedIn,
} from './types';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface SessionBody {
  state?: string;
  user?: SessionUser;
  session?: { expiresAt: string };
  csrfToken?: string;
  error?: { code?: string };
}

const ACCOUNT_STATES = new Set(['approved', 'new', 'pending', 'rejected', 'suspended', 'revoked']);

/** A 200 session body → typed result (account "revoked" is distinct from a revoked session). */
function signedIn(body: SessionBody): SignedIn | null {
  if (!body.state || !ACCOUNT_STATES.has(body.state) || !body.user || !body.session) return null;
  const state = body.state === 'revoked' ? 'account-revoked' : (body.state as SignedIn['state']);
  return { state, user: body.user, expiresAt: body.session.expiresAt };
}

/** Error from /api/v1 with the server's code (never a raw body). */
export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly details: Record<string, unknown> | undefined = undefined,
  ) {
    super(code);
    this.name = 'ApiRequestError';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Required by the server for appointment creation (safe retries, no duplicates). */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export class FlowApiClient implements AuthApiPort {
  private csrfToken: string | null = null;
  constructor(
    private readonly fetchImpl: FetchLike = (i, init) => fetch(i, init),
    private readonly now: () => number = () => Date.now(),
  ) {}

  private async call(
    path: string,
    init: RequestInit = {},
  ): Promise<{ status: number; body: SessionBody & Record<string, unknown> }> {
    const res = await this.raw(path, init);
    // 429 from any route: surface the server's Retry-After (validated) to the flow.
    if (res.status === 429) {
      throw new ApiRateLimitedError(parseRetryAfter(res.headers.get('retry-after'), this.now()));
    }
    let body: SessionBody & Record<string, unknown>;
    try {
      body = (await res.json()) as SessionBody & Record<string, unknown>;
    } catch {
      throw new ApiServerError(res.status);
    }
    return { status: res.status, body };
  }

  private async raw(path: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchImpl(path, {
        ...init,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { accept: 'application/json', ...(init.headers ?? {}) },
      });
    } catch {
      throw new ApiNetworkError();
    }
    return res;
  }

  async getConfig() {
    const { status, body } = await this.call('/api/auth/config');
    if (status !== 200) throw new ApiServerError(status);
    return {
      authConfigured: body.authConfigured === true,
      liffId: typeof body.liffId === 'string' ? body.liffId : null,
    };
  }

  /**
   * JSON request to /api/v1. Mutations carry the in-memory CSRF token. Network failures throw
   * ApiNetworkError and are NEVER queued or replayed automatically (no silent offline writes).
   */
  async request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const method = opts.method ?? 'GET';
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (method !== 'GET' && this.csrfToken) headers['x-flow-csrf'] = this.csrfToken;
    if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
    const { status, body } = await this.call(`/api/v1${path}`, {
      method,
      headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    if (status >= 200 && status < 300) return body as T;
    const err = (body as { error?: { code?: string; details?: Record<string, unknown> } }).error;
    throw new ApiRequestError(status, err?.code ?? `HTTP_${status}`, err?.details);
  }

  hasCsrf(): boolean {
    return this.csrfToken !== null;
  }

  async getSession(): Promise<SessionResult> {
    const { status, body } = await this.call('/api/auth/session');
    const live = status === 200 ? signedIn(body) : null;
    if (live) {
      this.csrfToken = body.csrfToken ?? null;
      return live;
    }
    this.csrfToken = null;
    if (
      status === 401 &&
      (body.state === 'expired' || body.state === 'revoked' || body.state === 'unauthenticated')
    ) {
      return { state: body.state };
    }
    throw new ApiServerError(status);
  }

  async exchange(idToken: string): Promise<ExchangeResult> {
    let response;
    try {
      response = await this.call('/api/auth/line', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
    } catch (err) {
      if (err instanceof ApiRateLimitedError) {
        this.csrfToken = null;
        return { state: 'rate-limited', retryAfterSeconds: err.retryAfterSeconds };
      }
      throw err;
    }
    const { status, body } = response;
    const live = status === 200 ? signedIn(body) : null;
    if (live) {
      this.csrfToken = body.csrfToken ?? null;
      return live;
    }
    this.csrfToken = null;
    const code = body.error?.code;
    if (code === 'ID_TOKEN_EXPIRED') return { state: 'token-expired' };
    if (code === 'ID_TOKEN_INVALID') return { state: 'token-invalid' };
    if (code === 'LINE_UNAVAILABLE') return { state: 'line-unavailable' };
    throw new ApiServerError(status);
  }

  async logout(): Promise<void> {
    const { status } = await this.call('/api/auth/logout', {
      method: 'POST',
      headers: this.csrfToken ? { 'x-flow-csrf': this.csrfToken } : {},
    });
    this.csrfToken = null;
    if (status !== 200) throw new ApiServerError(status);
  }

  async lineStatus(): Promise<LineStatus> {
    const { status, body } = await this.call('/api/line/status');
    if (status !== 200) throw new ApiServerError(status);
    return body as unknown as LineStatus;
  }
}

/**
 * Same-origin client for the FLOW auth API.
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
} from './types';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface SessionBody {
  state?: string;
  user?: { displayName: string | null; role: 'owner' | 'tester' };
  session?: { expiresAt: string };
  csrfToken?: string;
  enrollmentRef?: string | null;
  error?: { code?: string };
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

  async getSession(): Promise<SessionResult> {
    const { status, body } = await this.call('/api/auth/session');
    if (status === 200 && body.state === 'approved' && body.user && body.session) {
      this.csrfToken = body.csrfToken ?? null;
      return { state: 'approved', user: body.user, expiresAt: body.session.expiresAt };
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
    if (status === 200 && body.state === 'approved' && body.user && body.session) {
      this.csrfToken = body.csrfToken ?? null;
      return { state: 'approved', user: body.user, expiresAt: body.session.expiresAt };
    }
    this.csrfToken = null;
    if (status === 403 && body.state === 'not-approved')
      return { state: 'not-approved', enrollmentRef: body.enrollmentRef ?? null };
    if (status === 403 && body.state === 'revoked') return { state: 'revoked' };
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

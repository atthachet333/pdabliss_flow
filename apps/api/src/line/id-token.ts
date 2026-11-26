/**
 * LINE ID token verification (EP01).
 *
 * Uses LINE's official verification endpoint (POST https://api.line.me/oauth2/v2.1/verify,
 * form fields id_token + client_id), which checks the signature, issuer, audience and
 * expiry. The claims are then re-checked locally (defence in depth). Client-supplied
 * identity data is never trusted: only `sub` from a verified token identifies a user.
 */
import { z } from 'zod';

export const LINE_ISSUER = 'https://access.line.me';
export const VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify';
const MAX_TOKEN_LENGTH = 4096;
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const LINE_USER_ID = /^U[0-9a-f]{32}$/;
const CLOCK_SKEW_S = 60;

export type IdTokenFailure =
  'malformed' | 'invalid' | 'expired' | 'wrong-audience' | 'wrong-issuer' | 'upstream';

export interface VerifiedIdentity {
  sub: string;
  name: string | null;
  exp: number;
  iat: number;
  amr: string[];
}

export type IdTokenResult =
  { ok: true; identity: VerifiedIdentity } | { ok: false; reason: IdTokenFailure };

export interface IdTokenVerifier {
  verify(idToken: string): Promise<IdTokenResult>;
}

const claimsSchema = z.object({
  iss: z.string(),
  sub: z.string(),
  aud: z.string(),
  exp: z.number(),
  iat: z.number(),
  name: z.string().optional(),
  amr: z.array(z.string()).optional(),
});

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function createLineIdTokenVerifier(opts: {
  channelId: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  now?: () => number;
}): IdTokenVerifier {
  const fetchImpl = opts.fetchImpl ?? ((i, init) => fetch(i, init));
  const now = opts.now ?? (() => Date.now());
  const timeoutMs = opts.timeoutMs ?? 5000;

  return {
    async verify(idToken) {
      if (
        typeof idToken !== 'string' ||
        idToken.length > MAX_TOKEN_LENGTH ||
        !JWT_SHAPE.test(idToken)
      ) {
        return { ok: false, reason: 'malformed' };
      }
      let res: Response;
      try {
        res = await fetchImpl(VERIFY_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ id_token: idToken, client_id: opts.channelId }).toString(),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        return { ok: false, reason: 'upstream' };
      }

      let body: unknown;
      try {
        body = await res.json();
      } catch {
        return { ok: false, reason: res.status >= 500 ? 'upstream' : 'invalid' };
      }

      if (!res.ok) {
        if (res.status >= 500 || res.status === 429) return { ok: false, reason: 'upstream' };
        const desc =
          typeof body === 'object' && body !== null && 'error_description' in body
            ? String((body as { error_description: unknown }).error_description)
            : '';
        if (/expired/i.test(desc)) return { ok: false, reason: 'expired' };
        if (/audience/i.test(desc)) return { ok: false, reason: 'wrong-audience' };
        if (/issuer/i.test(desc)) return { ok: false, reason: 'wrong-issuer' };
        return { ok: false, reason: 'invalid' };
      }

      const parsed = claimsSchema.safeParse(body);
      if (!parsed.success) return { ok: false, reason: 'invalid' };
      const c = parsed.data;
      const nowS = Math.floor(now() / 1000);
      if (c.iss !== LINE_ISSUER) return { ok: false, reason: 'wrong-issuer' };
      if (c.aud !== opts.channelId) return { ok: false, reason: 'wrong-audience' };
      if (c.exp <= nowS) return { ok: false, reason: 'expired' };
      if (c.iat > nowS + CLOCK_SKEW_S) return { ok: false, reason: 'invalid' };
      if (!LINE_USER_ID.test(c.sub)) return { ok: false, reason: 'invalid' };
      return {
        ok: true,
        identity: { sub: c.sub, name: c.name ?? null, exp: c.exp, iat: c.iat, amr: c.amr ?? [] },
      };
    },
  };
}

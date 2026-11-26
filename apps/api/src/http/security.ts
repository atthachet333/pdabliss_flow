/** Cookie, origin and client-address helpers shared by EP01 routes. */
import { isIP } from 'node:net';
import type { FastifyReply, FastifyRequest } from 'fastify';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export interface CookieSettings {
  name: string;
  secure: boolean;
}

/** `__Host-` prefix (Secure, Path=/, no Domain) whenever the public origin is HTTPS. */
export function cookieSettings(publicBaseUrl: string | null): CookieSettings {
  const secure = Boolean(publicBaseUrl?.startsWith('https://'));
  return { name: secure ? '__Host-flow_session' : 'flow_session', secure };
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k && !(k in out)) out[k] = v;
  }
  return out;
}

export function setSessionCookie(
  reply: FastifyReply,
  c: CookieSettings,
  value: string,
  maxAgeS: number,
): void {
  const attrs = [
    `${c.name}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeS))}`,
  ];
  if (c.secure) attrs.push('Secure');
  reply.header('set-cookie', attrs.join('; '));
}

export function clearSessionCookie(reply: FastifyReply, c: CookieSettings): void {
  setSessionCookie(reply, c, '', 0);
}

export function readSessionCookie(request: FastifyRequest, c: CookieSettings): string | undefined {
  return parseCookies(request.headers.cookie)[c.name];
}

/** State-changing requests must come from an allowed origin (exact match). */
export function originAllowed(request: FastifyRequest, allowed: ReadonlySet<string>): boolean {
  const origin = request.headers.origin;
  return typeof origin === 'string' && allowed.has(origin);
}

/**
 * Client address for rate limiting (EP01 proxy review, F05).
 *
 * Trust chain: Cloudflare edge sets `CF-Connecting-IP` → cloudflared → dev gateway
 * (loopback) copies it into `x-flow-client-ip` after dropping any client-sent copy → API.
 * The API accepts `x-flow-client-ip` ONLY from a loopback peer and ONLY when it is a single
 * IP literal; otherwise the socket peer is used. Fastify `trustProxy` stays false, so
 * `X-Forwarded-For` / `Forwarded` are never used for identity.
 * Development limitation: any local process can choose this header (documented).
 */
export function clientAddress(request: FastifyRequest): string {
  const peer = request.socket.remoteAddress ?? 'unknown';
  const forwarded = request.headers['x-flow-client-ip'];
  if (LOOPBACK.has(peer) && typeof forwarded === 'string' && isIP(forwarded) !== 0)
    return forwarded;
  return peer;
}

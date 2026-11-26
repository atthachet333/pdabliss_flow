/**
 * FLOW development gateway (EP01) — the ONLY process a temporary HTTPS tunnel may point at.
 *
 *   cloudflared (owner-approved) ──► 127.0.0.1:6769 gateway ──► 127.0.0.1:6768 API
 *                                          └── serves apps/web/dist (production build)
 *
 * Exposes exactly:
 *   - the built LIFF frontend (index.html for an allow-listed set of app routes + hashed assets)
 *   - GET  /api/health, GET /api/auth/config, POST /api/auth/line, GET /api/auth/session,
 *     POST /api/auth/logout, POST /api/line/webhook, GET /api/line/status
 * Everything else is 404: /dev/*, source maps, dotfiles, source/tooling paths, Vite dev
 * server, other API routes. Binds to loopback only. No dependencies.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { isIP } from 'node:net';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const API_ALLOWLIST: ReadonlyArray<readonly [string, string]> = [
  ['GET', '/api/health'],
  ['GET', '/api/auth/config'],
  ['POST', '/api/auth/line'],
  ['GET', '/api/auth/session'],
  ['POST', '/api/auth/logout'],
  ['POST', '/api/line/webhook'],
  ['GET', '/api/line/status'],
];

/** Client routes that may receive index.html (LIFF endpoint + rich-menu deep links). */
export const APP_ROUTES = new Set([
  '/',
  '/today',
  '/calendar',
  '/appointments/new',
  '/groups',
  '/history',
  '/settings',
]);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
};

const LINE_ORIGINS = 'https://*.line.me https://*.line-scdn.net https://*.line-apps.com';
export const HTML_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: ${LINE_ORIGINS}`,
  "font-src 'self'",
  `connect-src 'self' ${LINE_ORIGINS}`,
  `frame-src ${LINE_ORIGINS}`,
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

const BASE_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin-allow-popups',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
]);

/**
 * Client-supplied forwarding headers are dropped before forwarding (F05). The API only
 * ever trusts `x-flow-client-ip`, which the gateway sets itself.
 */
const UNTRUSTED_FORWARDING = new Set([
  'x-flow-client-ip',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
  'forwarded',
  'true-client-ip',
]);

/** Cloudflare's client address when it is a single IP literal, else the socket peer. */
export function forwardedClientIp(req: IncomingMessage): string {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && isIP(cf.trim()) !== 0) return cf.trim();
  return req.socket.remoteAddress ?? 'unknown';
}

export interface GatewayOptions {
  webDist: string;
  apiHost: string;
  apiPort: number;
}

function send(
  res: ServerResponse,
  status: number,
  body: string,
  type = 'text/plain; charset=utf-8',
): void {
  res.writeHead(status, { ...BASE_HEADERS, 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

function isForbiddenPath(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.startsWith('/dev/') ||
    lower === '/dev' ||
    lower.endsWith('.map') ||
    lower.split('/').some((seg) => seg.startsWith('.') && seg.length > 0) ||
    /^\/(src|node_modules|@vite|@fs|@id|@react-refresh|apps|packages|scripts|docs)(\/|$)/.test(
      lower,
    )
  );
}

function serveFile(res: ServerResponse, file: string, method: string, immutable: boolean): void {
  const type = MIME[extname(file)] ?? 'application/octet-stream';
  const headers: Record<string, string> = {
    ...BASE_HEADERS,
    'content-type': type,
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-store',
  };
  if (type.startsWith('text/html')) headers['content-security-policy'] = HTML_CSP;
  res.writeHead(200, headers);
  if (method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}

function proxy(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  opts: GatewayOptions,
): void {
  const headers: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined || HOP_BY_HOP.has(k) || UNTRUSTED_FORWARDING.has(k)) continue;
    headers[k] = v;
  }
  headers['x-flow-client-ip'] = forwardedClientIp(req);
  const upstream = httpRequest(
    { host: opts.apiHost, port: opts.apiPort, method: req.method, path, headers, timeout: 15_000 },
    (up) => {
      const out: Record<string, string | string[]> = {};
      for (const [k, v] of Object.entries(up.headers))
        if (v !== undefined && !HOP_BY_HOP.has(k)) out[k] = v;
      res.writeHead(up.statusCode ?? 502, out);
      up.pipe(res);
    },
  );
  upstream.on('timeout', () => upstream.destroy(new Error('upstream timeout')));
  upstream.on('error', () => {
    if (!res.headersSent)
      send(
        res,
        502,
        JSON.stringify({ error: { code: 'UPSTREAM_UNAVAILABLE', message: 'API unavailable' } }),
        'application/json',
      );
    else res.destroy();
  });
  req.pipe(upstream);
}

export function createGateway(opts: GatewayOptions): Server {
  const root = resolve(opts.webDist);
  return createServer((req, res) => {
    const method = req.method ?? 'GET';
    let path: string;
    try {
      path = decodeURIComponent(new URL(req.url ?? '/', 'http://gateway.local').pathname);
    } catch {
      send(res, 400, 'Bad request');
      return;
    }
    const rawQuery = (req.url ?? '').includes('?')
      ? (req.url ?? '').slice((req.url ?? '').indexOf('?'))
      : '';

    if (path.startsWith('/api/') || path === '/api') {
      if (API_ALLOWLIST.some(([m, p]) => m === method && p === path)) {
        proxy(req, res, path + rawQuery, opts);
      } else {
        send(
          res,
          404,
          JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }),
          'application/json',
        );
      }
      return;
    }

    if (method !== 'GET' && method !== 'HEAD') {
      send(res, 405, 'Method not allowed');
      return;
    }
    if (path.includes('\0') || isForbiddenPath(path)) {
      send(res, 404, 'Not found');
      return;
    }

    if (path.startsWith('/assets/') || path === '/favicon.svg') {
      const file = normalize(join(root, path));
      if (file.startsWith(root + sep) && existsSync(file) && statSync(file).isFile()) {
        serveFile(res, file, method, path.startsWith('/assets/'));
        return;
      }
      send(res, 404, 'Not found');
      return;
    }

    const route = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
    if (APP_ROUTES.has(route)) {
      const index = join(root, 'index.html');
      if (existsSync(index)) {
        serveFile(res, index, method, false);
        return;
      }
      send(res, 503, 'Frontend build missing — run npm run build first.');
      return;
    }
    send(res, 404, 'Not found');
  });
}

const isEntrypoint =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const port = Number(process.env.GATEWAY_PORT ?? 6769);
  const opts: GatewayOptions = {
    webDist: process.env.GATEWAY_WEB_DIST ?? join(projectRoot, 'apps', 'web', 'dist'),
    apiHost: '127.0.0.1',
    apiPort: Number(process.env.API_PORT ?? 6768),
  };
  const server = createGateway(opts);
  server.listen(port, '127.0.0.1', () => {
    console.log(
      `FLOW dev gateway on http://127.0.0.1:${port} → API 127.0.0.1:${opts.apiPort}, web ${opts.webDist}`,
    );
  });
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

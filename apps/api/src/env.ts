/**
 * Environment validation. Fails fast with a readable message; never echoes values
 * (some future variables are secrets).
 */
import { z } from 'zod';

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(6768),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGINS: z.string().default('http://localhost:6767,http://127.0.0.1:6767'),
  /** Must be "true" to bind a non-loopback address outside production. */
  ALLOW_NON_LOOPBACK: z.enum(['true', 'false']).default('false'),

  // ---- EP01 integration (all optional; features fail closed when absent) ----
  PUBLIC_BASE_URL: z.string().optional(),
  LINE_LOGIN_CHANNEL_ID: z
    .string()
    .regex(/^\d{10}$/, 'must be a 10-digit channel ID')
    .optional(),
  LINE_MESSAGING_CHANNEL_ID: z
    .string()
    .regex(/^\d{10}$/, 'must be a 10-digit channel ID')
    .optional(),
  LINE_LIFF_ID: z
    .string()
    .regex(/^\d{10}-[A-Za-z0-9]{8}$/, 'must look like 1234567890-AbCdEfGh')
    .optional(),
  LINE_MESSAGING_CHANNEL_SECRET: z
    .string()
    .regex(/^[0-9a-f]{32}$/, 'must be 32 hex characters')
    .optional(),
  LINE_CHANNEL_ACCESS_TOKEN: z
    .string()
    .regex(/^[A-Za-z0-9+/=._-]{40,}$/, 'has an unexpected format')
    .optional(),
  LINE_BOT_USER_ID: z
    .string()
    .regex(/^U[0-9a-f]{32}$/, 'must be a LINE user ID')
    .optional(),
  SESSION_SECRET: z.string().min(32, 'must be at least 32 characters').optional(),
  FLOW_ALLOWED_LINE_USER_IDS: z.string().optional(),
  FLOW_SECRET_DIR: z.string().optional(),
  SESSION_ABSOLUTE_MINUTES: z.coerce.number().int().min(5).max(1440).default(480),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(1440).default(120),
});

export interface LineConfig {
  loginChannelId: string | null;
  messagingChannelId: string | null;
  liffId: string | null;
  messagingChannelSecret: string | null;
  channelAccessToken: string | null;
  botUserId: string | null;
}

/** EP01 integration settings. Values are secrets or near-secrets: never log this object. */
export interface IntegrationConfig {
  publicBaseUrl: string | null;
  line: LineConfig;
  sessionSecret: string | null;
  allowedLineUserIds: string[];
  secretDir: string | null;
  sessionAbsoluteMinutes: number;
  sessionIdleMinutes: number;
}

export interface AppEnv {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL'];
  corsOrigins: string[];
  /** Absent in EP00-style configs; every integration feature is then disabled (fail closed). */
  integration?: IntegrationConfig;
}

/** Login exchange needs the LINE Login channel, the LIFF ID and a session secret. */
export function isAuthConfigured(i: IntegrationConfig | undefined): i is IntegrationConfig & {
  sessionSecret: string;
  line: LineConfig & { loginChannelId: string; liffId: string };
} {
  return Boolean(i?.line.loginChannelId && i.line.liffId && i.sessionSecret);
}

/** Webhook verification needs the Messaging API channel secret. */
export function isWebhookConfigured(i: IntegrationConfig | undefined): boolean {
  return Boolean(i?.line.messagingChannelSecret);
}

export class EnvError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid environment configuration:\n - ${problems.join('\n - ')}`);
    this.name = 'EnvError';
  }
}

export function loadEnv(source: Record<string, string | undefined> = process.env): AppEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    // Report variable names and rule messages only — never the offending values.
    throw new EnvError(
      parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  const e = parsed.data;
  const problems: string[] = [];

  if (e.NODE_ENV !== 'production' && !LOOPBACK.has(e.API_HOST) && e.ALLOW_NON_LOOPBACK !== 'true') {
    problems.push(
      'API_HOST: development/test must bind to loopback (set ALLOW_NON_LOOPBACK=true to override deliberately)',
    );
  }

  const corsOrigins = e.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  for (const origin of corsOrigins) {
    if (origin === '*') {
      problems.push('CORS_ORIGINS: wildcard "*" is not allowed');
      continue;
    }
    try {
      const u = new URL(origin);
      if (u.origin !== origin)
        problems.push(`CORS_ORIGINS: "${origin}" must be a bare origin (scheme://host[:port])`);
    } catch {
      problems.push(`CORS_ORIGINS: "${origin}" is not a valid origin`);
    }
  }
  let publicBaseUrl: string | null = null;
  if (e.PUBLIC_BASE_URL) {
    try {
      const u = new URL(e.PUBLIC_BASE_URL);
      const loopbackHttp = u.protocol === 'http:' && LOOPBACK.has(u.hostname);
      if (u.protocol !== 'https:' && !(loopbackHttp && e.NODE_ENV !== 'production')) {
        problems.push(
          'PUBLIC_BASE_URL: must use https (plain http is allowed only for loopback in development)',
        );
      } else {
        publicBaseUrl = u.origin;
      }
    } catch {
      problems.push('PUBLIC_BASE_URL: is not a valid URL');
    }
  }

  const allowedLineUserIds = (e.FLOW_ALLOWED_LINE_USER_IDS ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  if (allowedLineUserIds.some((id) => !/^U[0-9a-f]{32}$/.test(id))) {
    problems.push('FLOW_ALLOWED_LINE_USER_IDS: every entry must be a LINE user ID (U + 32 hex)');
  }

  if (
    e.LINE_LIFF_ID &&
    e.LINE_LOGIN_CHANNEL_ID &&
    !e.LINE_LIFF_ID.startsWith(`${e.LINE_LOGIN_CHANNEL_ID}-`)
  ) {
    problems.push('LINE_LIFF_ID: must belong to LINE_LOGIN_CHANNEL_ID');
  }

  const integration: IntegrationConfig = {
    publicBaseUrl,
    line: {
      loginChannelId: e.LINE_LOGIN_CHANNEL_ID ?? null,
      messagingChannelId: e.LINE_MESSAGING_CHANNEL_ID ?? null,
      liffId: e.LINE_LIFF_ID ?? null,
      messagingChannelSecret: e.LINE_MESSAGING_CHANNEL_SECRET ?? null,
      channelAccessToken: e.LINE_CHANNEL_ACCESS_TOKEN ?? null,
      botUserId: e.LINE_BOT_USER_ID ?? null,
    },
    sessionSecret: e.SESSION_SECRET ?? null,
    allowedLineUserIds,
    secretDir: e.FLOW_SECRET_DIR ?? null,
    sessionAbsoluteMinutes: e.SESSION_ABSOLUTE_MINUTES,
    sessionIdleMinutes: e.SESSION_IDLE_MINUTES,
  };

  if (e.NODE_ENV === 'production') {
    if (!isAuthConfigured(integration))
      problems.push('production requires LINE Login, LIFF and SESSION_SECRET configuration');
    if (!publicBaseUrl) problems.push('production requires an https PUBLIC_BASE_URL');
  }

  if (problems.length > 0) throw new EnvError(problems);

  return {
    nodeEnv: e.NODE_ENV,
    host: e.API_HOST,
    port: e.API_PORT,
    logLevel: e.LOG_LEVEL,
    corsOrigins:
      publicBaseUrl && !corsOrigins.includes(publicBaseUrl)
        ? [...corsOrigins, publicBaseUrl]
        : corsOrigins,
    integration,
  };
}

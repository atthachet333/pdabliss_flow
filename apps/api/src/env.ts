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
});

export interface AppEnv {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL'];
  corsOrigins: string[];
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
  if (problems.length > 0) throw new EnvError(problems);

  return {
    nodeEnv: e.NODE_ENV,
    host: e.API_HOST,
    port: e.API_PORT,
    logLevel: e.LOG_LEVEL,
    corsOrigins,
  };
}

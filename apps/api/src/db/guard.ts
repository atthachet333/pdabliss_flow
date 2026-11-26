/**
 * Database target guards (EP02). Every connection and every Prisma CLI call goes through
 * these checks first. Messages never contain the URL, the user name or the password.
 *
 *  - Only `mysql://` / `mariadb://` URLs on a loopback host are accepted in EP02.
 *  - Each purpose has exactly one allowed database name.
 *  - The production database name is always refused in EP02.
 *  - Destructive test operations additionally verify `SELECT DATABASE()` at runtime.
 */
export const DB_NAMES = {
  dev: 'pdabliss_flow_dev',
  test: 'pdabliss_flow_test',
  shadow: 'pdabliss_flow_shadow',
  production: 'pdabliss_flow',
} as const;

export type DbPurpose = 'dev-runtime' | 'dev-migrate' | 'test' | 'shadow';

const EXPECTED: Record<DbPurpose, string> = {
  'dev-runtime': DB_NAMES.dev,
  'dev-migrate': DB_NAMES.dev,
  test: DB_NAMES.test,
  shadow: DB_NAMES.shadow,
};

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export class DbGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbGuardError';
  }
}

export interface DbTarget {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/** Parses a connection URL. Errors never echo the input. */
export function parseDatabaseUrl(url: string | undefined): DbTarget {
  if (!url || !url.trim()) throw new DbGuardError('Database URL is missing.');
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    throw new DbGuardError('Database URL is not a valid URL.');
  }
  if (u.protocol !== 'mysql:' && u.protocol !== 'mariadb:') {
    throw new DbGuardError('Database URL must use the mysql:// or mariadb:// scheme.');
  }
  const database = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (!database || database.includes('/')) {
    throw new DbGuardError('Database URL must name exactly one database.');
  }
  if (!u.username) throw new DbGuardError('Database URL must include a user name.');
  if (u.search || u.hash) {
    // Parameters could redirect a connection (socket, database override): ambiguous → refuse.
    throw new DbGuardError('Database URL must not contain query parameters or fragments.');
  }
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database,
  };
}

/** Validates a URL for a purpose and returns the parsed target. Fails closed. */
export function assertDatabaseTarget(url: string | undefined, purpose: DbPurpose): DbTarget {
  const t = parseDatabaseUrl(url);
  if (t.database === DB_NAMES.production) {
    throw new DbGuardError(
      'The production database is not an allowed target in EP02 (development only).',
    );
  }
  const expected = EXPECTED[purpose];
  if (t.database !== expected) {
    throw new DbGuardError(
      `Unexpected database for ${purpose}: expected "${expected}" (got a different name).`,
    );
  }
  if (!LOOPBACK.has(t.host.toLowerCase())) {
    throw new DbGuardError(`The ${purpose} database must be on this computer (loopback host).`);
  }
  if (!Number.isInteger(t.port) || t.port < 1 || t.port > 65535) {
    throw new DbGuardError('Database port is invalid.');
  }
  return t;
}

/** Destructive operations (truncate/reset) are allowed ONLY on the test database. */
export function assertDestructiveAllowed(url: string | undefined): DbTarget {
  return assertDatabaseTarget(url, 'test');
}

/** Redacted description for logs: host:port/database (no user, no password). */
export function describeTarget(t: DbTarget): string {
  return `${t.host}:${t.port}/${t.database}`;
}

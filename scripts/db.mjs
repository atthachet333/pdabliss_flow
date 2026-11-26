#!/usr/bin/env node
/**
 * Guarded Prisma CLI wrapper (EP02). The ONLY supported way to run Prisma commands.
 *
 *   node scripts/db.mjs generate
 *   node scripts/db.mjs validate
 *   node scripts/db.mjs status   dev|test          migration status
 *   node scripts/db.mjs deploy   dev|test          apply committed migrations (never resets)
 *   node scripts/db.mjs drift                      committed migrations vs schema (shadow DB)
 *   node scripts/db.mjs whoami   dev|test          database name only (sanity check)
 *
 * Connection strings come from the external secret files (%USERPROFILE%\.pdabliss\flow\
 * dev.env and test.env), are checked by the same rules as apps/api/src/db/guard.ts, and are
 * passed to Prisma only through the child process environment. Nothing prints a URL,
 * user name or password. `migrate dev`, `migrate reset` and `db push` are intentionally
 * not offered.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EP02_JSON_COLUMNS, isMariaDbJsonColumn, isMariaDbJsonDiff } from './db-drift.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const apiDir = join(root, 'apps', 'api');
const secretDir = process.env.FLOW_SECRET_DIR || join(homedir(), '.pdabliss', 'flow');
const EXPECTED = {
  dev: 'pdabliss_flow_dev',
  test: 'pdabliss_flow_test',
  shadow: 'pdabliss_flow_shadow',
};
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function fail(msg, code = 1) {
  console.error(`db: ${msg}`);
  process.exit(code);
}

function readEnvFile(name) {
  const p = join(secretDir, name);
  if (!existsSync(p)) return {};
  const out = {};
  for (const line of readFileSync(p, 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)) {
    const m = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

function checkTarget(url, purpose) {
  if (!url) return `${purpose} database URL is missing in the external secret file`;
  let u;
  try {
    u = new URL(url);
  } catch {
    return `${purpose} database URL is not a valid URL`;
  }
  if (u.protocol !== 'mysql:' && u.protocol !== 'mariadb:')
    return 'database URL must use mysql:// or mariadb://';
  if (u.search || u.hash) return 'database URL must not contain query parameters';
  const db = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (db === 'pdabliss_flow') return 'the production database is never a target in EP02';
  if (db !== EXPECTED[purpose])
    return `unexpected database for ${purpose} (expected ${EXPECTED[purpose]})`;
  if (!LOOPBACK.has(u.hostname.toLowerCase()))
    return `${purpose} database must be on this computer`;
  return null;
}

function urls(target) {
  const dev = readEnvFile('dev.env');
  const test = readEnvFile('test.env');
  if (target === 'dev')
    return { url: dev.DATABASE_MIGRATE_URL, purpose: 'dev', shadow: dev.SHADOW_DATABASE_URL };
  if (target === 'test') return { url: test.TEST_DATABASE_URL, purpose: 'test', shadow: undefined };
  return fail('target must be dev or test', 2);
}

function prisma(args, extraEnv = {}, capture = false) {
  const bin = join(root, 'node_modules', 'prisma', 'build', 'index.js');
  if (!existsSync(bin)) fail('Prisma CLI is not installed (run npm.cmd install once).');
  const env = { ...process.env, CI: 'true' };
  delete env.DATABASE_URL;
  delete env.FLOW_PRISMA_URL;
  delete env.FLOW_PRISMA_SHADOW_URL;
  return spawnSync(process.execPath, [bin, ...args], {
    cwd: apiDir,
    env: { ...env, ...extraEnv },
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
}

function compare(label, from, to, url, shadow, allowAlias = false) {
  const result = prisma(
    ['migrate', 'diff', ...from, ...to, '--script', '--exit-code'],
    {
      FLOW_PRISMA_URL: url,
      FLOW_PRISMA_SHADOW_URL: shadow,
    },
    true,
  );
  if (result.status === 0) {
    console.log(`db: ${label}: no Prisma differences`);
    return;
  }
  if (result.status === 2) {
    if (allowAlias && isMariaDbJsonDiff(result.stdout)) {
      console.log(`db: ${label}: Prisma reported only the three MariaDB JSON alias declarations`);
      return;
    }
    fail(`${label}: schema differences found`, 2);
  }
  fail(`${label}: Prisma diff failed (exit ${result.status ?? 'unknown'})`);
}

async function verifyJsonColumns(raw, purpose) {
  const require = createRequire(import.meta.url);
  const { createConnection } = createRequire(require.resolve('@prisma/adapter-mariadb'))('mariadb');
  const url = new URL(raw);
  const connection = await createConnection({
    host: url.hostname === 'localhost' ? '127.0.0.1' : url.hostname.replace(/^\[|\]$/g, ''),
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: EXPECTED[purpose],
    connectTimeout: 5000,
  });
  try {
    const [server] = await connection.query(
      'SELECT DATABASE() AS db, VERSION() AS version, @@session.check_constraint_checks AS checksEnabled',
    );
    if (
      server.db !== EXPECTED[purpose] ||
      !/MariaDB/i.test(server.version) ||
      Number(server.checksEnabled) !== 1
    )
      return `${purpose}: expected a guarded MariaDB database with check constraints enabled`;
    for (const [table, column] of EP02_JSON_COLUMNS) {
      const [tableInfo] = await connection.query(`SHOW CREATE TABLE \`${table}\``);
      if (!isMariaDbJsonColumn(tableInfo['Create Table'], column))
        return `${purpose}: JSON definition differs for ${table}.${column}`;
    }
    console.log(
      `db: ${purpose}: ${server.version}, nullable utf8mb4_bin JSON with JSON_VALID verified for all three columns`,
    );
  } finally {
    await connection.end();
  }
}

const [cmd, target] = process.argv.slice(2);
switch (cmd) {
  case 'generate':
    process.exit(prisma(['generate', '--no-hints']).status ?? 1);
    break;
  case 'validate':
    process.exit(prisma(['validate']).status ?? 1);
    break;
  case 'status':
  case 'deploy': {
    const t = urls(target);
    const problem = checkTarget(t.url, t.purpose);
    if (problem) fail(problem);
    process.exit(
      prisma(['migrate', cmd === 'status' ? 'status' : 'deploy'], { FLOW_PRISMA_URL: t.url })
        .status ?? 1,
    );
    break;
  }
  case 'drift': {
    const t = urls('dev');
    const test = urls('test');
    const problem =
      checkTarget(t.url, 'dev') ?? checkTarget(t.shadow, 'shadow') ?? checkTarget(test.url, 'test');
    if (problem) fail(problem);
    const migrations = ['--from-migrations', 'prisma/migrations'];
    const schema = ['--to-schema', 'prisma/schema.prisma'];
    compare('shadow replay to Prisma schema', migrations, schema, t.url, t.shadow, true);
    for (const db of [t, test]) {
      compare(
        `${db.purpose} to Prisma schema`,
        ['--from-config-datasource'],
        schema,
        db.url,
        t.shadow,
      );
      compare(
        `shadow replay to ${db.purpose}`,
        migrations,
        ['--to-config-datasource'],
        db.url,
        t.shadow,
      );
    }
    // Migrate can omit CHECK constraints from its diff. Verify what MariaDB actually enforces.
    try {
      const mismatch =
        (await verifyJsonColumns(t.shadow, 'shadow')) ??
        (await verifyJsonColumns(t.url, 'dev')) ??
        (await verifyJsonColumns(test.url, 'test'));
      if (mismatch) fail(mismatch, 2);
    } catch {
      fail('MariaDB JSON metadata could not be verified');
    }
    console.log('db: no unresolved semantic drift');
    break;
  }
  case 'whoami': {
    const t = urls(target);
    const problem = checkTarget(t.url, t.purpose);
    if (problem) fail(problem);
    console.log(`db: ${target} → ${EXPECTED[t.purpose]} on this computer (credentials not shown)`);
    break;
  }
  default:
    fail(
      'usage: node scripts/db.mjs generate|validate|status <dev|test>|deploy <dev|test>|drift|whoami <dev|test>',
      2,
    );
}

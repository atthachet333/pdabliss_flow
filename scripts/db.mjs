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
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const apiDir = join(root, 'apps', 'api');
const secretDir = process.env.FLOW_SECRET_DIR || join(homedir(), '.pdabliss', 'flow');
const EXPECTED = { dev: 'pdabliss_flow_dev', test: 'pdabliss_flow_test', shadow: 'pdabliss_flow_shadow' };
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function fail(msg, code = 1) {
  console.error(`db: ${msg}`);
  process.exit(code);
}

function readEnvFile(name) {
  const p = join(secretDir, name);
  if (!existsSync(p)) return {};
  const out = {};
  for (const line of readFileSync(p, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    const m = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

export function checkTarget(url, purpose) {
  if (!url) return `${purpose} database URL is missing in the external secret file`;
  let u;
  try {
    u = new URL(url);
  } catch {
    return `${purpose} database URL is not a valid URL`;
  }
  if (u.protocol !== 'mysql:' && u.protocol !== 'mariadb:') return 'database URL must use mysql:// or mariadb://';
  if (u.search || u.hash) return 'database URL must not contain query parameters';
  const db = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (db === 'pdabliss_flow') return 'the production database is never a target in EP02';
  if (db !== EXPECTED[purpose]) return `unexpected database for ${purpose} (expected ${EXPECTED[purpose]})`;
  if (!LOOPBACK.has(u.hostname.toLowerCase())) return `${purpose} database must be on this computer`;
  return null;
}

function urls(target) {
  const dev = readEnvFile('dev.env');
  const test = readEnvFile('test.env');
  if (target === 'dev') return { url: dev.DATABASE_MIGRATE_URL, purpose: 'dev', shadow: dev.SHADOW_DATABASE_URL };
  if (target === 'test') return { url: test.TEST_DATABASE_URL, purpose: 'test', shadow: undefined };
  return fail('target must be dev or test', 2);
}

function prisma(args, extraEnv = {}) {
  const bin = join(root, 'node_modules', 'prisma', 'build', 'index.js');
  if (!existsSync(bin)) fail('Prisma CLI is not installed (run npm.cmd install once).');
  const env = { ...process.env, ...extraEnv };
  delete env.DATABASE_URL;
  const r = spawnSync(process.execPath, [bin, ...args], { cwd: apiDir, env, stdio: 'inherit' });
  return r.status ?? 1;
}

const [cmd, target] = process.argv.slice(2);
switch (cmd) {
  case 'generate':
    process.exit(prisma(['generate']));
    break;
  case 'validate':
    process.exit(prisma(['validate']));
    break;
  case 'status':
  case 'deploy': {
    const t = urls(target);
    const problem = checkTarget(t.url, t.purpose);
    if (problem) fail(problem);
    process.exit(prisma(['migrate', cmd === 'status' ? 'status' : 'deploy'], { FLOW_PRISMA_URL: t.url }));
    break;
  }
  case 'drift': {
    const t = urls('dev');
    const problem = checkTarget(t.url, 'dev') ?? checkTarget(t.shadow, 'shadow');
    if (problem) fail(problem);
    // Exit code 2 = differences found (the diff SQL is printed, no data is touched).
    process.exit(
      prisma(['migrate', 'diff', '--from-migrations', 'prisma/migrations', '--to-schema', 'prisma/schema.prisma', '--exit-code'], {
        FLOW_PRISMA_URL: t.url,
        FLOW_PRISMA_SHADOW_URL: t.shadow,
      }),
    );
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
    fail('usage: node scripts/db.mjs generate|validate|status <dev|test>|deploy <dev|test>|drift|whoami <dev|test>', 2);
}

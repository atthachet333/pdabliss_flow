/**
 * MariaDB TEST database fixture (Windows only — see scripts/ep02-verify.ps1).
 *
 * Safety: the URL comes from %USERPROFILE%\.pdabliss\flow\test.env (or TEST_DATABASE_URL),
 * must pass the guard for purpose "test" (loopback host, database exactly pdabliss_flow_test),
 * and the live connection must report SELECT DATABASE() = pdabliss_flow_test before any
 * table is emptied. The dev and production databases can never be reached from here.
 * Synthetic data only; nothing is printed about the connection except the database name.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { after } from 'node:test';
import { parseEnvText } from '../../src/config/secret-file.js';
import { assertDestructiveAllowed, DB_NAMES } from '../../src/db/guard.js';
import { createPrismaClient, PrismaStore } from '../../src/store/prisma.js';
import type { Store } from '../../src/store/types.js';

/** Child tables first. Must list every model; checked against information_schema below. */
const TABLES = [
  'audit_logs',
  'idempotency_records',
  'user_preferences',
  'webhook_events',
  'appointment_events',
  'reminder_rules',
  'appointment_destinations',
  'appointment_access',
  'appointments',
  'appointment_series',
  'destination_grants',
  'line_destinations',
  'workspace_members',
  'invitations',
  'access_requests',
  'rate_limit_buckets',
  'sessions',
  'line_identities',
  'workspaces',
  'users',
] as const;

export function testUrl(): string | undefined {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const dir = process.env.FLOW_SECRET_DIR || join(homedir(), '.pdabliss', 'flow');
  const p = join(dir, 'test.env');
  return existsSync(p) ? parseEnvText(readFileSync(p, 'utf8')).TEST_DATABASE_URL : undefined;
}

let shared: { client: ReturnType<typeof createPrismaClient>; checked: boolean } | null = null;

export async function openTestStore(): Promise<PrismaStore> {
  const store = new PrismaStore(createPrismaClient(testUrl(), 'test'));
  try {
    await store.verifyConnection(DB_NAMES.test);
    return store;
  } catch (error) {
    await store.close();
    throw error;
  }
}

export async function testStore(): Promise<Store> {
  const url = testUrl();
  assertDestructiveAllowed(url); // throws unless loopback + pdabliss_flow_test
  if (!shared) {
    shared = { client: createPrismaClient(url, 'test'), checked: false };
    after(async () => {
      await shared?.client.$disconnect();
      shared = null;
    });
  }
  const c = shared.client;
  if (!shared.checked) {
    const [row] = await c.$queryRawUnsafe<{ db: string }[]>('SELECT DATABASE() AS db');
    if (row?.db !== DB_NAMES.test)
      throw new Error(`Refusing to reset: connected database is not ${DB_NAMES.test}`);
    const tables = await c.$queryRawUnsafe<{ t: string }[]>(
      "SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME <> '_prisma_migrations'",
    );
    const missing = tables
      .map((x) => x.t)
      .filter((t) => !(TABLES as readonly string[]).includes(t));
    if (missing.length) throw new Error(`Reset list is missing tables: ${missing.join(', ')}`);
    shared.checked = true;
  }
  for (const t of TABLES) await c.$executeRawUnsafe(`DELETE FROM \`${t}\``);
  return new PrismaStore(c);
}

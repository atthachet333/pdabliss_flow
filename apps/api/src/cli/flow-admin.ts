/**
 * LOCAL owner/admin tool (EP02). Initial setup and emergency recovery only — ordinary users
 * are approved in the mobile Owner Console. There is no HTTP equivalent by design.
 *
 *   npm run admin -- import-ep01-owner [--allow-additional-owner]
 *   npm run admin -- owners
 *   npm run admin -- promote-owner <user-uuid> --confirm      (emergency recovery)
 *
 * Reads DATABASE_URL from the external secret file (guarded: pdabliss_flow_dev on this
 * computer). Output never shows full LINE ids, secrets or connection strings.
 */
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileAccessStore, maskUserId } from '../auth/access.js';
import { loadSecretFile, mergeEnv, SecretFileError } from '../config/secret-file.js';
import { ApiError, UUID_RE } from '../core/context.js';
import { DbGuardError } from '../db/guard.js';
import { importOwner } from '../domain/identity.js';
import { createPrismaClient, PrismaStore } from '../store/prisma.js';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
}

async function main(): Promise<number> {
  let env: Record<string, string | undefined>;
  let dir: string;
  try {
    const secrets = loadSecretFile({ projectRoot: PROJECT_ROOT });
    dir = secrets.dir;
    env = mergeEnv(secrets.values, process.env, secrets.dir);
  } catch (err) {
    console.error(err instanceof SecretFileError ? err.message : 'Could not read the secret file.');
    return 1;
  }
  const args = process.argv.slice(2);
  const command = args.find((a) => !a.startsWith('--'));
  let store: PrismaStore;
  try {
    store = new PrismaStore(createPrismaClient(env.DATABASE_URL, 'dev-runtime'));
  } catch (err) {
    console.error(err instanceof DbGuardError ? err.message : 'Database is not configured.');
    return 1;
  }
  try {
    switch (command) {
      case 'import-ep01-owner': {
        const ep01 = new FileAccessStore({ dir });
        const owners = ep01.listUsers().filter((u) => u.role === 'owner' && u.status === 'active');
        if (owners.length === 0) {
          console.error('No active EP01 owner found in the external access file. Nothing imported.');
          return 1;
        }
        if (owners.length > 1 && !args.includes('--allow-additional-owner')) {
          console.error('The EP01 access file lists more than one active owner. Review it first (no changes made).');
          return 1;
        }
        const accessFile = join(dir, 'access.json');
        const backup = join(dir, `access.ep01-backup-${stamp(new Date())}.json`);
        if (existsSync(accessFile)) {
          copyFileSync(accessFile, backup);
          console.log('Backed up the EP01 access file next to the original (external secret folder).');
        }
        for (const o of owners) {
          const r = await importOwner(
            store,
            {
              lineUserId: o.lineUserId,
              displayName: o.label ?? null,
              loginChannelId: env.LINE_LOGIN_CHANNEL_ID ?? 'unknown',
              allowAdditionalOwner: args.includes('--allow-additional-owner'),
            },
            new Date(),
          );
          console.log(`Owner ${maskUserId(o.lineUserId)}: ${r.outcome}.`);
        }
        console.log('Done. Sign in to FLOW from LINE — no new enrollment is needed.');
        return 0;
      }
      case 'owners': {
        const rows = await store.listUsers({ statuses: ['ACTIVE'], limit: 50 });
        const owners = rows.filter((u) => u.globalRole === 'OWNER');
        for (const u of owners) {
          const ident = await store.getIdentityByUserId(u.id);
          console.log(`owner  ${ident ? maskUserId(ident.lineUserId) : '(no LINE identity)'}  ${u.id}`);
        }
        if (!owners.length) console.log('No active owner.');
        return 0;
      }
      case 'promote-owner': {
        const id = args.find((a) => UUID_RE.test(a));
        if (!id || !args.includes('--confirm')) {
          console.error('Usage: promote-owner <user-uuid> --confirm   (emergency recovery only)');
          return 2;
        }
        const ident = await store.getIdentityByUserId(id);
        if (!ident) {
          console.error('User not found or has no LINE identity.');
          return 1;
        }
        const r = await importOwner(
          store,
          { lineUserId: ident.lineUserId, displayName: null, loginChannelId: ident.loginChannelId, allowAdditionalOwner: true },
          new Date(),
        );
        console.log(`User ${maskUserId(ident.lineUserId)}: ${r.outcome}.`);
        return 0;
      }
      default:
        console.error('Commands: import-ep01-owner [--allow-additional-owner] | owners | promote-owner <user-uuid> --confirm');
        return 2;
    }
  } catch (err) {
    if (err instanceof ApiError) {
      console.error(`${err.code}: ${err.message}`);
      return 1;
    }
    console.error('Unexpected error (details withheld).');
    return 1;
  } finally {
    await store.close();
  }
}

process.exitCode = await main();

/**
 * LOCAL owner tool — manages the private access list in the external secret directory.
 * There is no HTTP equivalent by design.
 *
 *   npm run access -- pending
 *   npm run access -- list
 *   npm run access -- approve K7QF-2M9X --role owner [--label "Owner phone"]
 *   npm run access -- approve K7QF-2M9X --role tester --label "Tester A"
 *   npm run access -- revoke <last-4+-hex-of-id | label>
 *
 * Output never shows full LINE user IDs.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileAccessStore, maskUserId } from '../auth/access.js';
import { loadSecretFile, SecretFileError } from '../config/secret-file.js';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function main(): number {
  let dir: string;
  try {
    dir = loadSecretFile({ projectRoot: PROJECT_ROOT }).dir;
  } catch (err) {
    console.error(
      err instanceof SecretFileError ? err.message : 'Could not resolve the secret directory.',
    );
    return 1;
  }
  const store = new FileAccessStore({ dir });
  const [command, value] = process.argv
    .slice(2)
    .filter((a, i, all) => !a.startsWith('--') && !(all[i - 1] ?? '').startsWith('--'));

  switch (command) {
    case 'pending': {
      const p = store.listPending();
      if (p.length === 0)
        console.log('No pending enrollment references (they expire after 15 minutes).');
      for (const e of p)
        console.log(`${e.reference}  user ${e.maskedUserId}  expires in ~${e.expiresInMin} min`);
      return 0;
    }
    case 'list': {
      const users = store.listUsers();
      if (users.length === 0) console.log('Access list is empty — everyone is denied.');
      for (const u of users)
        console.log(
          `${u.role.padEnd(6)} ${u.status.padEnd(7)} ${maskUserId(u.lineUserId)}  ${u.label ?? ''}`,
        );
      return 0;
    }
    case 'approve': {
      const role = arg('--role');
      if (!value || (role !== 'owner' && role !== 'tester')) {
        console.error('Usage: approve <REFERENCE> --role owner|tester [--label "text"]');
        return 2;
      }
      const label = arg('--label');
      const r = store.approve(value, role, {
        ...(label ? { label } : {}),
        allowAdditionalOwner: process.argv.includes('--allow-additional-owner'),
      });
      if (!r.ok) {
        const msg = {
          'no-secret-dir': 'Secret directory is not available.',
          'unknown-reference': 'Unknown or expired reference. Open FLOW again to get a fresh one.',
          'owner-exists':
            'An owner already exists. Use --allow-additional-owner only if you really intend a second owner.',
        }[r.reason];
        console.error(msg);
        return 1;
      }
      console.log(
        `Approved ${maskUserId(r.entry.lineUserId)} as ${r.entry.role}. Reopen FLOW in LINE to sign in.`,
      );
      return 0;
    }
    case 'revoke': {
      if (!value) {
        console.error('Usage: revoke <last 4+ hex characters of the user ID | label>');
        return 2;
      }
      const r = store.revoke(value);
      if (!r.ok) {
        console.error(
          r.reason === 'ambiguous'
            ? 'More than one user matches — use a longer suffix.'
            : 'No matching user.',
        );
        return 1;
      }
      console.log(
        `Revoked ${maskUserId(r.entry.lineUserId)}. Their sessions end on the next request.`,
      );
      return 0;
    }
    default:
      console.log(
        'Commands: pending | list | approve <REF> --role owner|tester [--label] | revoke <selector>',
      );
      return command ? 2 : 0;
  }
}

process.exitCode = main();

#!/usr/bin/env node
/**
 * `npm run access -- <command>` launcher (EP01 finding F06).
 *
 * The access CLI used to rebuild @flow/shared and @flow/api on every call, which rewrote
 * apps/api/dist while the integration API was running from it. Now:
 *   - if the built CLI is at least as new as every source file it depends on, it runs the
 *     verified build directly (no build, no file changes);
 *   - if the build is stale and an integration session is recorded (.qa/ep01/run/processes.json),
 *     it refuses rather than mutate the running build;
 *   - if the build is stale and nothing is running, it rebuilds shared + API once, then runs.
 * Enrollment stays local-only: this script only runs the local CLI; there is no HTTP endpoint.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const cli = join(root, 'apps', 'api', 'dist', 'cli', 'flow-access.js');
const sources = [
  join(root, 'apps', 'api', 'src'),
  join(root, 'packages', 'shared', 'src'),
  join(root, 'apps', 'api', 'tsconfig.json'),
  join(root, 'apps', 'api', 'tsconfig.build.json'),
];
const session = join(root, '.qa', 'ep01', 'run', 'processes.json');

function newestMtime(path) {
  if (!existsSync(path)) return 0;
  const st = statSync(path);
  if (!st.isDirectory()) return st.mtimeMs;
  let max = 0;
  for (const name of readdirSync(path)) max = Math.max(max, newestMtime(join(path, name)));
  return max;
}

export function isFresh() {
  if (!existsSync(cli)) return false;
  const built = statSync(cli).mtimeMs;
  return sources.every((s) => newestMtime(s) <= built);
}

function build() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  for (const ws of ['@flow/shared', '@flow/api']) {
    const r = spawnSync(npm, ['run', 'build', '-w', ws, '--silent'], {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    if (r.status !== 0) return false;
  }
  return true;
}

if (!isFresh()) {
  if (existsSync(session)) {
    console.error(
      'The access CLI build is older than the source, and an integration session is recorded.\n' +
        'Not rebuilding while the API may be running from apps/api/dist. Stop the session\n' +
        '(scripts\\ep01-integration.ps1 -Stop), then run this command again.',
    );
    process.exit(2);
  }
  console.error('Access CLI build is out of date - rebuilding shared + API once...');
  if (!build()) process.exit(1);
}
const r = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status ?? 1);

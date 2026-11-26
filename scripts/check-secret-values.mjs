#!/usr/bin/env node
/**
 * G08: prove that NO real secret value from the external secret file appears in any
 * tracked/committable file or in the built frontend bundles. Prints counts only.
 * Exits 0 with "SKIPPED" when no secret file exists yet.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const file = process.env.FLOW_ENV_FILE
  ? resolve(process.env.FLOW_ENV_FILE)
  : join(homedir(), '.pdabliss', 'flow', 'dev.env');
const SECRET_KEYS = [
  'LINE_MESSAGING_CHANNEL_SECRET',
  'LINE_CHANNEL_ACCESS_TOKEN',
  'SESSION_SECRET',
  'LINE_LOGIN_CHANNEL_SECRET',
];

if (!existsSync(file)) {
  console.log('SKIPPED: no external secret file yet (nothing to leak).');
  process.exit(0);
}
const secrets = [];
for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z][A-Z0-9_]*)=(.+)$/.exec(line.trim());
  if (m && SECRET_KEYS.includes(m[1]) && m[2].trim().length >= 16) secrets.push(m[2].trim());
}

const targets = [];
try {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  for (const f of out.split(/\r?\n/).filter(Boolean)) targets.push(join(root, f));
} catch {
  /* not a repo */
}
const walk = (dir) => {
  if (!existsSync(dir)) return;
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p);
    else targets.push(p);
  }
};
walk(join(root, 'apps', 'web', 'dist'));
walk(join(root, 'apps', 'web', 'dist-showcase'));

let leaks = 0;
for (const t of targets) {
  let text;
  try {
    text = readFileSync(t, 'utf8');
  } catch {
    continue;
  }
  for (const s of secrets) if (text.includes(s)) leaks += 1;
}
console.log(`Checked ${secrets.length} secret value(s) against ${targets.length} files.`);
if (leaks > 0) {
  console.error(
    `FAIL: ${leaks} occurrence(s) of a real secret value found. Rotate the affected credential.`,
  );
  process.exit(1);
}
console.log('PASS: no real secret value appears in the repository files or frontend builds.');

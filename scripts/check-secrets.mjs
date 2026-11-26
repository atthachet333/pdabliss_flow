#!/usr/bin/env node
/**
 * G08/G09: scan files that would be committed for likely secrets.
 * Uses `git ls-files --cached --others --exclude-standard` when inside a Git repo,
 * otherwise walks the tree with the same ignore list as .gitignore's main entries.
 * Prints file + rule only — never the matched value.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-showcase', '.git', '.qa', 'coverage']);
const SKIP_FILES = new Set(['package-lock.json']);

const RULES = [
  { id: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: 'db-url-with-password', re: /postgres(?:ql)?:\/\/[^:<\s/]+:(?!<)[^@<\s]{3,}@/i },
  {
    id: 'assignment-of-secret',
    re: /\b(?:LINE_CHANNEL_SECRET|LINE_CHANNEL_ACCESS_TOKEN|DATABASE_PASSWORD|API_KEY|SECRET_KEY)\s*[=:]\s*["']?(?!<|\$|process\.env)[A-Za-z0-9+/=_-]{12,}/,
  },
  { id: 'long-bearer-token', re: /Bearer\s+[A-Za-z0-9+/=_-]{40,}/ },
  { id: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
];

function listFiles() {
  try {
    const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split(/\r?\n/).filter(Boolean);
  } catch {
    const files = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        if (SKIP_DIRS.has(name)) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else files.push(relative(root, p));
      }
    };
    walk(root);
    return files;
  }
}

const files = listFiles().filter((f) => !SKIP_FILES.has(f.split(/[\\/]/).pop() ?? ''));
const envFiles = files.filter((f) => /(^|[\\/])\.env(\.|$)/.test(f) && !f.endsWith('.env.example'));
const findings = [];
for (const f of envFiles) findings.push(`${f}: real .env file would be committed`);

for (const f of files) {
  let text;
  try {
    const buf = readFileSync(join(root, f));
    if (buf.includes(0)) continue; // binary
    text = buf.toString('utf8');
  } catch {
    continue;
  }
  for (const rule of RULES) if (rule.re.test(text)) findings.push(`${f}: ${rule.id}`);
}

console.log(`Scanned ${files.length} files.`);
if (findings.length > 0) {
  console.error(`FAIL: ${findings.length} potential secret(s):\n` + findings.join('\n'));
  process.exit(1);
}
console.log('PASS: no secrets detected.');

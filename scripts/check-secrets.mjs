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

// A synthetic test ID is a single repeated character (e.g. U + 'a' × 32) and is allowed.
const isSynthetic = (m) => new Set(m.slice(1)).size === 1;

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
  { id: 'line-user-group-or-room-id', re: /\b[UCR][0-9a-f]{32}\b/g, allow: isSynthetic },
  { id: 'line-channel-secret-assignment', re: /CHANNEL_SECRET\s*[=:]\s*["']?[0-9a-f]{32}\b/ },
  {
    id: 'long-token-like-string',
    re: /(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{160,}={0,2}(?![A-Za-z0-9+/])/,
  },
  { id: 'cloudflare-tunnel-token', re: /\beyJhIjoi[A-Za-z0-9_-]{40,}/ },
];

function findings(text) {
  const hits = [];
  for (const rule of RULES) {
    if (rule.re.global) {
      for (const m of text.matchAll(rule.re))
        if (!(rule.allow && rule.allow(m[0]))) hits.push(rule.id);
    } else if (rule.re.test(text)) hits.push(rule.id);
  }
  return [...new Set(hits)];
}

if (process.argv.includes('--history')) {
  // Scan every line ever ADDED in any commit (public-repo history review). Prints commit + rule only.
  let log = '';
  try {
    log = execFileSync('git', ['log', '--all', '-p', '--no-color', '--format=@@COMMIT %h'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    console.error('Not a Git repository (or git unavailable).');
    process.exit(1);
  }
  const out = [];
  let commit = '?';
  let file = '?';
  for (const line of log.split(/\r?\n/)) {
    if (line.startsWith('@@COMMIT ')) commit = line.slice(9);
    else if (line.startsWith('+++ b/')) file = line.slice(6);
    else if (
      line.startsWith('+') &&
      !line.startsWith('+++') &&
      !file.endsWith('package-lock.json')
    ) {
      for (const id of findings(line.slice(1))) out.push(`${commit} ${file}: ${id}`);
    }
  }
  const uniq = [...new Set(out)];
  const commits = new Set(log.split(/\r?\n/).filter((l) => l.startsWith('@@COMMIT ')));
  console.log(`History scan: ${commits.size} commits.`);
  if (uniq.length > 0) {
    console.error(`FAIL: ${uniq.length} potential finding(s) in history:\n${uniq.join('\n')}`);
    process.exit(1);
  }
  console.log('PASS: no secrets or LINE IDs detected in Git history.');
  process.exit(0);
}

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
const results = [];
for (const f of envFiles) results.push(`${f}: real .env file would be committed`);

for (const f of files) {
  let text;
  try {
    const buf = readFileSync(join(root, f));
    if (buf.includes(0)) continue; // binary
    text = buf.toString('utf8');
  } catch {
    continue;
  }
  for (const id of findings(text)) results.push(`${f}: ${id}`);
}

console.log(`Scanned ${files.length} files.`);
if (results.length > 0) {
  console.error(`FAIL: ${results.length} potential secret(s):\n` + results.join('\n'));
  process.exit(1);
}
console.log('PASS: no secrets detected.');

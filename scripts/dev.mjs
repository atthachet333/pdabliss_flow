#!/usr/bin/env node
// Starts the local development services (shared build → API + web) without
// extra dependencies. The worker is a scaffold and is intentionally NOT started.
// Works on Windows PowerShell and POSIX shells.
import { spawn } from 'node:child_process';

const isWindows = process.platform === 'win32';
const npm = isWindows ? 'npm.cmd' : 'npm';

function run(label, args, color) {
  const child = spawn(npm, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: isWindows });
  const prefix = `\x1b[${color}m[${label}]\x1b[0m `;
  const pipe = (stream, target) =>
    stream.on('data', (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/))
        if (line) target.write(prefix + line + '\n');
    });
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  return child;
}

function runOnce(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(npm, args, { stdio: 'inherit', shell: isWindows });
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`npm ${args.join(' ')} exited ${code}`)),
    );
  });
}

await runOnce(['run', 'build', '-w', '@flow/shared']);

const children = [
  run('api', ['run', 'dev', '-w', '@flow/api'], '36'),
  run('web', ['run', 'dev', '-w', '@flow/web'], '35'),
];

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) if (!c.killed) c.kill('SIGINT');
  setTimeout(() => process.exit(code), 1500).unref();
}

for (const c of children) {
  c.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`A development service exited (code ${code}). Stopping the others.`);
      shutdown(code ?? 1);
    }
  });
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

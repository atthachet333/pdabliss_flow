/**
 * Local secret loading (EP01).
 *
 * Real credentials live OUTSIDE the repository and outside any synchronised folder, by
 * default in `%USERPROFILE%\.pdabliss\flow\dev.env`. This module:
 *  - resolves that location (FLOW_ENV_FILE overrides it),
 *  - refuses paths inside the project, OneDrive or other sync clients,
 *  - parses simple KEY=VALUE lines without ever echoing values.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const DEFAULT_SECRET_DIR = join(homedir(), '.pdabliss', 'flow');
export const DEFAULT_SECRET_FILE = join(DEFAULT_SECRET_DIR, 'dev.env');

const SYNC_SEGMENT =
  /^(one ?drive.*|dropbox|google ?drive|my ?drive|icloud ?drive|icloud|box|sync)$/i;
const SYNC_ENV_VARS = ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial'];

export class SecretFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretFileError';
  }
}

function isInside(child: string, parent: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** Reasons a directory is unsafe for secrets (empty array = safe). */
export function unsafeSecretLocationReasons(
  dir: string,
  opts: { projectRoot: string; env?: Record<string, string | undefined> },
): string[] {
  const reasons: string[] = [];
  const abs = resolve(dir);
  if (isInside(abs, opts.projectRoot)) reasons.push('inside the project directory');
  const segments = abs.split(/[\\/]+/);
  if (segments.some((s) => SYNC_SEGMENT.test(s)))
    reasons.push('inside a cloud-synchronised folder');
  const env = opts.env ?? process.env;
  for (const name of SYNC_ENV_VARS) {
    const p = env[name];
    if (p && isInside(abs, p)) {
      reasons.push(`inside ${name}`);
      break;
    }
  }
  return [...new Set(reasons)];
}

/** Parse KEY=VALUE lines. Ignores blank lines and # comments. Values are never logged. */
export function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) out[key] = value;
  }
  return out;
}

export interface LoadedSecrets {
  file: string | null;
  dir: string;
  values: Record<string, string>;
}

/**
 * Load the external secret file. Missing file → empty values (features stay disabled).
 * An unsafe location is an error, so misplaced secrets are never silently used.
 */
export function loadSecretFile(opts: {
  projectRoot: string;
  env?: Record<string, string | undefined>;
}): LoadedSecrets {
  const env = opts.env ?? process.env;
  const file = env.FLOW_ENV_FILE ? resolve(env.FLOW_ENV_FILE) : DEFAULT_SECRET_FILE;
  const dir = env.FLOW_SECRET_DIR ? resolve(env.FLOW_SECRET_DIR) : dirname(file);
  const reasons = unsafeSecretLocationReasons(dir, { projectRoot: opts.projectRoot, env });
  if (reasons.length > 0) {
    throw new SecretFileError(
      `Refusing to use the secret location (${reasons.join(', ')}). Move it outside synchronised folders.`,
    );
  }
  if (!existsSync(file)) return { file: null, dir, values: {} };
  return { file, dir, values: parseEnvText(readFileSync(file, 'utf8')) };
}

/** Process environment wins over the file (useful for one-off overrides and tests). */
export function mergeEnv(
  fileValues: Record<string, string>,
  processEnv: Record<string, string | undefined>,
  secretDir: string,
): Record<string, string | undefined> {
  return { FLOW_SECRET_DIR: secretDir, ...fileValues, ...processEnv };
}

export const PATH_SEPARATOR = sep;

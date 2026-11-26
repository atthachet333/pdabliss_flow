/**
 * Private access list (EP01) — deny by default.
 *
 * Sources (both outside the repository, never committed):
 *  1. `access.json` in the external secret directory — owner and testers, with revocation.
 *  2. FLOW_ALLOWED_LINE_USER_IDS — extra testers only (never owner).
 *
 * Owner bootstrap: an authenticated-but-unknown user is shown a short random enrollment
 * reference (e.g. "K7QF-2M9X"). The API records `reference → verified LINE user ID` in
 * `pending-enrollments.json` (15-minute expiry). The owner then runs the LOCAL command
 * `npm run access -- approve <reference> --role owner` on the workstation. No HTTP
 * endpoint can grant access; display names are never used for authorisation.
 *
 * Roles kept for EP03: owner, administrator, member, viewer, pending, revoked.
 * EP01 only grants owner / tester (development access).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { SessionRole } from './sessions.js';

export const ACCESS_FILE = 'access.json';
export const PENDING_FILE = 'pending-enrollments.json';
export const PENDING_TTL_MS = 15 * 60 * 1000;
const MAX_PENDING = 20;
const LINE_USER_ID = /^U[0-9a-f]{32}$/;
const REF_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32 (no I, L, O, U)

const accessEntry = z.object({
  lineUserId: z.string().regex(LINE_USER_ID),
  role: z.enum(['owner', 'tester']),
  status: z.enum(['active', 'revoked']),
  label: z.string().max(60).optional(),
  addedAt: z.string(),
  revokedAt: z.string().optional(),
});
const accessFileSchema = z.object({ version: z.literal(1), users: z.array(accessEntry) });
const pendingEntry = z.object({
  reference: z.string(),
  lineUserId: z.string().regex(LINE_USER_ID),
  expiresAt: z.number(),
});
const pendingFileSchema = z.object({ version: z.literal(1), pending: z.array(pendingEntry) });

export type AccessEntry = z.infer<typeof accessEntry>;
export type AccessDecision =
  { state: 'approved'; role: SessionRole } | { state: 'revoked' } | { state: 'not-approved' };

export interface AccessStore {
  decide(lineUserId: string): AccessDecision;
  /** Record a pending enrollment reference for a verified, unknown user. */
  recordPending(lineUserId: string): string | null;
}

export function newReference(): string {
  const bytes = randomBytes(8);
  let s = '';
  for (const b of bytes) s += REF_ALPHABET[b % 32];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export function normaliseReference(input: string): string {
  const s = input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4)}` : s;
}

export function maskUserId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 5)}…${id.slice(-4)}` : '…';
}

function writeJsonAtomic(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, path);
}

export class FileAccessStore implements AccessStore {
  private cache: { mtimeMs: number; users: AccessEntry[] } | null = null;

  constructor(
    private readonly opts: {
      dir: string | null;
      envTesters?: string[];
      now?: () => number;
    },
  ) {}

  private get now(): number {
    return (this.opts.now ?? Date.now)();
  }
  get accessPath(): string | null {
    return this.opts.dir ? join(this.opts.dir, ACCESS_FILE) : null;
  }
  get pendingPath(): string | null {
    return this.opts.dir ? join(this.opts.dir, PENDING_FILE) : null;
  }

  /** Reads access.json (cached by modification time). Invalid files grant nothing. */
  listUsers(): AccessEntry[] {
    const p = this.accessPath;
    if (!p || !existsSync(p)) return [];
    const mtimeMs = statSync(p).mtimeMs;
    if (this.cache && this.cache.mtimeMs === mtimeMs) return this.cache.users;
    try {
      const parsed = accessFileSchema.safeParse(JSON.parse(readFileSync(p, 'utf8')));
      const users = parsed.success ? parsed.data.users : [];
      this.cache = { mtimeMs, users };
      return users;
    } catch {
      return [];
    }
  }

  decide(lineUserId: string): AccessDecision {
    if (!LINE_USER_ID.test(lineUserId)) return { state: 'not-approved' };
    const entry = this.listUsers().find((u) => u.lineUserId === lineUserId);
    if (entry?.status === 'revoked') return { state: 'revoked' };
    if (entry?.status === 'active') return { state: 'approved', role: entry.role };
    if (this.opts.envTesters?.includes(lineUserId)) return { state: 'approved', role: 'tester' };
    return { state: 'not-approved' };
  }

  private readPending(): z.infer<typeof pendingEntry>[] {
    const p = this.pendingPath;
    if (!p || !existsSync(p)) return [];
    try {
      const parsed = pendingFileSchema.safeParse(JSON.parse(readFileSync(p, 'utf8')));
      return parsed.success ? parsed.data.pending.filter((e) => e.expiresAt > this.now) : [];
    } catch {
      return [];
    }
  }

  recordPending(lineUserId: string): string | null {
    const p = this.pendingPath;
    if (!p || !LINE_USER_ID.test(lineUserId)) return null;
    const pending = this.readPending();
    const existing = pending.find((e) => e.lineUserId === lineUserId);
    if (existing) return existing.reference;
    const reference = newReference();
    const next = [
      ...pending,
      { reference, lineUserId, expiresAt: this.now + PENDING_TTL_MS },
    ].slice(-MAX_PENDING);
    writeJsonAtomic(p, { version: 1, pending: next });
    return reference;
  }

  /** LOCAL CLI ONLY. Approve a pending reference. */
  approve(
    reference: string,
    role: SessionRole,
    opts: { label?: string; allowAdditionalOwner?: boolean } = {},
  ):
    | { ok: true; entry: AccessEntry }
    | { ok: false; reason: 'no-secret-dir' | 'unknown-reference' | 'owner-exists' } {
    const ap = this.accessPath;
    const pp = this.pendingPath;
    if (!ap || !pp) return { ok: false, reason: 'no-secret-dir' };
    const ref = normaliseReference(reference);
    const pending = this.readPending();
    const match = pending.find((e) => e.reference === ref);
    if (!match) return { ok: false, reason: 'unknown-reference' };
    const users = [...this.listUsers()];
    if (
      role === 'owner' &&
      !opts.allowAdditionalOwner &&
      users.some(
        (u) => u.role === 'owner' && u.status === 'active' && u.lineUserId !== match.lineUserId,
      )
    ) {
      return { ok: false, reason: 'owner-exists' };
    }
    const entry: AccessEntry = {
      lineUserId: match.lineUserId,
      role,
      status: 'active',
      addedAt: new Date(this.now).toISOString(),
      ...(opts.label ? { label: opts.label.slice(0, 60) } : {}),
    };
    const next = [...users.filter((u) => u.lineUserId !== match.lineUserId), entry];
    writeJsonAtomic(ap, { version: 1, users: next });
    writeJsonAtomic(pp, { version: 1, pending: pending.filter((e) => e.reference !== ref) });
    this.cache = null;
    return { ok: true, entry };
  }

  /** LOCAL CLI ONLY. Revoke by masked-ID suffix (last 4+ hex characters) or label. */
  revoke(
    selector: string,
  ):
    | { ok: true; entry: AccessEntry }
    | { ok: false; reason: 'no-secret-dir' | 'no-match' | 'ambiguous' } {
    const ap = this.accessPath;
    if (!ap) return { ok: false, reason: 'no-secret-dir' };
    const users = [...this.listUsers()];
    const sel = selector.trim().toLowerCase();
    const matches = users.filter(
      (u) =>
        (sel.length >= 4 && u.lineUserId.toLowerCase().endsWith(sel)) ||
        u.label?.toLowerCase() === sel,
    );
    if (matches.length === 0) return { ok: false, reason: 'no-match' };
    if (matches.length > 1) return { ok: false, reason: 'ambiguous' };
    const target = matches[0] as AccessEntry;
    const entry: AccessEntry = {
      ...target,
      status: 'revoked',
      revokedAt: new Date(this.now).toISOString(),
    };
    writeJsonAtomic(ap, {
      version: 1,
      users: users.map((u) => (u.lineUserId === target.lineUserId ? entry : u)),
    });
    this.cache = null;
    return { ok: true, entry };
  }

  listPending(): { reference: string; maskedUserId: string; expiresInMin: number }[] {
    return this.readPending().map((e) => ({
      reference: e.reference,
      maskedUserId: maskUserId(e.lineUserId),
      expiresInMin: Math.max(0, Math.round((e.expiresAt - this.now) / 60000)),
    }));
  }
}

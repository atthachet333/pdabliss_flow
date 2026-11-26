/**
 * Privacy-safe audit logging. Metadata is filtered to an allow-list of non-content keys:
 * never titles, notes, locations, tokens, LINE ids or display names.
 */
import { newId } from '../core/context.js';
import type { Store } from '../store/types.js';

const ALLOWED_META_KEYS = new Set([
  'role',
  'fromRole',
  'toRole',
  'status',
  'fromStatus',
  'toStatus',
  'globalRole',
  'workspaceId',
  'targetUserId',
  'invitationId',
  'requestId',
  'destinationId',
  'expiresInHours',
  'count',
  'reason',
  'kind',
  'visibility',
  'fields',
  'version',
]);

export function sanitizeMeta(meta: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!meta) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (!ALLOWED_META_KEYS.has(k)) continue;
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) out[k] = v;
    else if (Array.isArray(v) && v.every((x) => typeof x === 'string')) out[k] = v.slice(0, 20);
  }
  return Object.keys(out).length ? out : null;
}

export interface AuditInput {
  actorUserId: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  workspaceId?: string | null;
  meta?: Record<string, unknown>;
  correlationId?: string | null;
  at: Date;
}

export async function audit(store: Store, e: AuditInput): Promise<void> {
  await store.appendAudit({
    id: newId(),
    actorUserId: e.actorUserId,
    action: e.action,
    resourceType: e.resourceType,
    resourceId: e.resourceId ?? null,
    workspaceId: e.workspaceId ?? null,
    metadata: sanitizeMeta(e.meta),
    correlationId: e.correlationId ?? null,
    createdAt: e.at,
  });
}

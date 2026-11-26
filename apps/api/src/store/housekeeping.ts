/**
 * Bounded storage: removes ended/expired sessions (kept 7 days for audit context), expired
 * rate-limit windows, webhook event ids past their dedupe window and stale idempotency keys.
 * Runs in the API process (not in tests); failures are logged by class only and retried on
 * the next tick. Never touches appointments, users, memberships or audit logs.
 */
import type { Store } from './types.js';

export const HOUSEKEEPING_INTERVAL_MS = 15 * 60_000;
export const ENDED_SESSION_RETENTION_MS = 7 * 86_400_000;

export async function runHousekeeping(store: Store, now: Date): Promise<Record<string, number>> {
  return {
    sessions: await store.purgeSessions(new Date(now.getTime() - ENDED_SESSION_RETENTION_MS)),
    rateLimits: await store.purgeRateLimits(now),
    webhookEvents: await store.purgeWebhookEvents(now),
    idempotency: await store.purgeIdempotency(now),
  };
}

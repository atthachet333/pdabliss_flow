/**
 * Bounded storage: removes ended/expired sessions (kept 7 days for audit context), expired
 * rate-limit windows, webhook event ids past their dedupe window and stale idempotency keys.
 * Runs in the API process (not in tests); failures are logged by class only and retried on
 * the next tick. Never deletes appointments, users, memberships or audit logs; it only
 * extends recurring series by their bounded rolling horizon (new occurrences).
 */
import type { Store } from './types.js';

export const HOUSEKEEPING_INTERVAL_MS = 15 * 60_000;
export const ENDED_SESSION_RETENTION_MS = 7 * 86_400_000;

export async function runHousekeeping(
  store: Store,
  now: Date,
  extendSeries?: (() => Promise<{ extended: number; created: number; paused: number }>) | null,
): Promise<Record<string, number>> {
  const purged = {
    sessions: await store.purgeSessions(new Date(now.getTime() - ENDED_SESSION_RETENTION_MS)),
    rateLimits: await store.purgeRateLimits(now),
    webhookEvents: await store.purgeWebhookEvents(now),
    idempotency: await store.purgeIdempotency(now),
  };
  // Recurring series keep a bounded rolling horizon of materialized occurrences (EP02).
  if (!extendSeries) return purged;
  const s = await extendSeries();
  return {
    ...purged,
    seriesExtended: s.extended,
    occurrencesCreated: s.created,
    seriesPaused: s.paused,
  };
}

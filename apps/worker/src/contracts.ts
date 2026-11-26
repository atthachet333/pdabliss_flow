/**
 * Notification worker contracts (EP04 will implement them).
 * Design: PostgreSQL-backed jobs, claimed with `FOR UPDATE SKIP LOCKED` leases,
 * idempotent delivery via X-Line-Retry-Key, quota reserved atomically before sending.
 * See docs/NOTIFICATION-ENGINE-PLAN.md.
 */
import type { NotificationState } from '@flow/shared';

export interface NotificationJob {
  id: string;
  appointmentId: string;
  /** Appointment revision the job was created for; stale revisions are cancelled, never sent. */
  appointmentRevision: number;
  destinationId: string;
  fireAt: Date;
  /** Reminders older than this are expired instead of sent after an outage. */
  expiresAt: Date;
  state: NotificationState;
  attempt: number;
  /** Stable per job → reused across retries so the provider de-duplicates. */
  idempotencyKey: string;
  estimatedCost: number;
}

export interface ClaimedJob extends NotificationJob {
  leaseUntil: Date;
  workerId: string;
}

/** Claims due jobs atomically; two workers can never claim the same job. */
export interface JobRepository {
  claimDue(now: Date, limit: number, workerId: string, leaseMs: number): Promise<ClaimedJob[]>;
  markProviderAccepted(jobId: string, providerRequestId: string | null): Promise<void>;
  scheduleRetry(jobId: string, nextAttemptAt: Date, reason: string): Promise<void>;
  markTerminal(
    jobId: string,
    state: Extract<
      NotificationState,
      'failed' | 'blocked-quota' | 'blocked-authorization' | 'cancelled' | 'expired'
    >,
    reason: string,
  ): Promise<void>;
  releaseExpiredLeases(now: Date): Promise<number>;
}

/** Re-checks, immediately before sending, that the destination may still receive this job. */
export interface DestinationGuard {
  revalidate(
    job: ClaimedJob,
  ): Promise<{ ok: true } | { ok: false; reason: 'bot-removed' | 'not-authorized' | 'inactive' }>;
}

/** Atomic reservation against the provider-derived monthly limit. */
export interface QuotaReserver {
  reserve(
    jobId: string,
    messages: number,
  ): Promise<{ ok: true; reservationId: string } | { ok: false; available: number }>;
  commit(reservationId: string): Promise<void>;
  release(reservationId: string): Promise<void>;
}

export interface DeliveryProvider {
  /** Must send with the job's idempotency key. Acceptance ≠ a human reading the message. */
  push(
    job: ClaimedJob,
  ): Promise<
    | { accepted: true; providerRequestId: string | null }
    | { accepted: false; retryable: boolean; status: number }
  >;
}

export interface RetryPolicy {
  nextAttemptAt(attempt: number, now: Date): Date | null;
}

/** Exponential backoff with a cap and a maximum number of attempts. */
export function exponentialBackoff(
  baseMs: number,
  maxMs: number,
  maxAttempts: number,
): RetryPolicy {
  return {
    nextAttemptAt(attempt, now) {
      if (attempt >= maxAttempts) return null;
      const delay = Math.min(baseMs * 2 ** attempt, maxMs);
      return new Date(now.getTime() + delay);
    },
  };
}

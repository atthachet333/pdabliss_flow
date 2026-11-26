/**
 * LINE message-quota estimation (pure).
 *
 * Verified platform facts (docs/LINE-INTEGRATION-PLAN.md):
 *  - Push / multicast / broadcast / narrowcast count toward the plan; reply messages do not.
 *  - A push to a group chat counts once per recipient in that chat.
 *  - The number of message objects in one request does not change the count.
 *
 * The monthly limit is NOT hard-coded: it is provider-derived configuration
 * (GET /v2/bot/message/quota). Values used in EP00 are mock fixtures.
 */
import type { DestinationOption } from './domain.js';

export interface QuotaSnapshot {
  /** Monthly limit reported by the provider (mock in EP00). */
  monthlyLimit: number;
  /** Consumption reported by the provider this month. */
  consumedThisMonth: number;
  /** Locally reserved for already-scheduled future reminders this month. */
  reservedThisMonth: number;
  /** Owner-configured safety reserve kept free for urgent use. */
  safetyReserve: number;
}

export type QuotaStatus = 'ok' | 'near-limit' | 'exceeds' | 'unknown-recipients';

export interface DestinationCost {
  destinationId: string;
  /** Messages counted per send, or null when the recipient count is unknown. */
  perSend: number | null;
}

export interface QuotaEstimate {
  perDestination: DestinationCost[];
  /** Known messages per reminder send (sum over destinations with known counts). */
  perReminderKnown: number;
  reminderCount: number;
  /** Total estimated messages for this appointment (known part only). */
  totalKnown: number;
  hasUnknownRecipients: boolean;
  /** Messages available after consumption, reservations and the safety reserve. */
  availableBefore: number;
  availableAfter: number;
  status: QuotaStatus;
}

export const NEAR_LIMIT_RATIO = 0.2;

export function costPerSend(
  destination: Pick<DestinationOption, 'kind' | 'memberCount'>,
): number | null {
  switch (destination.kind) {
    case 'private-self':
    case 'individual':
      return 1;
    case 'line-group':
      // A push to a group is counted per recipient. The bot itself is not a recipient.
      return destination.memberCount === null ? null : Math.max(destination.memberCount, 0);
  }
}

export function estimateQuota(
  destinations: readonly Pick<DestinationOption, 'id' | 'kind' | 'memberCount'>[],
  reminderCount: number,
  snapshot: QuotaSnapshot,
): QuotaEstimate {
  const perDestination = destinations.map((d) => ({
    destinationId: d.id,
    perSend: costPerSend(d),
  }));
  const perReminderKnown = perDestination.reduce((sum, d) => sum + (d.perSend ?? 0), 0);
  const hasUnknownRecipients = perDestination.some((d) => d.perSend === null);
  const totalKnown = perReminderKnown * Math.max(reminderCount, 0);
  const availableBefore = Math.max(
    snapshot.monthlyLimit -
      snapshot.consumedThisMonth -
      snapshot.reservedThisMonth -
      snapshot.safetyReserve,
    0,
  );
  const availableAfter = availableBefore - totalKnown;

  let status: QuotaStatus;
  if (hasUnknownRecipients) status = 'unknown-recipients';
  else if (availableAfter < 0) status = 'exceeds';
  else if (snapshot.monthlyLimit > 0 && availableAfter < snapshot.monthlyLimit * NEAR_LIMIT_RATIO)
    status = 'near-limit';
  else status = 'ok';

  return {
    perDestination,
    perReminderKnown,
    reminderCount,
    totalKnown,
    hasUnknownRecipients,
    availableBefore,
    availableAfter,
    status,
  };
}

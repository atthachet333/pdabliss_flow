/**
 * Reminder eligibility — the EP03 dispatch contract (EP02 consolidated).
 *
 * EP02 never sends anything. It stores calculated reminder rules (status + fireAt). Before
 * EP03 sends a reminder it MUST call `reminderEligibility` with fresh data read at send
 * time; only `{ eligible: true }` may lead to a LINE API call. Every other result is a
 * terminal skip that EP03 records (never retried, never "caught up" later).
 *
 * Inputs are deliberately plain so the worker can evaluate them without the API process.
 */
import { REMINDER_MIN_LEAD_MS } from './reminder-rules.js';

/** A due reminder older than this is stale: it is never delivered late. */
export const REMINDER_STALE_AFTER_MS = 10 * 60_000;

export type ReminderIneligibleReason =
  | 'rule-not-scheduled'
  | 'not-due'
  | 'stale'
  | 'appointment-cancelled'
  | 'bill-paid'
  | 'creator-inactive'
  | 'creator-not-member'
  | 'workspace-inactive'
  | 'destination-inactive'
  | 'recipient-inactive'
  | 'recipient-cannot-view'
  | 'delivery-paused';

export interface EligibilityInput {
  now: Date;
  rule: { status: string; fireAt: Date | null };
  appointment: { status: 'SCHEDULED' | 'CANCELLED'; paymentStatus: 'UNPAID' | 'PAID' | null };
  creator: { status: string; isActiveMember: boolean };
  workspace: { status: 'ACTIVE' | 'ARCHIVED' };
  destination: {
    status: 'PENDING' | 'ACTIVE' | 'DISABLED' | 'REMOVED';
    kind: 'PRIVATE_USER' | 'GROUP';
    /** PRIVATE_USER only: the recipient's account state and whether they may see the item. */
    recipient?: { status: string; canView: boolean } | null;
  };
  /** Global emergency stop / pause (EP03 control plane). */
  deliveryPaused: boolean;
}

export type Eligibility =
  { eligible: true } | { eligible: false; reason: ReminderIneligibleReason };

export function reminderEligibility(i: EligibilityInput): Eligibility {
  const no = (reason: ReminderIneligibleReason): Eligibility => ({ eligible: false, reason });
  if (i.deliveryPaused) return no('delivery-paused');
  if (i.rule.status !== 'SCHEDULED' || !i.rule.fireAt) return no('rule-not-scheduled');
  if (i.appointment.status === 'CANCELLED') return no('appointment-cancelled');
  if (i.appointment.paymentStatus === 'PAID') return no('bill-paid');
  const delta = i.now.getTime() - i.rule.fireAt.getTime();
  if (delta < -REMINDER_MIN_LEAD_MS) return no('not-due');
  if (delta > REMINDER_STALE_AFTER_MS) return no('stale');
  if (i.workspace.status !== 'ACTIVE') return no('workspace-inactive');
  if (i.creator.status !== 'ACTIVE') return no('creator-inactive');
  if (!i.creator.isActiveMember) return no('creator-not-member');
  if (i.destination.status !== 'ACTIVE') return no('destination-inactive');
  if (i.destination.kind === 'PRIVATE_USER') {
    const r = i.destination.recipient;
    if (!r || r.status !== 'ACTIVE') return no('recipient-inactive');
    if (!r.canView) return no('recipient-cannot-view');
  }
  return { eligible: true };
}

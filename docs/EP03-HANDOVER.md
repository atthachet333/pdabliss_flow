# EP03 handover — Smart Notification & Sally Experience

_Prepared at the end of EP02 consolidated, 2026-11-28. EP03 is **not started**. It needs
separate owner authorization._

EP02 calculates and stores reminders and never sends anything. These are the contracts EP03
builds on. Every item below is an integration task for EP03, not existing behaviour.

## 1. What to dispatch

A reminder is a `reminder_rules` row with `status = 'SCHEDULED'` and a `fireAt` instant, joined
to its appointment (an occurrence of a series, or a one-off) and its `appointment_destinations`
rows. Materialize **one persistent job per (rule × destination)** with an idempotency key such
as `rule.id:destination.id:fireAt`. Rescheduling replaces rule rows and changes `fireAt`, so
the key changes and the old job must be cancelled.

| Concern            | EP02 state EP03 must honour                                                                                                                                                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recurring          | Occurrences are normal rows materialized on a rolling horizon by API housekeeping (`SeriesService.extendAll`, every 15 minutes). EP03 should run extension from the worker too, or keep the API running. Never generate occurrences in the worker independently. |
| Reminder rules     | `CALENDAR` (dayOffset 0 to −7 at a local time) and `RELATIVE` (minutes before). `PAST`, `DISABLED`, `DUPLICATE`, `CANCELLED` and `SUPPRESSED` are never sent.                                                                                                    |
| Paid bills         | `appointments.paymentStatus = PAID` sets that occurrence's rules to `SUPPRESSED`. Pending jobs for it must be cancelled or skipped. A correction to UNPAID recalculates, and PAST stays PAST.                                                                    |
| Account revocation | Suspend and revoke end sessions and disable the private chat destination. Revoke also removes memberships and group grants. The worker must re-read user, membership and destination at send time.                                                               |
| Destinations       | Use `decideDestination` / `visibleToUser` rules: PRIVATE and SELECTED go to a group only as `PRIVACY_SAFE`; sensitive categories need confirmation; notes are never sent.                                                                                        |

**Mandatory send-time gate:** `reminderEligibility()` in `packages/shared/src/eligibility.ts`.
Build its input from fresh reads, and send only on `{ eligible: true }`. Every other reason is a
terminal, recorded skip: `delivery-paused`, `rule-not-scheduled`, `appointment-cancelled`,
`bill-paid`, `not-due`, `stale` (more than 10 minutes late — never delivered late, never replayed after
reactivation), `workspace-inactive`, `creator-inactive`, `creator-not-member`,
`destination-inactive`, `recipient-inactive` and `recipient-cannot-view`.

## 2. Messages

Build with `buildReminderPreview` + `toFlexMessage` and validate with `validateFlexMessage`.
Apply each destination's `contentPolicy`. RD07 (visually distinct calendar, relative,
previous-day, urgent and bill templates) is an EP03 deliverable. Timestamps use
`formatThaiDateTime` (RD08).

## 3. Administration Center integration points (UI already exists)

| Page                   | EP03 must provide                                                                                                                                                                                                                                                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/admin/activity`      | Join job and attempt records to `ActivityItemDto`: attempted time, LINE API acceptance and failure class. Keep the redaction rules in `OperationsService.activity`. Acceptance is not a read receipt.                                                                                                                                           |
| `/admin/notifications` | Real queue counts, failures, retry state and pause/resume/emergency stop. Each control needs recent LINE re-authentication (`requireRecentAuth`) and an audit entry, must stop **new** dispatches and must revalidate queued jobs before resuming. Replace `controls: 'not-enabled'` only when enforcement is real.                             |
| `/admin/quota`         | Already reads `GET /v2/bot/message/quota` and `/quota/consumption`. Add reservations (`QuotaDto.reservations`), the FLOW delivery log (`flowLog`), exhaustion enforcement and a conservative budget. No automatic paid upgrades.                                                                                                                |
| `/admin/friends`       | Signed and deduplicated follow/unfollow webhook events, a known-friend registry (first observed, last verified, friendship state), and aggregate `GET /v2/bot/insight/followers?date=` with the reporting date. Follower-ID listing only if the OA is eligible (verified/premium). Show coverage limits; a friendship never grants FLOW access. |
| `/admin/groups`        | Join/leave webhooks already create PENDING or REMOVED rows. Add owner linking and completed routing. Never send test messages to unapproved groups.                                                                                                                                                                                             |
| `/admin/health`        | Real worker heartbeat. Do not report healthy just because a process exists.                                                                                                                                                                                                                                                                     |

## 4. Release blockers carried into EP03 and EP04

- Real LINE acceptance items still open from EP02 (see [final acceptance](EP02-FINAL-ACCEPTANCE.md)).
- Confirmation that the canonical LIFF endpoint is restored and **Use webhook** is off.
- Outbound sending stays disabled until destination, owner, quota and emergency controls are
  verified with capped, approved recipients.

## 5. Synthetic test data gate (must be satisfied before any EP03 run)

The development database holds 204 future `SCHEDULED` reminder rules on synthetic EP02 test
records (Test01–Test05). All of them target the owner's private LINE chat. See the [cleanup plan](EP02-FINAL-ACCEPTANCE.md).
Before the first EP03 worker run against `pdabliss_flow_dev`:

1. The owner either cancels the synthetic series in the app ("ทุกครั้งในรายการนี้") or approves a
   guarded, audited cleanup. Nothing is deleted without approval.
2. The worker starts with delivery **disabled**. The first enabled run is a dry run that
   lists every job it would send. Delivery is enabled only for an explicit recipient
   allow-list with a small cap.
3. `reminderEligibility` (stale after 10 minutes, paid, cancelled, revoked, paused) is enforced on
   every job. Past synthetic reminders can never be "caught up".
4. Production (`pdabliss_flow`) starts empty in EP05. Dev records are never copied.

## 6. Readiness

EP02 is at **LOCAL PASS / REAL LINE ACCEPTANCE PARTIAL — EP02 CHECKPOINT**. The data contracts,
the eligibility gate and the admin integration points are ready. EP03 implementation
requires separate owner authorization. Carry these items forward:

- AUTH01 (second identity) and multi-user privacy acceptance;
- LIFF and webhook restoration (confirmed by the owner on 28 Nov: canonical endpoint, webhook OFF, 0/300). Recheck both before any EP03 session;
- the synthetic-data gate above.

# Notification engine plan (EP04)

EP00 ships **contracts only** (`apps/worker/src/contracts.ts`). No scheduler runs, no jobs are
claimed and nothing is sent.

## 1. Reminder rules (implemented in `packages/shared/src/reminders.ts`, tested)

R1 presets 0/5/10/15/30/60/120 minutes and 1 day · R2 custom 1–43,200 minutes · R3 at most 5 per
appointment · R4 duplicates collapsed and reported · R5 fire time must be at least 1 minute in the
future, otherwise "past" · R6 all-day anchors at 08:00 local · R7 sorted earliest first.

## 2. Architecture

- PostgreSQL-backed `notification_job` rows, one per (reminder × destination × appointment
  revision). No Redis unless load justifies it later.
- The worker polls every 15 s:
  `UPDATE … SET state='processing', lease_until=now()+60s, worker_id=$1 WHERE id IN (SELECT id
FROM notification_job WHERE state IN ('scheduled','retry-scheduled') AND fire_at <= now()
ORDER BY fire_at LIMIT $n FOR UPDATE SKIP LOCKED) RETURNING *`. This is an atomic claim, so two
  workers can never take the same job. Expired leases are released.
- Before sending (in order):
  1. **Job still valid**: the appointment exists, is not cancelled and the revision matches.
     Otherwise the job becomes `cancelled`.
  2. **Not expired**: `now ≤ expires_at`. Otherwise `expired`.
  3. **Destination revalidated**: active, Sally still a member, still authorized. Sensitive
     appointments also need the audience to still be authorized. Otherwise
     `blocked-authorization`. **Never** redirect to another destination.
  4. **Quota reserved atomically** (`UPDATE quota_month SET reserved = reserved + $n WHERE
limit - consumed - reserved - safety >= $n`). Otherwise `blocked-quota`, and the
     appointment stays saved.
- Send with a per-job **idempotency key** (reused across retries). Record a
  `notification_attempt` with provider status and request id.
- Success → `provider-accepted`. This is **not** "delivered" or "read". Acknowledgement is
  tracked separately from postbacks.
- Retryable failure (network, 5xx, 429) → `retry-scheduled` with exponential backoff (30 s
  base, 10 min cap, 5 attempts). 4xx non-retryable or attempts exhausted → `failed` (terminal,
  visible to the owner). Reservations are released on failure and committed on acceptance.

## 3. Lifecycle

`scheduled → processing → provider-accepted`
`processing → retry-scheduled → processing …`
`→ failed | blocked-quota | blocked-authorization | cancelled | expired` (terminal)

## 4. Edits, cancellation, restarts

- **Edit**: bump the appointment revision, cancel unsent jobs of older revisions in the same
  transaction and create new jobs. A late worker sees the revision mismatch and does not send.
- **Cancel**: cancel all unsent jobs. Optionally send the "cancelled" template once, if the user
  chooses to.
- **Restart and outage recovery**: jobs persist. On start, the worker releases stale leases.
  Overdue policy: a reminder whose `fire_at` passed is sent only if `now ≤ expires_at`, where
  `expires_at = min(fire_at + grace, appointment_start)` and grace is 15 min (or 2 h for
  1-day reminders). Older ones become `expired` and are listed. Old reminders are never flooded
  out after a long outage.

## 5. Quota

- The limit and consumption come from the LINE quota APIs, cached and reconciled hourly. Local
  estimates use member counts and treat an unknown count as "unknown", never 0.
- Owner-configurable safety reserve; per-workspace budgets are optional. A forecast of scheduled
  consumption for the rest of the month appears on `/quota`.
- No purchasing and no plan changes, ever.

## 6. Acknowledgement (EP05)

Postback buttons: รับทราบแล้ว / เข้าร่วม / ไม่สามารถเข้าร่วมได้ / ดูรายละเอียด / เลื่อนแจ้งเตือน.
The postback `data` is a short server-signed token (appointment, action, expiry). The server
authenticates the LINE user, checks authorization and makes writes idempotent per
(user, appointment, action). **Snooze is personal**: it creates a private reminder for that user
only and never re-notifies the group.

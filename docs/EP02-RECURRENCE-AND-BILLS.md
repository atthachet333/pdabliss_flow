# EP02 — Recurring appointments and monthly bills

_EP02 consolidated (former EP02.2 scope), 2026-11-28, Asia/Bangkok._

## Model

A **series** row (`appointment_series`) holds the recurrence rule and a validated occurrence
template. **Occurrences are ordinary `appointments` rows** with `seriesId` and
`occurrenceDate`. Every existing read model therefore works unchanged: Today, Calendar, Search,
History, detail, the one visibility predicate, destinations, reminder rows and audit. A recurring
item never appears twice, because each occurrence is exactly one row.

| Concept               | Storage                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Rule                  | `frequency`, `interval`, `monthDay` (1–31, −1 = last day), `missingDayPolicy`, `endType`, `untilDate`, `occurrenceCount`, `startDate` |
| Template              | `template` JSON (validated appointment input without date/recurrence; `JSON_VALID` checked)                                           |
| Occurrence identity   | `(seriesId, occurrenceDate)` — **unique key in MariaDB**; the generated local date never changes, even when that occurrence is moved  |
| Exception             | `appointments.isException = true` (edited on its own)                                                                                 |
| Bill                  | `appointments.kind = BILL`, `amount DECIMAL(14,2)`, `currency = THB`, `paymentStatus`, `paidAt`, `paidByUserId` (per occurrence)      |
| Paid suppression      | `reminder_rules.status = SUPPRESSED` for that occurrence only                                                                         |
| Materialization state | `appointment_series.generatedThrough`, `status` (ACTIVE / ENDED / CANCELLED)                                                          |

The rule engine is pure shared code: `packages/shared/src/recurrence.ts`. It works on local
calendar dates only and never uses the host, browser or database time zone.

## Rules

| Frequency | Occurrences                                                                   |
| --------- | ----------------------------------------------------------------------------- |
| Once      | No series (an ordinary appointment).                                          |
| DAILY     | Every _n_ days from the start date.                                           |
| WEEKLY    | Every _n_ weeks on the start date's weekday.                                  |
| MONTHLY   | Every _n_ months on the start date's day, a chosen day 1–31, or the last day. |
| YEARLY    | Every _n_ years on the start date's month and day.                            |

Missing days, such as the 31st in a 30-day month or 29 February in a common year, follow an
explicit policy. `LAST_DAY` uses the month's last day. `SKIP` creates no occurrence that period,
and a skipped period never counts towards a COUNT. Termination is `NEVER` (bounded by the
horizon), `UNTIL` (an inclusive local date) or `COUNT` (total occurrences from the series start).

**Time semantics.** Timed occurrences keep the same local clock time in the appointment's zone
(Asia/Bangkok by default). Their instants are stored in UTC. All-day occurrences are local dates
with the same span. The reminder engine is unchanged: `CALENDAR` rules keep their local clock
times and `RELATIVE` rules follow the start. For example, a 10:00 occurrence gets 06:00 the
previous day, 06:00 the same day and 09:00. Editing to 13:00 gives 06:00 the previous day,
06:00 the same day and 12:00. Regression tests cover this on both stores.

## Bounded materialization

Occurrences are created up to a rolling horizon from today:

| Frequency | Horizon   |
| --------- | --------- |
| DAILY     | 90 days   |
| WEEKLY    | 371 days  |
| MONTHLY   | 731 days  |
| YEARLY    | 1830 days |

Each pass creates at most 120 occurrences. The API housekeeping tick runs every 15 minutes and
extends ACTIVE series whose horizon is a week or more behind. A series is **paused** and not
extended when its creator can no longer create appointments in the workspace, because they were
removed, suspended, revoked or made a viewer. It is also paused when its destinations are no
longer permitted. Extension skips dates that already exist in any status, so it is idempotent.
A cancelled occurrence is never resurrected. Concurrent runners on two pools are safe: the
unique key decides, and the loser skips. MariaDB tests prove this. Calendar views beyond the
horizon show nothing for that series until it is extended, which is documented in the form.

## Editing and cancelling

The form and the detail page always ask for the scope of a recurring item.

| Scope                             | Edit                                                                                                                                                                                                             | Cancel                                                                                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **This occurrence only** (`THIS`) | Normal update of that row; it becomes an exception.                                                                                                                                                              | That row becomes CANCELLED with its reminders.                                                                                             |
| **This and future** (`FUTURE`)    | Split: the old series ends the day before (UNTIL, status ENDED), a new series starts from this occurrence with the new template or rule, and later occurrences move to it. A COUNT carries the remaining number. | The series ends the day before. This occurrence and later individually-edited ones become CANCELLED. Untouched generated ones are removed. |
| **Entire series** (`ALL`)         | The series template or rule changes. Occurrences from today, or from the edited occurrence if earlier, are rewritten in place with the same ids. Earlier ones stay as history.                                   | The series is CANCELLED from today. Past occurrences stay as history.                                                                      |

**Protected occurrences** are never rewritten or removed by a series operation: individually
edited exceptions, cancelled occurrences and paid bills. The occurrence being edited with
FUTURE or ALL takes the new values even if it was an exception. **Untouched generated
occurrences are derived data.** A series edit updates them in place when the rule still produces
their date. It deletes them, with their child rows, when the rule no longer does. Cancelling a
series removes them rather than filling history with up to 120 "cancelled" copies. Audit keeps
counts only (`series.created`, `series.updated`, `series.cancelled`). A one-off appointment
cannot be converted into a series (`RECURRENCE_CREATE_ONLY`); the user duplicates it instead.

## Bills

- **Fields:** title, due date (all-day by default), optional time, optional amount, currency THB,
  recurrence, note, workspace, visibility, destinations and reminders. Category stays separate
  from kind.
- **Money:** `DECIMAL(14,2)`. Input is normalized from strings such as `"1,250.5"` to
  `"1250.50"`, and formatting groups digits on the string. No floating point is used for
  persisted money, and the MariaDB round trip is exact (tested with `0.10`, `1250.05` and
  `999999999999.99`).
- **Variable bills:** the series amount is the default. A THIS edit overrides one occurrence.
  Null means the amount is not specified.
- **Payment status** belongs to one occurrence and is user-reported only. FLOW does not verify
  bank transfers and does not process payments.
  - `POST /api/v1/appointments/:id/payment {version, status}` is allowed for editors of the
    appointment; viewers get 403 and non-members 404.
  - PAID moves that occurrence's SCHEDULED reminders to SUPPRESSED and records `paidAt` and the
    reporting member. The next month is untouched.
  - UNPAID (a correction) recalculates. Times already passed become PAST and are never replayed.
  - Each change writes a `PAYMENT_CHANGED` event and an audit entry (`bill.marked_paid` or
    `bill.marked_unpaid`, with from/to status only).
- **Privacy:** bills use the appointment visibility and destination model. Amounts, titles and
  notes never appear in the audit log, the Activity Center or any admin view.

## EP03 contract

The worker must evaluate `reminderEligibility()` (`packages/shared/src/eligibility.ts`) with fresh
data at send time. Paid (`bill-paid`), cancelled, stale (more than 10 minutes late), inactive
creator, removed membership, inactive destination, recipients who cannot view, and a paused
system are all terminal skips. See [EP03 handover](EP03-HANDOVER.md).

# System architecture

## 1. Components

```
LINE app ──(Rich menu / Flex buttons)──► LIFF web app (apps/web, React+Vite)
   ▲                                          │ HTTPS + LINE ID token (EP01)
   │ push (Messaging API)                     ▼
   │                                     API (apps/api, Fastify) ──► MariaDB (EP02, Prisma)
   │                                          ▲                          ▲
   └──────── worker (apps/worker) ────────────┴── claims due jobs ───────┘ (EP04)
LINE Platform ──(webhooks: join/leave/postback, signed)──► API
```

- **One** LINE Official Account, **one** application deployment and **one** database. Groups
  are isolated logically, never by separate deployments.
- `packages/shared` holds pure domain logic used by every app (no I/O): time zones, reminder
  planning, quota estimation, destination rules and the Flex presentation model.
- `packages/design-system` holds tokens and styles.

## 2. Implemented in EP00 vs. planned

| Area     | EP00                                                                                                   | Later                                                    |
| -------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Web      | App shell, dev showcase, prototypes on mock data                                                       | LIFF init (EP01), real screens (EP02)                    |
| API      | Factory, env validation, redacted logging, `/health`, error envelope, headers, CORS, graceful shutdown | Auth (EP01), domain endpoints (EP03), webhooks (EP01/03) |
| Worker   | Contracts and backoff helper; process prints status and exits                                          | Scheduler (EP04)                                         |
| Database | **None**. Model below is a proposal                                                                    | Prisma schema and migrations (EP03)                      |

## 3. Proposed domain model (not yet persisted)

```
User 1─* LineIdentity              (provider-scoped LINE userId; never trusted from the client)
User *─* Workspace via WorkspaceMembership(role: system-owner | workspace-admin | member | viewer)
Workspace 1─* LineDestination       (group | individual | private; lifecycle state; no raw IDs in UI)
LineDestination 1─* DestinationRegistration (pending → verified by admin, short-lived code)
Appointment *─1 Workspace           (owner workspace; revision counter; UTC start + IANA zone,
                                     or local date for all-day)
Appointment 1─* AppointmentAudience     (who may VIEW: users / workspace roles)
Appointment 1─* AppointmentParticipant  (people invited; RSVP)
Appointment 1─* AppointmentDestination  (where to NOTIFY; each separately authorized)
Appointment 1─* ReminderRule        (offset minutes)
ReminderRule × AppointmentDestination → NotificationJob (fireAt, expiresAt, revision, idempotencyKey)
NotificationJob 1─* NotificationAttempt (provider status, request id, error)
NotificationJob 1─0..1 QuotaReservation (messages reserved → committed or released)
User × Appointment → Acknowledgement     (separate from delivery)
AuditEvent                          (who did what; no appointment descriptions)
```

Key rules:

- **Visibility ≠ destination.** Being in a LINE group never grants access to FLOW data.
  Audience and destinations are authorized independently. There is no single `groupId` shortcut.
- **Admin capability ≠ content visibility.** A system owner can manage destinations without
  reading other users' private appointments.
- Every query is scoped by membership. Deep links to unauthorized appointments return the same
  response as non-existent ones.

## 4. Time

- Timed appointments are stored as a **UTC instant plus the IANA zone** (default
  `Asia/Bangkok`). Recurrence (EP02+) expands in local time, so "every Monday 09:00" stays
  09:00 local.
- **All-day** appointments are stored as a **local date** (`YYYY-MM-DD`) and never pass
  through UTC. Reminders anchor at 08:00 local on that date.
- Display uses `th-TH` with the **Buddhist calendar** (`2569`) and 24-hour `09:00 น.`
- Implemented and tested in `packages/shared/src/time.ts`, including DST zones to check
  generality.

## 5. Recurrence (plan)

Daily, weekly, monthly and yearly, stored as a rule plus exceptions (`occurrenceDate →
cancelled | moved`). Jobs are materialised for a rolling window (for example 35 days) by the
worker, so edits regenerate only future occurrences. Editing one occurrence creates an exception
and does not touch the series. Monthly "31st" falls back to the last day of the month (to be
confirmed with the owner).

## 6. Repository and tooling

npm workspaces, TypeScript 5.9 strict (`noUncheckedIndexedAccess`), ESLint 9 flat config,
Prettier, the Node test runner through `tsx`, Vite 7 and React 19, and Fastify 5. Shared builds to
`dist` for Node consumers. Vite aliases shared to its source for hot reload.

## 7. Database isolation (plan)

`pdabliss_flow_dev` (local), `pdabliss_flow_test` (automated tests; recreated per run; the test
runner refuses any URL whose database name does not end in `_test`) and `pdabliss_flow`
(production, EP07 only). Each has separate credentials. Production credentials are never used
locally.

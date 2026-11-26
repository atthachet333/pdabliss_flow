# EP02 — Architecture

```
LINE app ─ LIFF ─► Gateway :6769 (allow-listed SPA routes + /api/*)  ─►  API :6768 (Fastify)
                                                                         │  auth (LINE ID token → session)
Browser SPA (React/Vite, apps/web)                                      │  /api/v1 (typed, zod)
                                                                         │  domain services + policy
                                                                         ▼
                                                              Store port ─► PrismaStore ─► MariaDB
                                                                         └► MemoryStore (tests only)
```

## Backend layers (`apps/api/src`)

| Layer       | Files                                                             | Responsibility                                                               |
| ----------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| HTTP        | `auth/routes.ts`, `http/v1.ts`, `http/context.ts`, `app.ts`       | Origin before parsing, CSRF on mutations, rate limits, zod validation, DTOs  |
| Domain      | `domain/*.ts`                                                     | identity, workspaces, invitations, destinations, appointments, audit         |
| Policy      | `domain/policy.ts`                                                | the only place permissions are decided ([matrix](EP02-PERMISSION-MATRIX.md)) |
| Store       | `store/types.ts` (contract), `store/prisma.ts`, `store/memory.ts` | persistence; transactions; conditional (atomic) updates                      |
| Safety      | `db/guard.ts`, `store/fail-closed.ts`, `store/housekeeping.ts`    | target guards, undefined-filter guard, bounded storage                       |
| Local tools | `cli/flow-admin.ts`, `scripts/db.mjs`                             | owner import/bootstrap, guarded Prisma commands (no HTTP equivalent)         |

**Two stores, one contract.** `PrismaStore` runs the application (development now, production
later). `MemoryStore` backs fast, deterministic tests. The same suites — store contract,
9-role permission matrix and end-to-end scenarios — run against both
(`tests/` and `tests-db/`). The server has no fallback: if `DATABASE_URL` is configured but
MariaDB is unreachable or is not the expected database, the API refuses to start; if it is not
configured, every auth/application route answers 503. Runtime database failures answer
`503 DATABASE_UNAVAILABLE` without echoing driver text.

## Authentication & sessions (EP01 contract, now persistent)

LIFF ID token → `POST /api/auth/line` → verified with LINE server-side (never a client-supplied
LINE id) → user upserted (`NEW` on first sight) → session row keyed by `HMAC(secret, id)`; cookie
`__Host-flow_session` (HttpOnly, Secure, SameSite=Lax, Path=/), idle 2 h / absolute 8 h;
CSRF = `HMAC(secret, "csrf:"+id)` in memory only; login rotates the session (fixation); logout,
suspension and revocation end session rows (replay = 401). Rate limits persist in MariaDB
(login 10/5 min, API 120/min per trusted client identity — the gateway's `x-flow-client-ip` is
honoured only from loopback). Every verified user gets a session; only `ACTIVE` users reach the
application. Single-flight login, cooldowns and `Retry-After` handling stay in the web client.

## Appointments & reminders

- Create = one transaction: appointment + SELECTED grants + destinations + reminder rules
  (with computed `fireAt`/status) + lifecycle event + audit + idempotency key claim
  (`Idempotency-Key` header required; a replay returns the original appointment).
- Update = conditional on `version` (409 on a stale edit); children replaced and reminders
  recalculated in the same transaction. Cancel = status change; every reminder → `CANCELLED`.
  No hard deletes.
- Reminder engine v1 (`packages/shared/src/reminder-rules.ts`, shared by API and web):
  `RELATIVE` (minutes before the anchor) and `CALENDAR` (day offset 0…-7 at a local clock time).
  Anchor = start time, or 08:00 local for all-day. Statuses: SCHEDULED, PAST (< 1 min ahead —
  never sent late), DISABLED, DUPLICATE (same kind and same instant — sent once), CANCELLED;
  cross-kind collisions are flagged `sameTimeAs`, not merged; CALENDAR after a timed start is
  invalid; max 5 rules. Time zone Asia/Bangkok, computed without the OS time zone.
  Example: 10:00 → 06:00 + 09:00; moved to 13:00 → 06:00 + 12:00.
- Flex preview (`flex-message.ts`): deterministic template, validated payload, `PRIVACY_SAFE`
  hides title/location; notes never included. Previews and estimates never call LINE. Quota is
  never hard-coded: estimates are labelled as estimates until a LINE-reported quota exists.

## Frontend (`apps/web/src/app`)

| Route                                                                  | Page                                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `/today`                                                               | Sally greeting, next appointment, stats, today, upcoming                        |
| `/calendar`                                                            | month / week / 30-day agenda, server-side range + filters                       |
| `/appointments/new`, `/:id`, `/:id/edit`                               | form (reminders, visibility, destinations, preview, estimate), detail + history |
| `/search`, `/history`                                                  | paged, server-filtered lists                                                    |
| `/groups`, `/groups/:id`                                               | workspaces, members, roles, leave, archive                                      |
| `/settings`, `/settings/preferences`, `/settings/privacy`              | account, defaults, privacy explanation                                          |
| `/owner`, `/owner/{requests,users,users/:id,invitations,groups,audit}` | Owner Console (lazy-loaded)                                                     |
| `/invite/:token`                                                       | invitation acceptance (also for NEW/PENDING accounts)                           |
| `/privacy`, `/terms`                                                   | drafts flagged for owner review                                                 |

The client route table (`src/routes.ts`) equals the gateway allow-list (test:
`apps/web/tests/routes.test.ts`). One `AuthApp` instance serves every path, so navigation never
re-runs login. Data: `useLoad` per page keyed by the request parameters (no shared cache that
could outlive a workspace switch or an identity change; the app remounts per user id).
`/me` is re-read on every navigation so permission changes show immediately. The workspace
filter is kept in `sessionStorage` (ids only). Writes are never queued offline: a network
failure shows an error and keeps the form in memory; the create Idempotency-Key is reused on
retry, so a double tap or a retry cannot create a duplicate. No appointment data is stored in
browser storage.

## EP03 contract (design only — nothing is sent in EP02)

The EP03 worker will select `reminder_rules` with `status = 'SCHEDULED' AND fireAt <= now`
joined to non-cancelled appointments and their `appointment_destinations`, build the message
with `buildReminderPreview` + `toFlexMessage` using each destination's `contentPolicy`, re-check
policy at send time (membership, visibility, destination status), reserve quota, and record
delivery per (rule × destination) idempotently. Rule semantics are stored unchanged, so
rescheduling recalculates without losing meaning.

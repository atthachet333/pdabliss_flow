# EP02 — Test matrix

## Counts

| Suite                       | EP01 baseline | EP02 now | Where it runs                              |
| --------------------------- | ------------- | -------- | ------------------------------------------ |
| API (`apps/api/tests`)      | 86            | 132      | `npm.cmd run test` (MemoryStore)           |
| API on MariaDB (`tests-db`) | –             | 36       | `npm.cmd run test:db` (pdabliss_flow_test) |
| Web (`apps/web/tests`)      | 39            | 48       | `npm.cmd run test`                         |
| Shared (`packages/shared`)  | 42            | 65       | `npm.cmd run test`                         |
| Design system               | 14            | 14       | `npm.cmd run test`                         |
| Worker                      | 2             | 2        | `npm.cmd run test`                         |
| Drift guard                 | –             | 3        | `npm.cmd run test`                         |
| **Total**                   | **183**       | **300**  |                                            |

All 183 EP01 tests are kept. The 34 EP01 auth tests were migrated one-to-one (same names and
intent) where EP02 changed the contract: access file + reference codes → in-app access request
and Owner Console; env allow-list testers → retired; pending = no session → session with zero
access. The EP01 web tests for "not-approved + reference" assert the new account screens.

## Coverage → tests

| Requirement                                                                                             | Tests                                                                                                                |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| DB target guards                                                                                        | `db-guard.test.ts` (prod/unknown/remote/params/cross-purpose, no secrets in errors)                                  |
| Fail-closed filters                                                                                     | `fail-closed.test.ts`; contract "fail-closed filters" (both stores)                                                  |
| Migration + schema equivalence                                                                          | `db.mjs drift`, `deploy test` (V04)                                                                                  |
| Unicode / Thai / emoji / case-sensitive ids                                                             | contract "LINE identities…", "calendar dates…"; scenario S12                                                         |
| Transactions, rollback, concurrency                                                                     | contract "transactions roll back", "optimistic concurrency", "invitations redeem exactly once", rate-limit atomicity |
| Identity, sessions, expiry, restoration, revocation, restart                                            | `auth.test.ts` (34); scenarios S8, S9, logout replay                                                                 |
| Persistent rate limits + Retry-After                                                                    | `auth.test.ts` rate-limit suite; S9                                                                                  |
| Access requests, approval/rejection, mobile approval (E15)                                              | S1, S1b, auth "access requests are bound…"                                                                           |
| Owner migration                                                                                         | auth "denies by default; … second owner needs explicit flag" (`importOwner`)                                         |
| Invitations: expiry, replay, revoke, concurrency, no escalation                                         | S2, S2b; contract invitations                                                                                        |
| Workspace authz, cross-workspace isolation                                                              | S3, S10, workspace management, 9-role matrix                                                                         |
| Private isolation incl. global owner                                                                    | S4, matrix row 2                                                                                                     |
| CRUD, duplicate submit, stale edit                                                                      | S5–S7, "duplicate submit…", S5+S6 stale version                                                                      |
| Reminders (06:00/09:00 → 06:00/12:00, all-day, previous day, past, duplicates, TZ boundaries, leap day) | `reminder-rules.test.ts` (13), S5+S6                                                                                 |
| Cancellation                                                                                            | S7                                                                                                                   |
| Destination authorization + privacy rules                                                               | S10, preview test                                                                                                    |
| Flex payload validation                                                                                 | `flex-and-api.test.ts`                                                                                               |
| Webhook signature + persistent dedupe                                                                   | `webhook.test.ts`, S11 (incl. restart)                                                                               |
| Database unavailable (E14)                                                                              | `db-unavailable.test.ts`; smoke phase C (API refuses to start)                                                       |
| Frontend: auth states, account states, no offline replay, CSRF/idempotency headers, route parity        | `auth-flow.test.ts`, `routes.test.ts`                                                                                |

## End-to-end scenarios (spec E01–E15)

`tests/support/scenarios.ts` drives the real HTTP API (`app.inject`) with synthetic identities;
the identical file runs on MemoryStore and on MariaDB.

| Spec | Scenario test                                                    |
| ---- | ---------------------------------------------------------------- |
| E01  | S1 new user → in-app request → owner approves → workspace        |
| E02  | S2 invitation lifecycle, replay, concurrent redemption           |
| E03  | S3 family ↔ company isolation (lists, counts, search)            |
| E04  | S4 private appointment vs global owner and group admin           |
| E05  | S5 10:00 → 06:00 + 09:00                                         |
| E06  | S6 moved to 13:00 → 06:00 + 12:00                                |
| E07  | S7 cancellation                                                  |
| E08  | S8 removed membership / revoked account, existing session        |
| E09  | S9 restart persistence                                           |
| E10  | S10 forged workspace/destination ids                             |
| E11  | S11 duplicate webhook events                                     |
| E12  | S12 Thai + emoji                                                 |
| E13  | "duplicate submit with the same Idempotency-Key"                 |
| E14  | API fault injection, real MariaDB pool outage, and smoke phase C |
| E15  | S1 (no CLI involved)                                             |

These scenarios exercise the real API with synthetic identities. Real multi-user LINE acceptance
is a separate owner step. See the [owner checklist](EP02-OWNER-CHECKLIST.md).

## Browser and LINE acceptance

Local browser QA covers the built app at 320, 375, 390, 430, 768 and 1440 px. It exercises
keyboard focus, dialogs, touch target dimensions and the synthetic authentication and invitation
flows. See the [remediation report](EP02.1-REMEDIATION-REPORT.md) for the evidence and real LINE status.

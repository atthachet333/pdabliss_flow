# EP02 — API (`/api/v1`)

Same-origin JSON. Every route requires a FLOW session; application routes require an `ACTIVE`
account (`403 ACCOUNT_<STATE>` otherwise). Mutations require an allowed `Origin` (checked
before the body is parsed) and the `x-flow-csrf` header. Bodies are validated with strict zod
schemas from `packages/shared/src/api-v1.ts` (unknown fields → 400). Errors:
`{ error: { code, message, requestId, details? } }`. Unauthorized and non-existent ids both
answer 404. Rate limit: 120 requests/min (`429 RATE_LIMITED` + `Retry-After`). Database down:
`503 DATABASE_UNAVAILABLE` + `Retry-After`.

| Method & path                                                               | Purpose                                                                  |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `GET /me`                                                                   | user, status, workspaces (+ role), permissions, preferences, owner badge |
| `POST /access-requests`                                                     | NEW/REJECTED user asks for access (one open request)                     |
| `GET, PUT /preferences`                                                     | default workspace, reminders, visibility, content policy                 |
| `POST /invitations/inspect`, `/redeem`                                      | token in the body only; redeem files a request for approval              |
| `GET, POST /workspaces`                                                     | my workspaces; create (FAMILY/COMPANY/CUSTOM)                            |
| `GET, PATCH /workspaces/:id`                                                | detail + members + `can`; rename/kind with `version`                     |
| `POST /workspaces/:id/archive`, `/leave`                                    | archive (admin), leave (last-admin guard)                                |
| `GET /workspaces/:id/candidates`                                            | active users that can be added (admin)                                   |
| `POST, PATCH, DELETE /workspaces/:id/members[/:userId]`                     | add, change role, remove (admin)                                         |
| `GET /workspaces/:id/destinations`                                          | destinations I may use for this workspace                                |
| `GET /appointments`                                                         | search: `q, workspaceId, category, status, from, to, offset, limit`      |
| `POST /appointments`                                                        | create; header `Idempotency-Key` required                                |
| `GET, PUT /appointments/:id`                                                | detail; update `{ version, appointment }` (409 when stale)               |
| `POST /appointments/:id/cancel`                                             | `{ version }`; all reminders → CANCELLED                                 |
| `GET /appointments/:id/history`, `/duplicate`                               | lifecycle events; a draft copy                                           |
| `GET /today`, `GET /calendar?from&to`, `GET /history?scope`                 | read models (server-side range ≤ 62 days)                                |
| `POST /preview/reminder`, `/preview/estimate`                               | Flex preview / message estimate — never sent                             |
| `GET /admin/summary`                                                        | pending requests, user counts, LINE groups (console)                     |
| `GET /admin/access-requests`, `POST …/:id/approve`, `…/:id/reject`          | decide requests (+ workspace assignments)                                |
| `GET /admin/users`, `GET /admin/users/:id`                                  | search; detail (memberships, account history)                            |
| `POST /admin/users/:id/status`, `/role`; `PUT …/memberships`                | suspend/reinstate/revoke/reactivate; ADMIN↔USER (owner); membership      |
| `GET /admin/workspaces`                                                     | workspaces for assignment                                                |
| `GET, POST /admin/invitations`, `POST …/:id/revoke`                         | the link is returned **once** at creation                                |
| `GET /admin/destinations`, `PATCH …/:id`, `PUT/DELETE …/:id/grants/:userId` | LINE groups (owner only)                                                 |
| `GET /admin/audit`                                                          | actions + actors; appointment metadata hidden                            |

Authentication routes (`/api/auth/*`) and the webhook keep the EP01 contract; see
[EP01-ARCHITECTURE.md](EP01-ARCHITECTURE.md). Webhook events are deduplicated in MariaDB
(7 days); a `join` creates a PENDING group registration, `leave` marks it REMOVED; nothing is
sent back to LINE.

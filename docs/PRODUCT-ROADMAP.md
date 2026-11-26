# Product roadmap

Requirements live in [MASTER-SPECIFICATION.md](MASTER-SPECIFICATION.md). This file tracks
**status**. Each episode needs its own explicit authorization from the owner.

| Episode                                                                                                        | Scope (summary)                                                                                                                                                                                                                                                             | Status                                              |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **EP00** Signature identity & foundation                                                                       | Monorepo, Sally and brand, design system, app shells, dev showcase, docs, local gates                                                                                                                                                                                       | **Delivered: see [EP00-REPORT.md](EP00-REPORT.md)** |
| EP01 LINE integration & authentication                                                                         | LINE Developers setup guide, webhook signature validation, LIFF init, server-side token verification, private access                                                                                                                                                        | **Delivered**: see [EP01-REPORT.md](EP01-REPORT.md) |
| **EP02 Complete Application, Database & Privacy** (merges the original EP02 + EP03, owner decision 2026-11-26) | PostgreSQL + Prisma (separate dev/test/prod DBs), calendar and appointment CRUD, user management, mobile user approval, invitation links, group membership and permissions, private appointment visibility, multi-stage reminders (same-day morning + relative), audit logs | Not started                                         |
| EP04 Smart notification engine                                                                                 | Persistent jobs, worker, Flex builders, quota reservation, retry/idempotency, cancel/reschedule                                                                                                                                                                             | Not started                                         |
| EP05 Signature experience & polish                                                                             | Final Sally art, final rich menu export and upload, acknowledgement postbacks, micro-interactions, a11y                                                                                                                                                                     | Not started                                         |
| EP06 Senior QA & security audit                                                                                | Functional, integration and authorization tests, leakage/tampering/duplicate/quota/restart tests, mobile QA                                                                                                                                                                 | Not started                                         |
| EP07 Production deployment                                                                                     | Isolated DB, secrets, PM2 ×3, Cloudflare Tunnel, HTTPS, LINE prod config, smoke tests, rollback, pilot                                                                                                                                                                      | Not started, needs separate authorization           |

## Carried forward from EP00

- Sally: the owner-approved car-mascot reference is canonical. EP05 refines the vector
  expressions and produces final rich-menu and profile exports from it.
- FLOW symbol and wordmark: concept v0, still awaiting owner review.
- Verify the Thai free-plan quota on the real LINE OA (planning value of 300 is unverified).
- Watch the reported LINE Thailand change that would cap free Reply API messages from Feb 2027.
  This comes from a secondary source only (see LINE-INTEGRATION-PLAN.md §2).
- LINE resources already exist (LINE-INTEGRATION-PLAN.md §4). EP01 must reuse them, not create
  new ones.

Resolved in EP00: CSS custom properties approved instead of Tailwind; React Hook Form, TanStack
Query and Framer Motion deferred (DESIGN-SYSTEM.md §7).

## Recorded future requirement (EP02, not implemented)

Reminders on one appointment can combine a **same-day morning reminder** and **relative
reminders**. Example: for an appointment at 10:00, remind at 06:00 (morning of the day) and
at 09:00 (one hour before). The later episodes keep their current numbers until the owner
revises the plan.

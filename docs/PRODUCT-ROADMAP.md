# Product roadmap

Requirements live in [MASTER-SPECIFICATION.md](MASTER-SPECIFICATION.md). This file tracks
**status**. Each episode needs its own explicit authorization from the owner.

| Episode                                  | Scope (summary)                                                                                                            | Status                                              |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **EP00** Signature identity & foundation | Monorepo, Sally and brand, design system, app shells, dev showcase, docs, local gates                                      | **Delivered: see [EP00-REPORT.md](EP00-REPORT.md)** |
| EP01 LINE integration & authentication   | LINE Developers setup guide, webhook signature validation, LIFF init, server-side token verification, private access       | Not started, awaiting approval                      |
| EP02 Flagship LIFF experience            | Today, calendar, agenda, create/edit UI, details, live preview, mobile polish                                              | Not started                                         |
| EP03 Multi-group & privacy               | Prisma schema, dev/test DB isolation, workspaces, destinations, visibility rules, persistence, cross-group isolation tests | Not started                                         |
| EP04 Smart notification engine           | Persistent jobs, worker, Flex builders, quota reservation, retry/idempotency, cancel/reschedule                            | Not started                                         |
| EP05 Signature experience & polish       | Final Sally art, final rich menu export and upload, acknowledgement postbacks, micro-interactions, a11y                    | Not started                                         |
| EP06 Senior QA & security audit          | Functional, integration and authorization tests, leakage/tampering/duplicate/quota/restart tests, mobile QA                | Not started                                         |
| EP07 Production deployment               | Isolated DB, secrets, PM2 ×3, Cloudflare Tunnel, HTTPS, LINE prod config, smoke tests, rollback, pilot                     | Not started, needs separate authorization           |

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

# Product roadmap — Weekend Sprint, 28–30 November 2026

Requirements baseline: [MASTER-SPECIFICATION.md](MASTER-SPECIFICATION.md). This roadmap records the owner's 28 November 2026 scope and schedule update, superseding the earlier episode numbering and schedule where inconsistent. Historical reports retain their original numbering. Each implementation episode and production deployment still requires explicit owner authorization. This is a documentation update, not deployment approval.

## Target

- Saturday 28 Nov: application closure, recurrence/bills, member colors, desktop administration.
- Sunday 29 Nov: notification engine, LINE onboarding/group linking, Sally experience, independent QA, conditional deployment.
- Monday 30 Nov: controlled private pilot with owner-approved family and employees, only if release gates pass. If not, continue staging or postpone the affected pilot; never waive security/privacy/delivery gates to meet the date.
- Asia/Bangkok; no additional paid subscriptions or automatic plan upgrades; existing LINE resources and isolated MariaDB/Prisma infrastructure. No changes to unrelated systems, including HR LINE bot.

| Episode | Scope | Status |
| --- | --- | --- |
| EP00 Signature identity & foundation | Monorepo, Sally, design system, shells, local gates | Delivered: [EP00-REPORT.md](EP00-REPORT.md) |
| EP01 LINE integration & authentication | LIFF, server-side identity verification, signed webhooks, private access | Delivered: [EP01-REPORT.md](EP01-REPORT.md) |
| EP02 Complete Application, Database & Privacy | Original EP02 + EP03 merged; MariaDB/Prisma, calendar CRUD, permissions, owner approval, invites, audit, multiple reminder rules | LOCAL PASS / REAL LINE ACCEPTANCE PARTIAL; checkpoint c9aebb4 |
| EP02.1 Acceptance remediation | Schema drift, database outage, invitation concurrency, dependencies, verification | Local pass: 300/300 tests, 31 passing gates, one intentional install skip, 36/36 real MariaDB tests, zero npm audit findings, 175 browser states |
| EP02.2 Real-device remediation & recurring application | RD01–RD06/RD08, WebKit, per-workspace member colors, recurring appointments and monthly bills, paid status | Next — Saturday |
| EP02.3 Platform Administration Center | Desktop-first web admin using existing owner APIs, retain mobile console, verified LINE requests, roles, workspace access, audit, Activity Center and User Access Control | Planned — Saturday |
| EP03 Smart Notification & Sally Experience | Merges former EP04/EP05: persistent worker, quota, retry/idempotency, group linking, onboarding, Flex, rich menu, acknowledgement, emergency controls | Planned — Sunday |
| EP04 Senior QA, Security & Reliability | Former EP06: independent audit, real device, multi-user, scheduling, quota, recovery, backup/restore | Planned — Sunday |
| EP05 Production Deployment & Pilot | Former EP07: isolated production, PM2, Cloudflare, LINE config, smoke, rollback, pilot | Planned — Sunday; separate deployment authorization required |

## Saturday — EP02.2

1. Sync office repo from c9aebb4 or newer reviewed HEAD; check clean worktree, existing external secrets, isolated dev/test/shadow DBs, migrations and dependencies. Do not copy condo personal data or credentials into Git.
2. Resolve RD01–RD06 and RD08 per [EP02-REAL-DEVICE-FINDINGS.md](EP02-REAL-DEVICE-FINDINGS.md); add WebKit regression and real iPhone LIFF retest. Preserve current branding. RD07 moves to EP03.
3. Member colors: user chooses own accessible color per workspace; default palette, labeled identity, no role or privacy inference, no leakage of hidden appointments.
4. Recurrence: once/daily/weekly/monthly/yearly; fixed day or month-end; explicit last-day/skip behavior for missing dates; local timezone and all-day semantics; edit/cancel one occurrence, future occurrences, or entire series with clear confirmation. Stable occurrence identity and no duplicate generation.
5. Monthly bills: optional amount, due date, recurring rule, per-occurrence unpaid/paid state; paid is user-reported, not bank verified. Mark paid stops pending reminders only for that occurrence; subsequent months remain active. Support changing amount per occurrence; no payment processing or accounting ledger.
6. Preserve same-day morning, previous-day calendar and relative reminder semantics; multiple rules can coexist. Example 10:00 -> 06:00 and 09:00; edit to 13:00 -> 06:00 and 12:00.
7. Complete pending EP02 acceptance: session restoration/re-login, history, owner console, second identity approval, invitation replay, multi-user privacy, outbound usage review and device regression. Existing 300-test baseline and all mandatory gates must pass; new tests for recurrence/color/bills.

## Saturday — EP02.3

- Proposed /admin desktop-first responsive shell on the same app/API/DB; reuse /owner logic and retain mobile approval. Verify external browser LINE login and secure session rather than introduce separate passwords. No mock auth.
- Requests: verified LINE identity, display name, profile image if available/authorized, masked ID, request date/message and invitation context; duplicate names do not determine identity. Distinguish authenticated LINE identity from real-world identity and friendship.
- Owner approves/rejects and selects permitted workspace roles (Viewer/Member/Group Admin); default global USER. Global ADMIN elevation is a separate owner-only confirmation, not automatic invitation approval.
- User management: suspend/reinstate/revoke/reactivate, session invalidation, workspace membership changes, protected owner account; audit all privileged operations. Preserve existing server authorization and scope restrictions.
- Dashboard, requests, users, workspaces, roles, invitations/LINE groups, audit; notification/health/quota/control panels use real data once EP03 is available, otherwise clearly unavailable. No fake metrics.
- No privileged reading of personal appointments, bills or notification payloads; metadata only as required. Owner cannot bypass privacy through admin, audit, export or API. Verify role escalation/IDOR/CSRF and direct route/API access.

### Owner scope addition — Activity Center and User Access Control

- Add /admin/activity: system-wide notification operational overview, filters by date/status/authorized workspace, scheduled and attempted times, notification type, destination/recipient where authorized, recurring/one-off indicator, usage and failure state. Display shared appointment titles only where the viewer already has content access. Do not display creator identity in this overview. For private or restricted appointments, use redacted/aggregated operational metadata without title, body, sensitive category, recipient identity or correlatable details that disclose private content. No new content access through admin, exports or API; retain restricted security audit actor records separately. Distinguish LINE API acceptance from actual delivery/read receipts. EP02.3 implements the shell and authorized existing data; EP03 connects actual delivery records; unavailable metrics must be labeled, never fabricated.
- Add /admin/users access-control view with search, status filters and explicit enable/disable actions. Reuse existing suspend/reinstate/revoke/reactivate APIs and server-side permission checks; protect owner and prevent privilege escalation. Support removing only company workspace membership as a separate offboarding option from platform-wide revocation. Require confirmation and fresh authorization for sensitive changes; invalidate affected sessions and deny stale credentials, revalidate pending jobs and destinations before dispatch. Reactivation after revocation requires explicit review of memberships/roles; do not blindly restore access or replay stale reminders. Preserve shared company appointments and necessary audit records, without automatic deletion of personal data. Explain that FLOW revocation cannot remove a person from a LINE chat or recall prior/in-flight messages; manual LINE group removal is a separate offboarding step. Test direct API access, revoked sessions, job suppression and reactivation.
- Final scope ends at EP05; no EP06+, commercial multi-tenant SaaS, subscriptions, public signup or payment processing. Optional isolated demo workspace/account with synthetic data for supervised iPhone/iPad demonstrations, only if time permits and privacy gates pass. Customer work can be scoped separately later.

## Sunday — EP03

- Persistent MariaDB jobs and worker; atomic claims, bounded retries, LINE retry keys where supported, quota reservations, cancellation/rescheduling/paid status, restart recovery, stale-job policy, send-time authorization and destination validation. No claim of delivery/read receipt merely from API acceptance.
- Active users authenticate via LIFF and owner approval; private notifications require eligible LINE recipient (friendship check where available). Passive group recipients need not register FLOW. Follow event/welcome message and LIFF start link; no automatic access.
- Signed join/leave webhooks register pending LINE group destinations; owner explicitly links authorized workspace; no notification before approval. Group chat membership differs from FLOW membership; everyone in the LINE group can read a group message. Reject private/subset payload to group; use authorized private recipients. Do not modify existing HR bot or use a group occupied by another OA.
- Sally Flex: distinct morning, previous-day, upcoming, urgent and bill templates; retain category labels and original branding; RD07, Thai date formatting and preview/payload consistency. Change/cancel and acknowledgement templates/actions only where explicitly enabled and quota-safe. Paid action requires authorization and affects one occurrence only. No automatic daily digest.
- Six-action private-chat rich menu: Today, Create, Calendar, Groups, History, Settings; use approved artwork, verify links and actual LINE rendering. Reuse existing channels; no unapproved public exposure or production changes in development.
- Owner control: real quota and queue metadata, worker health, pause/resume and emergency stop with re-authentication/audit; stop new dispatches (in-flight requests cannot be recalled); revalidate queued jobs before resume. Conservative quota budget, no automatic upgrades, no unlimited sends. Test synthetic data with explicit approved recipients and capped actual sends.
- Real private and group test sends, reschedule/cancel/paid suppression, duplicate/restart/permission-revocation tests, quota exhausted/failure visibility, welcome and rich menu verification. Defer nonessential visual polish rather than core reliability.

## Sunday — EP04 and EP05 release gates

EP04: independent review of auth/session/CSRF/IDOR, cross-workspace leakage, admin privilege escalation, signed/replayed webhooks, recurrence/month-end/leap-year/timezone, concurrency, job retries/idempotency, quota, emergency stop, database/worker restart, backup and restore, iOS/Android/desktop, dependency and secret scans. No unresolved P0/P1/P2 release blockers; no known exploitable security findings; full regression and evidence. Stop if mandatory gates fail.

EP05: only after EP04 pass and separate owner deployment authorization. Verify shared Windows server ports and gateway routing; dedicated production pdabliss_flow DB and least-privilege credentials; safe migration/build, restart only FLOW PM2 processes, named Cloudflare tunnel, HTTPS flow.pdabliss.com, permanent LIFF endpoint, signed webhook, rich menu activation, backups/monitoring, rollback and smoke. Enable outbound only after destination/owner/quota controls are verified. Do not affect other services. Production smoke includes real controlled notification and restart recovery; pm2 save only after success.

Monday pilot: limited approved family/staff; begin with synthetic or low-risk appointments and bills, confirm actual sends and privacy; monitor worker, quota and errors, collect feedback. Expand only after observed reliability; do not rely solely on pilot reminders for critical deadlines.

## Carried forward and evidence

- Canonical Sally artwork remains owner-approved; symbol/wordmark review and optional polish remain backlog.
- EP01 observed LINE quota 300 and usage 0 at the time; recheck actual current quota before sends. The reported Feb 2027 Thai Reply API change remains unverified; consult official current LINE docs before relying on it.
- CSS custom properties approved; React Hook Form, TanStack Query and Framer Motion deferred.
- Existing LINE channels must be reused. Condo temporary session stopped per checkpoint; canonical LIFF endpoint restoration and webhook-off still require owner confirmation before integration.
- [Office handover](EP02-OFFICE-HANDOVER.md), [Owner checklist](EP02-OWNER-CHECKLIST.md), [Remediation report](EP02.1-REMEDIATION-REPORT.md).
- Two-day schedule is a target, not a guarantee. If time is insufficient, defer optional polish, extra templates and advanced admin dashboards; do not defer privacy, secure approval, quota, core recurrence integrity, or delivery safeguards for live pilot.

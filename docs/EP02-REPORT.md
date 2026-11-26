# EP02 — Checkpoint report

## Office handover checkpoint

**LOCAL PASS / REAL LINE ACCEPTANCE PARTIAL — OFFICE HANDOVER CHECKPOINT**

The local baseline is 31 passing gates and 300/300 tests, including 36 real MariaDB tests. Chromium captured 175 screen states. The owner then reported successful iPhone LIFF sign-in, owner bootstrap, navigation, private appointment creation and rescheduling, and preview-only calendar and relative reminders. See the [remediation report](EP02.1-REMEDIATION-REPORT.md) and [office handover](EP02-OFFICE-HANDOVER.md).

RD01–RD08 are deferred. Begin office follow-up with the iOS native date/time overlap, then complete the consolidated device regression and the pending real LINE checks. The guarded local shutdown found no recorded session. Canonical LIFF endpoint restoration and webhook-off confirmation remain pending. See the [real-device findings](EP02-REAL-DEVICE-FINDINGS.md).

## Historical continuation record before EP02.1

**Verdict: PARTIAL.** Implementation is complete; mandatory acceptance (real MariaDB, Windows
gates, visual QA, real LINE) has not run yet. Legend: **EXECUTED** = ran in this session,
**VERIFIED** = executed and passed, **OWNER** = owner-confirmed, **PLANNED** = scripted but not
run, **NOT TESTED**, **BLOCKED**.

1. **Executive verdict** — PARTIAL. No critical/high finding is open in code that was
   reviewed; acceptance gates A–G still need the owner's Windows run (EP02-OWNER-CHECKLIST.md).
2. **Recovered WIP baseline** — `origin/main` = `4421d6f` (“wip(ep02): implement MariaDB
   foundation and backend services”), parent `a5a3d32` (EP01). Clean history, no force pushes.
3. **VM-to-host transfer findings** — every backend, schema, migration, script and test file
   from the previous session is in `4421d6f`, byte-identical to the working copy. Missing: the
   whole frontend (13 files, never transferred). Also found: `package-lock.json` not updated for
   the Prisma dependencies; a 2-line placeholder `apps/api/tests/zz-debug.test.ts` committed
   (removed by this patch); `.ep02-work/PLAN.md` is git-ignored (replaced by EP02-PROGRESS.md).
4. **New workstation environment** — BLOCKED for this session: the desktop bridge to the
   condominium PC was offline and offers no shell or file writes, so Windows version, Node, npm,
   MariaDB service and ports could not be inspected. `ep02-verify.ps1` (V01) records them.
5. **MariaDB / Prisma versions** — Prisma 7.9.1 (`prisma`, `@prisma/client`,
   `@prisma/adapter-mariadb`) pinned in `package.json`; MariaDB server version: NOT TESTED
   (recorded by the setup/verify scripts).
6. **Schema and migration** — 19 tables, ER diagram in EP02-DATABASE.md; drift check and
   migration apply on an empty test database: PLANNED (V04).
7. **Existing implementation preserved** — all WIP code kept; changes are additive except the
   items in 8.
8. **Newly completed** — authenticated frontend (all routes), Owner Console UI, invitation
   page, account screens; fail-closed Prisma filter guard; database start-up verification and
   `503 DATABASE_UNAVAILABLE` (no driver text in responses or logs); housekeeping (bounded
   storage); new-workstation owner bootstrap; Windows scripts; EP02 docs; obsolete EP01
   `sessions.ts` / `rate-limit.ts` and the placeholder test removed.
9. **Owner migration** — `import-ep01-owner` (from the office access file) and
   `recent-signins` + `bootstrap-owner` (LINE-verified, refuses if an owner exists).
   Unit-tested via `importOwner`; real run: PLANNED.
10. **Persistent authentication** — EP01 contract preserved; 34 EP01 auth tests migrated 1:1
    (VERIFIED earlier on MemoryStore: 122/122 API); MariaDB run PLANNED (V08).
11. **User management** — in-app request, console approve/reject/assign/suspend/revoke/role,
    last-owner and self-elevation guards: implemented; API scenarios VERIFIED on MemoryStore;
    UI NOT TESTED visually.
12. **Invitations** — hashed single-use tokens, 1/24/72/168 h, revoke, concurrent redemption,
    no global roles, no bypass of suspension: VERIFIED (MemoryStore); MariaDB PLANNED.
13. **Workspaces and privacy** — three independent dimensions, 9-role matrix, cross-workspace
    and private isolation incl. global owner, IDOR-safe 404s, aggregate counts filtered:
    VERIFIED (MemoryStore); MariaDB PLANNED.
14. **Appointment CRUD** — transactional create/update/cancel, idempotency, stale-edit 409,
    history, duplicate: VERIFIED (MemoryStore).
15. **Multi-stage reminders** — 10:00 → 06:00/09:00; 13:00 → 06:00/12:00; all-day, previous
    day, past, duplicates, TZ boundaries, leap day: VERIFIED (shared 64/64 + scenarios).
16. **Flex preview** — deterministic, validated, privacy-safe, never sent: VERIFIED (unit +
    scenario); visual rendering in the app NOT TESTED.
17. **Frontend routes** — /today, /calendar, /appointments/new|:id|:id/edit, /search,
    /history, /groups, /groups/:id, /settings (+/preferences, /privacy), /owner (+requests,
    users, users/:id, invitations, groups, audit), /invite/:token, /privacy, /terms. Route
    table = gateway allow-list (VERIFIED by test). Type-checked against stubs (EXECUTED); real
    `tsc` + Vite build PLANNED (V05, V09).
18. **Test counts** — written: API 130, API-on-MariaDB 33, web 48, shared 64, design system
    14, worker 2 (291 + 33). Executed this session: shared 64/64, web 48/48, API guard tests 7/7
    (fail-closed 3, db-guard 4).
19. **Regression comparison** — EP01 183 all retained (auth migrated by name); previous WIP
    API 123 = 122 tests + 1 placeholder file; +8 new API tests.
20. **MariaDB integration evidence** — none yet (BLOCKED: no access to a MariaDB host).
21. **E2E scenarios** — E01–E13, E15 VERIFIED in-process on MemoryStore (synthetic
    identities); E14 tests written, NOT TESTED; all on MariaDB PLANNED.
22. **Visual QA** — NOT TESTED (needs the built app).
23. **Windows verification** — PLANNED (`ep02-verify.ps1`).
24. **Real LINE acceptance** — PLANNED (needs owner approval for a temporary tunnel).
25. **Security findings** — fixed: (a) Prisma `undefined` filters could widen authorization
    queries → global guard; (b) database errors were logged in full (could include appointment
    titles) → class/code only; (c) API would start against an unreachable/wrong database →
    start-up verification; (d) purge jobs never ran → housekeeping. Open: none known.
26. **Remaining limitations** — no real delivery (EP03); privacy/terms are drafts for owner
    review; archived workspaces cannot be restored in the UI; shared-IP rate limiting behind
    the production proxy must trust only the gateway header (EP05).
27. **Public disclosure review** — `a5a3d32..4421d6f` scanned: only a synthetic test URL
    (`s3cr3t-value`) matched; no real secrets, LINE ids, tunnel URLs or personal data. This
    patch adds none. Full-history scan (V10) PLANNED.
28. **Decisions without explicit guidance** — continuation delivered as a local patch (no
    push of unverified work); owner bootstrap via LINE-verified recent sign-in + masked id;
    4 DB accounts incl. a dedicated shadow account; housekeeping every 15 min, ended sessions
    kept 7 days; privacy/terms drafted; roadmap episode numbering left unchanged (it lists the
    notification engine as EP04 while the continuation spec calls it EP03 — owner to confirm).
29. **Git** — nothing committed or pushed in this session. Commit/push PENDING after
    acceptance (EP02-OWNER-CHECKLIST.md §7).
30. **EP03 readiness** — data contract ready (reminder_rules + destinations + Flex builder);
    EP03 not started.

# EP02 — Office handover

**LOCAL PASS / REAL LINE ACCEPTANCE PARTIAL — OFFICE HANDOVER CHECKPOINT**

_2026-11-26, Asia/Bangkok_

## Scope and verified baseline

This checkpoint carries the existing MariaDB-backed FLOW application, EP02.1 remediation, migrations, tests and lockfile to the office workstation. The Windows verifier exited 0 with 31 passing gates and one intentional install skip. All 300 tests passed, including 36 real MariaDB tests. Full and production npm audits found zero vulnerabilities. Playwright captured 175 synthetic screen states at 320, 375, 390, 430, 768 and 1440 px.

The verified environment used Node 24.15.0, MariaDB 12.3.2, Prisma CLI/client/adapter 7.10.1, the Effect 3.22.1 override and npm 11.21.3 for dependency-tree validation. View the [remediation report](EP02.1-REMEDIATION-REPORT.md).

## Owner-reported iPhone LINE LIFF results

- Real LINE login, secure owner bootstrap and owner role display, and personal workspace initialization.
- Today, Calendar month view, Groups, Settings and the appointment creation interface.
- Appointment creation and save with private visibility and a private chat destination. The creation event appeared in history.
- Bangkok reminder calculation for a 10:00 appointment showed 06:00 and 09:00. After moving it to 13:00, the calendar reminder stayed at 06:00 and the relative reminder moved to 12:00.
- Both calendar and relative Flex previews rendered and showed preview-only status. The owner reported that delivery stayed disabled.

The real-device results are owner-reported. The local Chromium run used synthetic authentication.

## Acceptance still pending

- Session restoration after closing and reopening LIFF, and appointment persistence after logout and re-login.
- Complete appointment history, including creation and rescheduling events.
- Full Owner Console acceptance and mobile approval of a second approved LINE identity.
- Real invitation redemption and replay, and real multi-user privacy across Today, calendar, search and direct detail access.
- Final outbound LINE usage review, final real-device regression and final EP02 acceptance.

## Office workstation preflight

1. In the office checkout, run `git status --short --branch` and `git fetch origin`. Review local work before updating. With a clean `main`, run `git pull --ff-only origin main` and verify the checkpoint commit. If the office branch is ahead or divergent, keep its work for owner review.
2. Check PowerShell, Node, npm and the existing MariaDB service. Match Node 24.15.0 and MariaDB 12.3.2 where practical. The package requires Node 22.12 or later. Verify ports 6767, 6768 and 6769 are available for local FLOW tests.
3. Use the office machine's own FLOW credentials and database accounts. The default external directory is `%USERPROFILE%\.pdabliss\flow`. Keep office `dev.env`, `test.env` and any legacy `access.json` there with restricted access. The condominium database, owner account, secrets, temporary tunnel runtime and QA artifacts stay on the originating workstation.

## Reproducible dependencies

From the office repository root, run the pinned npm version against the checked-in lockfile.

```powershell
npm.cmd exec --yes --package=npm@11.21.3 -- npm ci --no-fund
npm.cmd exec --yes --package=npm@11.21.3 -- npm ls --all
npm.cmd exec --yes --package=npm@11.21.3 -- npm ls effect
npm.cmd exec --yes --package=npm@11.21.3 -- npm audit --audit-level=low
npm.cmd exec --yes --package=npm@11.21.3 -- npm audit --omit=dev --audit-level=low
```

Expect `effect@3.22.1 overridden`. System npm 11.12.1 can print `ELSPROBLEMS` for the existing override. The pinned CLI validates the installed tree.

## Guarded databases and migrations

For existing office development, test and shadow targets, use the guarded checks first.

```powershell
node scripts/db.mjs whoami dev
node scripts/db.mjs whoami test
node scripts/db.mjs validate
node scripts/db.mjs generate
node scripts/db.mjs status dev
node scripts/db.mjs status test
```

Apply pending migrations to the intended local targets only, then check drift and rerun verification.

```powershell
node scripts/db.mjs deploy dev
node scripts/db.mjs deploy test
node scripts/db.mjs drift
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ep02-verify.ps1
```

For missing local databases or accounts, coordinate initial provisioning with the office database owner and use `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ep02-db-setup.ps1` from the repository root. It requires local database administrator access. Preserve configured office accounts, files and settings. Avoid the password rotation option. See the [database guide](EP02-DATABASE.md).

## Office owner and LINE continuation

- Keep the existing active office owner. Use `npm.cmd run admin -- owners` locally and keep its output private.
- If no owner exists and the office machine already has a trusted legacy `access.json`, use `npm.cmd run admin -- import-ep01-owner`. Otherwise, sign in to FLOW from LINE as the verified owner and follow the private `recent-signins` and `bootstrap-owner <uuid> --confirm` procedure in the [owner checklist](EP02-OWNER-CHECKLIST.md).
- Before another public session, obtain explicit approval, confirm the existing FLOW channels and check office tunnel tooling. Use the [owner checklist](EP02-OWNER-CHECKLIST.md) to continue the pending scenarios with synthetic appointments and approved test identities.
- The condominium guarded `-Stop` and `-Status` commands found no recorded FLOW session. Ports 6767–6769 had no listeners, and MariaDB was still running. Evidence of canonical LIFF endpoint restoration to `https://flow.pdabliss.com/` and **Use webhook** off is pending. Confirm both in LINE Developers and review outbound usage.

## Next development task

Start with **RD01**. Reproduce the native date/time field overlap on the checkpoint in a narrow iPhone LINE LIFF viewport. Capture a sanitized example, add a WebKit regression and make the smallest responsive fix. Retest on iPhone, then address RD02–RD06 and RD08 in the consolidated real-device pass before final EP02 acceptance. RD07 remains a proposal for future Notification Engine and Sally Experience work, subject to owner approval. See the [RD01–RD08 backlog](EP02-REAL-DEVICE-FINDINGS.md).

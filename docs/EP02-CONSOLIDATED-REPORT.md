# EP02 — Consolidated implementation report

_2026-11-28, Asia/Bangkok. Condominium workstation DESKTOP-SBHSUSC (Windows 11 Home 26200),
where all remaining development now happens. The former EP02.2 and EP02.3 ran as internal
phases of this single EP02 execution. Scope still ends at EP05. Historical reports keep their
original results._

**Verdict: LOCAL PASS / REAL LINE ACCEPTANCE PARTIAL — EP02 CHECKPOINT**

## A. Executive summary

- **Implemented:**
  - Real-device remediation RD01–RD06 and RD08, with Chromium and WebKit regression coverage.
  - Per-workspace member identity colours.
  - Recurring appointments (daily, weekly, monthly, yearly; month-end and leap-year policies;
    THIS / FUTURE / ALL edit and cancel; bounded rolling horizon).
  - Monthly bills with exact decimal amounts, per-occurrence user-reported paid status and
    reminder suppression.
  - The desktop Platform Administration Center at `/admin`: an interactive dashboard, request
    review, user access control and offboarding, workspaces, permissions, invitations, LINE
    groups, the redacted Activity Center, LINE quota, LINE friends, notifications, health,
    audit and settings.
  - Recent-LINE-login protection for sensitive privileged actions.
  - The EP03 eligibility contract.
- **Preserved:** every EP01/EP02/EP02.1 behaviour and test, the `/owner` console, the design
  identity, the MariaDB guards and the drift guard (extended, not weakened), the Effect 3.22.1
  override and Prisma 7.10.1 alignment. No dependency was added or upgraded.
- **Pending:** owner-dependent real LINE acceptance (see [final acceptance](EP02-FINAL-ACCEPTANCE.md)),
  confirmation of canonical LIFF endpoint restoration with webhook off, and RD07 (EP03).

## B. Phases

| Phase                        | Result               | Evidence                                                                                                                                                                 |
| ---------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A Environment and baseline   | PASS                 | Fast-forward c9aebb4 → 22dc6b7 (docs-only, verified). Baseline verifier: 31 PASS + 1 intentional skip, exit 0, 300/300 tests. One active owner kept, not rebootstrapped. |
| B Real-device remediation    | PASS (local) / OWNER | [Findings](EP02-REAL-DEVICE-FINDINGS.md); browser QA                                                                                                                     |
| C Member personalization     | PASS                 | C1 on both stores; palette contrast tests                                                                                                                                |
| D Recurrence and bills       | PASS                 | [Design](EP02-RECURRENCE-AND-BILLS.md); shared, C2–C6, C12, MariaDB race test                                                                                            |
| E Administration Center      | PASS                 | [Guide](EP02-ADMINISTRATION-GUIDE.md); C7–C11; 16 admin pages in browser QA                                                                                              |
| G Quality gates              | see §G               | `.qa/ep02/summary.txt`                                                                                                                                                   |
| H Real LINE owner acceptance | NOT TESTED           | No public session was started (needs explicit owner approval)                                                                                                            |

## C. Requirements

See [EP02-REQUIREMENTS-TRACEABILITY.md](EP02-REQUIREMENTS-TRACEABILITY.md).

## D. Database

The migration `20261128090000_ep02_series_bills_colors` is additive:

- one new table (`appointment_series`);
- nine `appointments` columns, a unique key on `(seriesId, occurrenceDate)` and a foreign key;
- the `SUPPRESSED` and `PAYMENT_CHANGED` enum values;
- `workspace_members.colorToken`.

Prisma generated it from the shadow replay (`node scripts/db.mjs sql`). It was then hand-reviewed,
and the known replay-only JSON alias statements were removed. It is applied to test and dev.
Dev row counts were identical before and after, with one active owner, and the initial migration
is unchanged. The drift check passes for the shadow replay, dev and test. The guard now lists
four JSON columns, matched exactly. Real MariaDB tests prove the unique occurrence key under
two-pool races and an exact DECIMAL round trip.

## E. Security

- Authentication is unchanged (LINE ID token verified server-side, HttpOnly session, CSRF).
- Status changes, role changes and membership removal need a LINE login within 15 minutes
  (`REAUTH_REQUIRED`). Re-verification is a new LINE exchange, never a password.
- Every `/admin` API is authorized on the server. ADMIN and workspace admins get 404 on
  owner-only areas, and personal workspaces are unreachable from administration.
- **Revocation** ends sessions, removes memberships, global ADMIN and group grants, and disables
  the private chat. **Reactivation** grants only reviewed memberships. **Suspension** disables
  the private chat. Owner protection is kept.
- The Activity Center redacts at the API: no creator, private title, amount, category, recipient
  or raw ID. The audit hides metadata for all `appointment*` resources.
- Member colours accept only palette tokens; arbitrary CSS is rejected.
- Secret scans: see §G.

## F. UI/UX

- RD01–RD06 and RD08 are fixed; RD07 is deferred to EP03.
- WebKit (Playwright build) and Chromium ran at 320, 375, 390, 430, 768 and 1440 px.
- The admin layout is desktop-first with a sidebar, breadcrumbs, tables, filters in the URL,
  pagination, empty, loading and error states, and a tablet/phone top-bar fallback.
- KPI cards are keyboard-tested with back navigation.
- During QA, a tap-miss on Save while an input was focused was caught and fixed. It came from my
  first RD02 approach of moving the bar on blur.

## G. Tests and gates

Final run of `scripts/ep02-verify.ps1` on the final code: **31 PASS, 1 intentional install
skip, 0 FAIL, 0 BLOCKED, exit 0** (`.qa/ep02-consolidated/final-summary.txt`). It covered the
environment, dependency tree (npm 11.21.3, `effect@3.22.1 overridden`), both npm audits (0
vulnerabilities), guarded database identity, Prisma validate/generate/status/deploy(test)/drift,
typecheck, two format passes, lint, both test runs, both builds, three secret scans and local
smoke (self-test, A fail-closed, B test DB, C database down and refused).

| Suite             | EP02.1 baseline |                   EP02 consolidated |
| ----------------- | --------------: | ----------------------------------: |
| Shared            |              65 |                                  83 |
| Design system     |              14 |                                  14 |
| API (MemoryStore) |             132 |                                 144 |
| Worker            |               2 |                                   2 |
| Web               |              48 |                                  54 |
| Drift guard       |               3 |                                   3 |
| MariaDB (real)    |              36 |                                  49 |
| **Combined**      |         **300** | **349 passed, 0 failed, 0 skipped** |

One existing test changed: S2b now asserts that the owner must log in again with LINE (because
the scenario moves the clock hours forward) and then asserts that the suspension succeeds.
Previously the suspend response was not checked. This is equivalent or stronger protection.

**Browser QA** (`.qa/ep02-consolidated/visual-qa.ts`, local only, synthetic data, guarded test
MariaDB, the built gateway and API) ran Chromium 158 (system Chrome) and WebKit (Playwright
build 2388) at 320, 375, 390, 430, 768 and 1440 px. Results: **268 screen states (134 per engine), 0 findings, 0 unexpected HTTP errors, 0 console
or page errors**. The checks covered:

- the RD01, RD02, RD03 (16:20 → 17:00), RD04, RD05, RD06 and RD08 assertions;
- a weekly series created with reminders 06:00 and 09:00, then a scope dialog edit to "entire
  series" at 13:00 giving 06:00 and 12:00;
- the bill paid suppression wording;
- member colour save;
- all 16 admin pages;
- every dashboard card activated by keyboard with back navigation (320 and 1440 px);
- a member denied `/admin`;
- a member's private title absent from the Activity Center. It found
  and fixed three issues during the session:

- a Save tap-miss while an input had focus (RD02 approach);
- admin table and breadcrumb links under 24 px;
- an estimate request outliving the form, which WebKit reported as a cancelled fetch.

WebKit on Windows is the engine, not iOS LINE LIFF; the real iPhone retest remains owner
acceptance.

## H. Real LINE acceptance

The owner-reported results from 26 Nov stand. Nothing new was tested with real LINE in this
session. The checklist and exact guarded commands are in [final acceptance](EP02-FINAL-ACCEPTANCE.md).
External configuration is unchanged: no LINE console edits, no tunnel, no outbound messages.
Canonical LIFF endpoint and webhook-off confirmation remain pending with the owner.

## I. Git

- Start: `main` fast-forwarded from `c9aebb4` to `22dc6b7` (three docs-only roadmap commits,
  verified before syncing).
- Checkpoint: `c81f3e8` "feat(ep02): consolidated application and administration center
  checkpoint" (74 files), pushed normally with no force. Local HEAD equalled `origin/main` after
  the push.
- Pre-commit review: the remote had no new commits. The staged diff contained no environment
  files, build output, `.qa` evidence, generated client, LINE identifiers, tunnel URLs or
  credentials. File, history and value secret scans passed.
- This Git section is recorded in a follow-up docs-only commit.

## J. EP03 handover

See [EP03-HANDOVER.md](EP03-HANDOVER.md).

## Addendum — owner acceptance and closure (28 Nov 2026)

- **Owner-observed PASS:**
  - Desktop Administration Center, including the ADM08 and ADM09 retest; ADM03 is a visual
    pass only.
  - Member colour selection.
  - Test01 one-off appointment with edit and reminders.
  - Test02 weekly series with a single-occurrence exception and a FUTURE edit (scope
    confirmed by the database audit).
  - Test03 monthly bill with December paid and its reminders suppressed.
  - Test04 last-day-of-month bill.
  - Test05 private appointment.
  - History, and RD01, RD03, RD04, RD06 and RD08 (RD02 and RD05 partially).
- **Hotfix `fa98182`:** ADM03, ADM08 and ADM09, with 9 new tests.
- **Current verification:** 31 PASS + 1 skip; 358/358 tests (309 + 49 MariaDB); 0 audit
  findings; secret scans pass.
- **Deferred or unverified:** AUTH01, invitation redemption and replay, multi-user privacy,
  real offboarding, session restoration and re-login, colour persistence seen by another
  member, entire-series edit, recurring cancellation, paid → unpaid correction.
- The temporary session is stopped. LIFF and webhook restoration was later CONFIRMED by the owner (LIFF `https://flow.pdabliss.com/`, webhook OFF, consumption 0/300). Before that, it awaited the owner's
  confirmation. Synthetic-data cleanup needs the owner's approval.

Details are in [final acceptance](EP02-FINAL-ACCEPTANCE.md).

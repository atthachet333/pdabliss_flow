# EP02 — Progress checkpoint

_Updated 2026-11-26 (Asia/Bangkok). **LOCAL PASS / REAL LINE ACCEPTANCE PARTIAL — OFFICE HANDOVER CHECKPOINT**_

## Baseline

- EP01 was accepted at `a5a3d32`. The previous EP02 checkpoint was 4421d6f on main.
- The Windows working tree contained the applied EP02 continuation and dependency update. EP02.1 repaired that working tree in place.
- The first Windows run recorded 19 passing gates, five failures, one intentional install skip, and 289 passing tests out of 291.

## Local acceptance

- Guarded MariaDB migration replay, development and test comparisons, and JSON metadata checks passed. The original migration remains byte-for-byte unchanged.
- The API returns a sanitized `503 DATABASE_UNAVAILABLE` for verified connection failures and restores the existing session after reconnection. MariaDB invitation redemption and access decisions remain atomic under contention.
- The verification script checks both audits, validates the dependency tree with npm 11.21.3, formats twice, runs both test sets and builds, scans for secrets, and checks startup refusal with the actual process exit status.
- The [EP02.1 remediation report](EP02.1-REMEDIATION-REPORT.md) records the final test counts, visual QA, evidence locations and remaining conditions.

## Owner acceptance and office follow-up

The owner manually verified real LINE authentication on iPhone, secure owner bootstrap and role display, Today, Calendar month view, Groups, Settings, personal workspace initialization, private appointment creation with a private chat destination, creation history, rescheduling and both preview-only Flex previews. The Bangkok reminder times matched 06:00 and 09:00 before the move and 06:00 and 12:00 after it. The owner reported that delivery stayed disabled. The Chromium evidence is from separate synthetic tests.

Session restoration, logout and re-login persistence, complete history, full Owner Console, mobile approval of a second LINE identity, invitation redemption and replay, multi-user privacy, outbound usage review, final real-device regression and final EP02 acceptance remain open. The guarded shutdown check found no recorded FLOW session or listener on the FLOW ports, and shared MariaDB stayed running. Confirmation of canonical LIFF endpoint restoration and webhook disabled remains pending.

Continue in the office with RD01 and iOS WebKit coverage. See the [office handover](EP02-OFFICE-HANDOVER.md), [owner checklist](EP02-OWNER-CHECKLIST.md) and [RD01–RD08 backlog](EP02-REAL-DEVICE-FINDINGS.md).

## EP02 consolidated — 28 Nov 2026 (condominium workstation)

The remaining EP02 work, including the former EP02.2 and EP02.3, was implemented and locally
verified as one consolidated execution. See [EP02-CONSOLIDATED-REPORT.md](EP02-CONSOLIDATED-REPORT.md).
Real LINE owner acceptance is still open; see [EP02-FINAL-ACCEPTANCE.md](EP02-FINAL-ACCEPTANCE.md).

## EP02 closure — 28 Nov 2026 (evening)

The owner's desktop and iPhone LINE evidence is consolidated and corroborated by a read-only
dev-database inspection. ADM03, ADM08 and ADM09 were fixed (`fa98182`). The session was stopped,
and the verifier passes on the current code. AUTH01 and the multi-user scenarios are deferred.
LIFF and webhook restoration was then confirmed by the owner (webhook OFF, consumption 0/300). Verdict: **LOCAL PASS / REAL LINE ACCEPTANCE
PARTIAL — EP02 CHECKPOINT**. See [final acceptance](EP02-FINAL-ACCEPTANCE.md) and the
[EP04 polish backlog](EP04-POLISH-BACKLOG.md).

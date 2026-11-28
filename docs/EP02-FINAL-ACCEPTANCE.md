# EP02 — Final acceptance (real LINE, owner-dependent)

_Prepared 2026-11-28, Asia/Bangkok, and updated the same day with owner evidence from the
desktop and iPhone sessions. **No result is recorded as passed without evidence.** All
records are synthetic._

## Status at the EP02 closure (28 Nov 2026, evening)

**Verdict: LOCAL PASS / REAL LINE ACCEPTANCE PARTIAL — EP02 CHECKPOINT.**

Legend:

- **OWNER PASS:** observed by the owner on a real iPhone in LINE, or on a desktop through the
  guarded temporary HTTPS session.
- **DB-CONFIRMED:** a read-only guarded inspection of `pdabliss_flow_dev` agrees with the
  owner's observation.
- **LOCAL:** automated evidence only.

Real-device and automated evidence are reported separately.

| Item                                                                              | Real LINE / owner                                                                    | Local automated / database                                                                                                                                   |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| LINE login, owner bootstrap, Today/Calendar/Groups/Settings                       | OWNER PASS (26 and 28 Nov)                                                           | —                                                                                                                                                            |
| Desktop Administration Center (14 pages, 13 KPI cards, back navigation)           | OWNER PASS (8/10 at first review, then ADM08 and ADM09 retested PASS)                | C8; browser QA 0 findings                                                                                                                                    |
| ADM08 quota refresh                                                               | OWNER PASS: success message, seconds, 0/300, remaining 300                           | 6 web + 3 API tests                                                                                                                                          |
| ADM09 health refresh                                                              | OWNER PASS: success message, MariaDB 1 ms, worker and outbound disabled              | Same                                                                                                                                                         |
| ADM03 header and heading layout                                                   | VISUAL PASS on reviewed screenshots; scroll-and-navigate path **not** owner-verified | Browser checks: 0 findings in two engines                                                                                                                    |
| Shared workspace creation; invitation creation and sharing                        | OWNER PASS                                                                           | DB: 1 FAMILY workspace; 1 invitation (expired 07:44, unused)                                                                                                 |
| Member colour select, save, immediate render                                      | OWNER PASS (indigo → jade)                                                           | DB-CONFIRMED: `colorToken = jade` stored server-side                                                                                                         |
| Member colour after a fresh session; seen by another member; on shared cards      | NOT VERIFIED (single account)                                                        | C1 (persistence across restart, other-member view, card mark)                                                                                                |
| Test01 one-off appointment, edit 10:00 → 13:00, history, reminders                | OWNER PASS                                                                           | DB-CONFIRMED: 29 Nov 06:00, 30 Nov 06:00, 10:00, 12:00; events CREATED, RESCHEDULED                                                                          |
| Test02 weekly recurrence; calendar and history                                    | OWNER PASS                                                                           | DB-CONFIRMED: 53 occurrences, no duplicates                                                                                                                  |
| Test02 edit "this occurrence only" (7 Dec → 14:00)                                | OWNER PASS                                                                           | DB-CONFIRMED: exception flag, audit `appointment.updated`                                                                                                    |
| Test02 edit of 14 Dec → 11:00                                                     | Observed propagation                                                                 | DB-CONFIRMED scope **FUTURE**: audit `series.updated {kind: FUTURE, count: 51}`; old series ended 13 Dec; new series from 14 Dec; 51 × 11:00; exception kept |
| Recurrence "entire series" edit; any recurring cancellation                       | NOT VERIFIED by owner                                                                | C3, C4 (both stores)                                                                                                                                         |
| Test03 monthly bill 599.50, December paid only, reminders suppressed              | OWNER PASS                                                                           | DB-CONFIRMED: 24 occurrences, exactly `599.50`, December PAID with 2 SUPPRESSED rules, later months SCHEDULED                                                |
| Bill paid → unpaid correction                                                     | NOT VERIFIED by owner                                                                | C5                                                                                                                                                           |
| Test04 last-day-of-month bill 1,250.75                                            | OWNER PASS (31 Dec, 31 Jan)                                                          | DB-CONFIRMED: 28 Feb 2027, 31 Mar, 30 Apr, **29 Feb 2028**; 23 occurrences, no duplicates. Real-device view of February not done                             |
| Test05 private appointment                                                        | OWNER PASS (single account)                                                          | —                                                                                                                                                            |
| Cross-account privacy; Activity Center redaction for another user's private items | NOT VERIFIED (needs a second identity)                                               | C6, C7 on real MariaDB: no unauthorized title, amount, notes, creator or raw IDs; direct API 404                                                             |
| Appointment history (upcoming, past, cancelled empty state, badges)               | OWNER PASS                                                                           | —                                                                                                                                                            |
| Actual cancellation and its history entry                                         | NOT VERIFIED by owner                                                                | C4                                                                                                                                                           |
| Close/reopen LIFF; logout and re-login persistence                                | NOT VERIFIED                                                                         | S9 restart persistence                                                                                                                                       |
| Second identity (AUTH01); invitation redemption and replay; real offboarding      | **DEFERRED / NOT VERIFIED** (owner decision)                                         | S1, S2, S2b, C10, C11                                                                                                                                        |
| Mobile Owner Console (full)                                                       | Entry observed only                                                                  | Existing tests                                                                                                                                               |
| Canonical LIFF endpoint restored and **Use webhook** OFF after this session       | **PENDING owner confirmation**                                                       | Session stopped and verified (see below)                                                                                                                     |

### RD statuses from the owner's iPhone review

- RD01: visual PASS.
- RD02: save observed; keyboard and full accessibility not yet accepted.
- RD03: PASS.
- RD04: PASS.
- RD05: PASS for the action buttons; minor top-content overlap goes to the EP04 polish backlog.
- RD06: PASS.
- RD07: EP03.
- RD08: visual PASS.

## Owner desktop review and findings register (28 Nov 2026)

Owner-reported on the temporary integration session (checkpoint `7dc5012`):

- All 14 reviewed admin pages render.
- All 13 dashboard KPI cards are clickable, and back navigation works.
- Owner account details work, and owner self-revocation protection works.
- Activity Center filters work.
- Shared workspace creation works.
- Invitation creation and sharing work.

Desktop functional acceptance: **8/10 PASS**.

| ID                        | Finding                                      | Root cause (investigated)                                                                                                                                                                                                                                                                                                                                                                                          | Disposition                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADM08                     | Quota "อ่านใหม่" gave no observable response   | The click did reach the server: the live API log shows 12 × `GET /admin/quota`, all 200 in 160–330 ms (real LINE reads; the server does not cache). The page used `useLoad.reload()`, which kept the old data on screen with no loading indicator, no result message and no single-flight guard (a second click sent a second LINE read). Timestamps had minute precision, so an unchanged quota looked identical. | **Fixed.** A single-flight `RefreshController` provides: a loading line "กำลังอ่านข้อมูลโควตาจาก LINE..."; a disabled, busy button; success "อัปเดตข้อมูลโควตาเรียบร้อยแล้ว" only after a successful LINE read; failure "ไม่สามารถอ่านข้อมูลล่าสุดได้ กรุณาลองใหม่อีกครั้ง" that keeps the previous values, labelled stale; last success advancing only on success; second-precision timestamps. **Owner retest pending.** |
| ADM09                     | Health "ตรวจใหม่" gave no observable response | Same UI cause. The server re-checks the database on every request (4 × `GET /admin/health`, all 200).                                                                                                                                                                                                                                                                                                              | **Fixed** with the same controller: "กำลังตรวจสอบสถานะระบบ...", then "ตรวจสอบสถานะระบบเรียบร้อยแล้ว" only when the check completed and the database is OK. A degraded database shows a caution, never success. A failed check shows "ไม่สามารถตรวจสอบสถานะระบบได้", keeps the previous result and marks it stale. The worker stays "ยังไม่เปิดใช้งาน — ไม่ได้ทำงาน". **Owner retest pending.**                   |
| ADM03                     | Sticky header may hide page headings         | Confirmed in Chromium and WebKit at 1280×720. (1) No scroll reset between admin routes: from a scrolled page, an immediately rendered page (Permissions) opened mid-page with its heading off-screen. (2) `main.focus()` and the skip link aligned the content to the viewport top, under the 49 px sticky header. The logo, independent sidebar scrolling and footer access measured correct.                     | **Fixed.** Scroll to top on every admin route change; focus with `preventScroll`; `scroll-padding-top` / `scroll-margin-top` for the header. The title is now below the header after scroll + navigation, back navigation, static pages and the skip link, in both engines. **Owner retest pending.**                                                                                                |
| AUTH01                    | Second LINE identity authentication          | Not investigated (owner instruction).                                                                                                                                                                                                                                                                                                                                                                              | **DEFERRED / NOT VERIFIED.** No LINE Login publishing, role, credential or invitation-auth changes.                                                                                                                                                                                                                                                                                                  |
| ADM01, ADM02, ADM04–ADM07 | Owner polish items                           | —                                                                                                                                                                                                                                                                                                                                                                                                                  | Moved to the EP04 consolidated polish backlog (owner decision).                                                                                                                                                                                                                                                                                                                                      |

Hotfix evidence:

- Browser checks `.qa/ep02-consolidated/admin-hotfix-qa.ts` (local, synthetic data, a fake LINE
  reader for quota): **before** 18 findings; **after 0 findings** in Chromium and WebKit
  (`.qa/ep02-consolidated/hotfix/`).
- New unit tests: web `admin-refresh.test.ts` (6) and API `admin-quota-health.test.ts` (3).
- Full verifier: 31 PASS, 1 intentional skip, exit 0. Tests 309/309 plus 49/49 real MariaDB.
  npm audits 0. Secret scans pass.

## Before any public session (explicit owner approval required)

1. Confirm there is no running FLOW session:
   `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ep01-integration.ps1 -Status`.
2. Confirm ports 6767–6769 are free. Shared MariaDB stays running.
3. In LINE Developers, confirm the **existing** FLOW Login/LIFF and Messaging channels. Record the
   canonical endpoint `https://flow.pdabliss.com/`. Confirm **Use webhook** is off. Do not
   regenerate credentials. Outbound messaging stays disabled.
4. Only after you approve public exposure, run:

```powershell
npm.cmd run build
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ep01-integration.ps1 -Start -IApprovePublicExposure
```

5. Set the LIFF Endpoint URL to the printed temporary HTTPS URL. Leave webhook and rich menu alone.

## Scenarios (synthetic data)

1. **iPhone LIFF regression.** Open Create.
   - RD01: date and time fields fully visible and editable at your width.
   - RD02: scroll to the end; destinations and the last section are above the Save bar, and Save works while the keyboard is open.
   - RD03: late in the day the default start is the next hour, not a past time.
   - RD04: greeting shows "คุณ ชื่อ" with a space.
   - RD06/RD08: reminders read "คำนวณเวลาแล้ว · ยังไม่ส่งจริง" with Thai dates.
   - RD05: save, then the toast appears at the top and Edit/Duplicate/Cancel stay tappable.
2. **Recurring.** Create a weekly 10:00 item with "1 day before 06:00", "same day 06:00" and
   "1 hour before". Expect 06:00 (previous day), 06:00 and 09:00. Edit one occurrence to
   15:00 with "เฉพาะครั้งนี้". Edit another to 13:00 with "ทุกครั้งในรายการนี้": the moved one
   stays at 15:00 and the others show 06:00, 06:00 and 12:00.
3. **Monthly bill.** Create "ค่าไฟ (ทดสอบ)" monthly on the 25th with amount 1,250.50. Mark this
   month paid: its reminders show "ชำระแล้ว · ไม่แจ้งเตือน" and next month stays unpaid. Change
   next month's amount only.
4. **Member colour.** In a shared group, pick a colour, close and reopen LIFF, and confirm it
   persists. A second identity sees it next to your name only on appointments it can already see.
5. **Session.** Close and reopen LIFF (restored, no login). Log out, log in, and confirm the data
   persists. Check that history shows creation, reschedule and payment events.
6. **Second identity** (owner-approved test account only). It requests access. Approve it in
   `/owner` or `/admin/requests` after reviewing the masked LINE ID and roles. It redeems an
   invitation; replay is refused.
7. **Privacy.** The second identity cannot see your private items in Today, Calendar, Search or
   by pasting a detail URL. In `/admin/activity` its private items appear redacted.
8. **Desktop admin.** On a PC or iPad browser, open `<temporary URL>/admin`, log in with LINE,
   and confirm you return to `/admin`. Click every dashboard card and use back/forward. After 15
   minutes, suspend the test account: the "ยืนยันตัวตนกับ LINE" prompt appears, then the action
   completes.
9. **Offboarding.** On the test account: remove from the company group (A), suspend and
   reinstate (B), revoke (C), then reactivate with an explicit review. The test device must lose
   access immediately after B and C. Remove it from any LINE group separately in LINE.
10. **Quota.** `/admin/quota` shows live used / quota from LINE (read-only) or an honest
    unavailable state.

## After acceptance

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ep01-integration.ps1 -Stop
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ep01-integration.ps1 -Status
```

Restore the LIFF Endpoint URL to `https://flow.pdabliss.com/`. Confirm **Use webhook** is off.
Review outbound usage, which should show zero sends from FLOW. Do not stop shared MariaDB.
Record the observed results, with dates and sanitized screenshots, in this file before declaring
EP02 complete.

## Closure evidence (28 Nov 2026)

**Database corroboration.** Script `.qa/ep02-closure/inspect-dev.mjs` (Git-ignored) ran
read-only `SELECT`s on the guarded `pdabliss_flow_dev`. It printed only synthetic titles and no
IDs or LINE identifiers. Findings:

- 103 appointments, all synthetic EP02 tests; no other records.
- 1 active owner; 1 private-chat destination.
- 0 duplicate `(series, occurrenceDate)` pairs.

**Verification of the current repository** (`fa98182`, after the session was stopped):

- `ep02-verify.ps1`: 31 PASS, 1 intentional skip, exit 0.
- 309/309 automated tests plus 49/49 real MariaDB tests (C1–C12 included).
- npm audits 0. Secret scans pass.

**Temporary session shutdown.** `ep01-integration.ps1 -Stop` stopped only the recorded
gateway, tunnel and API.

- `-Status`: no session recorded.
- Ports 6767–6769 free; no `cloudflared` process.
- The old tunnel URL returns 502 at Cloudflare's edge.
- MariaDB is still running on 3306. No other service was touched.

**LINE configuration restoration** is PENDING the owner's confirmation. Required: LIFF
Endpoint URL = `https://flow.pdabliss.com/`, Messaging API **Use webhook = OFF**, and an
outbound usage review (expected: zero FLOW sends).

## Synthetic test data — safety and cleanup plan (owner approval required)

The dev database holds 204 future `SCHEDULED` reminder rules on synthetic records. All of
them target the owner's own private LINE chat:

| Item   | Future reminders | Last fire time |
| ------ | ---------------: | -------------- |
| Test02 |              106 | 29 Nov 2027    |
| Test03 |               46 | November 2028  |
| Test04 |               46 | October 2028   |
| Test01 |                4 | 30 Nov 2026    |
| Test05 |                2 | 30 Nov 2026    |

EP02 cannot send anything. The risk starts only if an EP03 worker runs against this dev database.

1. **Quarantine without deletion.** Before any EP03 dev worker run, the owner cancels the
   synthetic series in the app with "ยกเลิก → ทุกครั้งในรายการนี้":
   Test02 (both series), Test03 and Test04. Test01 and Test05 become past and
   ineligible (stale) after 30 Nov. Cancelled rows and their history stay, and nothing is
   hard-deleted by an admin. The owner can also approve a guarded, audited cleanup instead.
   No deletion happens without explicit approval.
2. **EP03 launch gate** (see [EP03 handover](EP03-HANDOVER.md)): the worker starts with
   delivery disabled, an explicit recipient allow-list and the `reminderEligibility` stale
   rule. A first enabled run must list, as a dry run, every job it would send.
3. **Production isolation.** Production (`pdabliss_flow`) is created empty in EP05. Dev
   records are never copied.
4. The expired, unused synthetic invitation and the `กลุ่มงานทดสอบ` workspace can stay. They
   grant nothing and send nothing.

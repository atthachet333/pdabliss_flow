# EP02 — Final acceptance (real LINE, owner-dependent)

_Prepared 2026-11-28, Asia/Bangkok. Updated the same day with the owner's desktop review
(below). Each item needs the
owner's own iPhone or desktop and owner-approved LINE test identities. **No result may be
recorded as passed without evidence.** Use synthetic appointments and bills only._

## Status at the EP02 consolidated checkpoint

| Item                                                                                      | Status                                                                      |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| LINE login, owner bootstrap, Today/Calendar/Groups/Settings, create, reschedule, previews | PASS — owner-reported, 26 Nov (unchanged)                                   |
| Close/reopen LIFF, session restoration                                                    | NOT TESTED                                                                  |
| Logout and re-login persistence                                                           | NOT TESTED                                                                  |
| Complete appointment history (create + reschedule events)                                 | NOT TESTED                                                                  |
| Full mobile Owner Console                                                                 | NOT TESTED                                                                  |
| Desktop Administration Center review (owner, 28 Nov)                                      | PARTIAL — 8/10 owner-reported PASS; ADM08/ADM09 fixed, owner retest pending |
| External-browser LINE login returning to `/admin` (scenario J)                            | NOT SEPARATELY REPORTED                                                     |
| Shared workspace creation; invitation creation and sharing                                | PASS — owner-reported, 28 Nov                                               |
| Second identity: access request → owner approval (AUTH01)                                 | DEFERRED / NOT VERIFIED (owner decision)                                    |
| Invitation redemption and replay refusal                                                  | NOT TESTED (needs a second identity)                                        |
| Real multi-user privacy (Today, Calendar, Search, direct URL)                             | NOT TESTED                                                                  |
| Member colour selection                                                                   | NOT TESTED                                                                  |
| Recurring appointment creation and scoped edit                                            | NOT TESTED                                                                  |
| Recurring monthly bill, mark one occurrence paid                                          | NOT TESTED                                                                  |
| Offboarding behaviour (remove / suspend / revoke / reactivate)                            | NOT TESTED                                                                  |
| iPhone LIFF regression of RD01–RD06/RD08                                                  | NOT TESTED                                                                  |
| Canonical LIFF endpoint restored, **Use webhook** off, outbound usage review              | PENDING owner confirmation                                                  |

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

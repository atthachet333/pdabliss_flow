# EP02 — Final acceptance (real LINE, owner-dependent)

_Prepared 2026-11-28, Asia/Bangkok. Nothing in this file has been run yet. Each item needs the
owner's own iPhone or desktop and owner-approved LINE test identities. **No result may be
recorded as passed without evidence.** Use synthetic appointments and bills only._

## Status at the EP02 consolidated checkpoint

| Item                                                                                      | Status                                    |
| ----------------------------------------------------------------------------------------- | ----------------------------------------- |
| LINE login, owner bootstrap, Today/Calendar/Groups/Settings, create, reschedule, previews | PASS — owner-reported, 26 Nov (unchanged) |
| Close/reopen LIFF, session restoration                                                    | NOT TESTED                                |
| Logout and re-login persistence                                                           | NOT TESTED                                |
| Complete appointment history (create + reschedule events)                                 | NOT TESTED                                |
| Full mobile Owner Console                                                                 | NOT TESTED                                |
| Desktop Administration Center via external-browser LINE login                             | NOT TESTED                                |
| Second identity: access request → owner approval                                          | NOT TESTED                                |
| Invitation redemption and replay refusal                                                  | NOT TESTED                                |
| Real multi-user privacy (Today, Calendar, Search, direct URL)                             | NOT TESTED                                |
| Member colour selection                                                                   | NOT TESTED                                |
| Recurring appointment creation and scoped edit                                            | NOT TESTED                                |
| Recurring monthly bill, mark one occurrence paid                                          | NOT TESTED                                |
| Offboarding behaviour (remove / suspend / revoke / reactivate)                            | NOT TESTED                                |
| iPhone LIFF regression of RD01–RD06/RD08                                                  | NOT TESTED                                |
| Canonical LIFF endpoint restored, **Use webhook** off, outbound usage review              | PENDING owner confirmation                |

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

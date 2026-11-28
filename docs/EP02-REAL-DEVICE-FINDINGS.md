# EP02 — Real-device findings

_2026-11-26, Asia/Bangkok. Source is the owner's iPhone test through LINE LIFF._

The checkpoint freezes the current design and defers these findings to the office follow-up.

| ID   | Priority | Owner observation                                                                              | Disposition                                                                                   |
| ---- | -------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| RD01 | P1       | Native iOS date and time inputs overlap and overflow horizontally.                             | Reproduce and fix before EP02 closure.                                                        |
| RD02 | P2       | The sticky save button can overlap form content.                                               | Inspect safe-area insets and scroll padding before closure.                                   |
| RD03 | P2       | A new appointment's default time can already be in the past late in the day.                   | Reproduce with a late Bangkok clock and cover the default in regression before closure.       |
| RD04 | P3       | The Thai greeting prefix touches the LINE display name without visible spacing.                | Check Thai names, emoji and long names before closure.                                        |
| RD05 | P2       | The success toast overlaps appointment detail action buttons.                                  | Verify toast placement and access to detail actions before closure.                           |
| RD06 | P3       | Reminder wording can imply that messages are scheduled for delivery.                           | Verify it describes calculated times and preview-only behavior before closure.                |
| RD07 | P2       | Calendar morning and relative reminder Flex previews are too similar visually.                 | Proposal for future Notification Engine and Sally Experience work, subject to owner approval. |
| RD08 | P3       | The preview timestamp uses ISO formatting while the rest of the app uses Thai date formatting. | Verify the preview uses the intended Thai date format before closure.                         |

## Office regression plan

1. Reproduce RD01 on iPhone in the LINE WebView. Capture the viewport, iOS and LINE versions, and sanitized evidence.
2. Add iOS WebKit coverage at narrow widths for date/time fields, keyboard visibility, safe-area padding, sticky save and toast placement. Retest in real LINE LIFF on iPhone.
3. Check late-day defaults in Asia/Bangkok, Thai greeting spacing, reminder wording and Thai preview timestamps with synthetic inputs.
4. Rerun the full Windows verifier, browser checks and remaining LINE scenarios. Record the new evidence with the [office handover](EP02-OFFICE-HANDOVER.md).

## EP02 consolidated dispositions (2026-11-28)

| ID   | Fix                                                                                                                                                                                                                                                                                                                             | Automated evidence                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| RD01 | Root cause: grid items kept `min-width: auto`, and WebKit's native date and time controls have a wide intrinsic width. Now the date takes its own row, the times share equal `minmax(0,1fr)` tracks, every cell and control has `min-width: 0`, and WebKit date/time styling is normalized. There is no global overflow hiding. | Chromium and WebKit 320–1440: fields never overlap or exceed the viewport (visual QA)   |
| RD02 | `scroll-padding-bottom` and `scroll-margin-bottom` keep focused controls above the sticky bar, with a higher z-index and padding. The bar never moves on focus changes: QA showed that moving it on blur made a Save tap miss while the keyboard was open.                                                                      | The last section ends above the sticky bar at every width                               |
| RD03 | Shared `defaultAppointmentStart`: the next full hour at least 30 minutes ahead; from 23:30 the default becomes 09:00 the next day; calendar-chosen dates use 09:00. A past start shows a warning, and its reminders stay PAST.                                                                                                  | Unit tests (16:20 → 17:00, 23:40 → next day) and a browser check at a fixed 16:20 clock |
| RD04 | `สวัสดีค่ะ` and `คุณ {name}` are separate wrapping spans with a real space.                                                                                                                                                                                                                                                         | Browser check with a long Thai and emoji name                                           |
| RD05 | Toasts moved under the app bar, with no pointer events and the live region kept.                                                                                                                                                                                                                                                | The toast box never intersects the detail action buttons                                |
| RD06 | Status text: "calculated · not sent yet", "past · will not be sent", "paid · no reminder". Today and detail notices say no LINE message is sent.                                                                                                                                                                                | Browser text checks                                                                     |
| RD07 | Deferred to EP03 (Flex visual differentiation).                                                                                                                                                                                                                                                                                 | —                                                                                       |
| RD08 | `formatThaiDateTime` (Buddhist Era, Bangkok) for preview, reminders, history and admin. API values stay ISO UTC.                                                                                                                                                                                                                | Unit tests, including year rollover; no ISO date in the reminder list                   |

Real iPhone LINE LIFF retest of RD01–RD08 remains owner acceptance; see [final acceptance](EP02-FINAL-ACCEPTANCE.md).

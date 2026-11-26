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

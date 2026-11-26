# Notification template catalogue (EP00)

Source of truth: `packages/shared/src/flex-preview.ts` → `buildFlexPreview()` produces a
presentation model; the LIFF preview renders it today and the EP04 Flex builder will turn the
same model into LINE Flex JSON, so the preview matches what is sent.

| #   | Template id     | Theme               | Header              | Primary action | Secondary action   | Notes                                    |
| --- | --------------- | ------------------- | ------------------- | -------------- | ------------------ | ---------------------------------------- |
| 1   | `family`        | family (rose)       | นัดหมายครอบครัว       | ดูรายละเอียด     | รับทราบแล้ว          |                                          |
| 2   | `business`      | business (navy)     | นัดหมายงานบริษัท       | ดูรายละเอียด     | รับทราบแล้ว          | “อีก 15 นาทีจะเริ่มแล้วค่ะ…”                   |
| 3   | `personal`      | personal (violet)   | นัดหมายส่วนตัว         | ดูรายละเอียด     | รับทราบแล้ว          |                                          |
| 4   | `health`        | health (teal)       | นัดหมายสุขภาพ         | ดูรายละเอียด     | รับทราบแล้ว          | Minimal-disclosure recommended in groups |
| 5   | `special`       | special (champagne) | โอกาสพิเศษ           | ดูรายละเอียด     | รับทราบแล้ว          | All-day shows “ทั้งวัน”                     |
| 6   | `urgent`        | urgent (red)        | แจ้งเตือนด่วน          | ดูรายละเอียด     | รับทราบแล้ว          | Restrained emphasis; icon + label        |
| 7   | `changed`       | category            | นัดหมายมีการเปลี่ยนแปลง | ดูรายละเอียด     | รับทราบการเปลี่ยนแปลง | Shows previous time struck through       |
| 8   | `cancelled`     | neutral             | ยกเลิกนัดหมายแล้ว      | ดูรายละเอียด     | —                  | No timing pill                           |
| 9   | `daily-summary` | brand               | สรุปนัดหมายวันนี้        | เปิดปฏิทิน        | —                  | Signature footer                         |
| 10  | `saved`         | brand               | บันทึกนัดหมายแล้ว       | ดูรายละเอียด     | —                  | Sent only after a real save (EP03+)      |

Every template defines: id, category/theme, header, title, date & time, timing context,
location (optional), destination text, optional description, actions, plain-text **alt text**
(≤ 400 chars, our own cap) and an optional “Designed & Engineered by PDA BLISS” footer.

**Minimal-disclosure mode** (group destinations only): title becomes “นัดหมายสำคัญ”, location
and description are removed, the header becomes the neutral “แจ้งเตือนนัดหมาย” with the brand
theme (category colour hidden), and the **alt text** — which appears in LINE’s notification
preview — contains only date and time.

Constraints respected: no HTML/CSS/JS/SVG inside Flex, no live countdowns, no animation,
no controls that cannot work in LINE. Buttons in previews are inert.

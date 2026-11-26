// Original FLOW / Sally artwork.
// - Vector brand marks, Sally's 6 expressions and the rich menu: scripts/generate-brand-assets.mjs
// - Owner-approved canonical Sally (raster): assets/mascot/reference/sally-reference-owner.png,
//   with web derivatives in assets/mascot/web/ (see assets/README.md).
import flowLockup from '../../../../assets/brand/flow-lockup.svg';
import flowSymbol from '../../../../assets/brand/flow-symbol.svg';
import flowWordmarkIvory from '../../../../assets/brand/flow-wordmark-ivory.svg';
import flowWordmark from '../../../../assets/brand/flow-wordmark.svg';
import sallyDefault from '../../../../assets/mascot/sally-default.svg';
import sallyEmpty from '../../../../assets/mascot/sally-empty.svg';
import sallyError from '../../../../assets/mascot/sally-error.svg';
import sallyHappy from '../../../../assets/mascot/sally-happy.svg';
import sallyReminder from '../../../../assets/mascot/sally-reminder.svg';
import sallyThoughtful from '../../../../assets/mascot/sally-thoughtful.svg';
import sallyAvatar128 from '../../../../assets/mascot/web/sally-avatar-128.webp';
import sallyAvatar256 from '../../../../assets/mascot/web/sally-avatar-256.webp';
import sallyPortrait360 from '../../../../assets/mascot/web/sally-portrait-360.webp';
import sallyPortrait720 from '../../../../assets/mascot/web/sally-portrait-720.webp';
import richMenuConcept from '../../../../assets/rich-menu/rich-menu-concept.svg';

export const brandArt = {
  flowLockup,
  flowSymbol,
  flowWordmark,
  flowWordmarkIvory,
  richMenuConcept,
};

export type SallyExpression = 'default' | 'happy' | 'reminder' | 'thoughtful' | 'empty' | 'error';

export const sallyArt: Record<SallyExpression, string> = {
  default: sallyDefault,
  happy: sallyHappy,
  reminder: sallyReminder,
  thoughtful: sallyThoughtful,
  empty: sallyEmpty,
  error: sallyError,
};

/** Raster renditions of the owner-approved reference (identity-critical surfaces). */
export const sallyRaster = {
  avatar128: sallyAvatar128,
  avatar256: sallyAvatar256,
  portrait360: sallyPortrait360,
  portrait720: sallyPortrait720,
};

export const SALLY_EXPRESSION_META: Record<SallyExpression, { th: string; use: string }> = {
  default: { th: 'ต้อนรับ', use: 'หน้าแรก, ข้อความต้อนรับ' },
  happy: { th: 'ยืนยันสำเร็จ', use: 'หลังบันทึกจริงสำเร็จเท่านั้น' },
  reminder: { th: 'แจ้งเตือน', use: 'การ์ดแจ้งเตือน, สรุปประจำวัน' },
  thoughtful: { th: 'กำลังคิด', use: 'กำลังโหลด, กำลังตรวจสอบ' },
  empty: { th: 'ไม่มีนัดหมาย', use: 'วันว่าง, รายการว่าง' },
  error: { th: 'ขัดข้อง', use: 'ข้อผิดพลาด, ไม่สามารถดำเนินการได้' },
};

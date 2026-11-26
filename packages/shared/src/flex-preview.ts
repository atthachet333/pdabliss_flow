/**
 * Notification presentation model (pure).
 *
 * One model drives both the in-app LIFF preview (EP00/EP02) and, from EP04, the
 * LINE Flex Message JSON builder — so what the user previews is what gets sent.
 * The model contains only text and semantic tokens: no HTML, no scripts, nothing
 * LINE Flex Messages cannot render. Decorative art is optional and never carries
 * information.
 */
import type { CategoryId, DestinationKind } from './domain.js';
import {
  describeOffsetThai,
  describeTimeUntilThai,
  formatThaiLocalDate,
  formatThaiTime,
} from './time.js';

export const FLEX_TEMPLATE_IDS = [
  'family',
  'business',
  'personal',
  'health',
  'special',
  'urgent',
  'changed',
  'cancelled',
  'daily-summary',
  'saved',
] as const;
export type FlexTemplateId = (typeof FLEX_TEMPLATE_IDS)[number];

export type FlexTheme = CategoryId | 'brand' | 'neutral';

/** Our own cap, deliberately conservative versus the provider's limit. */
export const ALT_TEXT_MAX = 400;

export interface FlexAction {
  label: string;
  /** uri → opens LIFF detail (auth-checked); postback → signed server action (EP05). */
  kind: 'uri' | 'postback';
}

export interface FlexSummaryItem {
  timeText: string;
  title: string;
  category: CategoryId;
}

export interface FlexPreviewModel {
  templateId: FlexTemplateId;
  theme: FlexTheme;
  headerLabel: string;
  headerIcon:
    | 'family'
    | 'business'
    | 'personal'
    | 'health'
    | 'special'
    | 'urgent'
    | 'changed'
    | 'cancelled'
    | 'summary'
    | 'saved';
  sallyLine: string;
  title: string;
  dateText: string;
  timeText: string;
  timingContext?: string;
  previousWhenText?: string;
  location?: string;
  description?: string;
  destinationText?: string;
  summaryItems?: FlexSummaryItem[];
  primaryAction: FlexAction;
  secondaryAction?: FlexAction;
  altText: string;
  showSignature: boolean;
  minimalDisclosure: boolean;
}

export interface FlexPreviewInput {
  templateId: FlexTemplateId;
  category: CategoryId;
  title: string;
  /** Local calendar date "YYYY-MM-DD". */
  localDate: string;
  allDay: boolean;
  /** Start instant (ignored for all-day display). */
  start: Date;
  timeZone: string;
  location?: string;
  description?: string;
  destination?: { displayName: string; kind: DestinationKind };
  /** For reminder templates: the offset this reminder represents. */
  reminderOffsetMinutes?: number;
  /** For "changed": previous date/time text. */
  previous?: { localDate: string; start: Date; allDay: boolean };
  summaryItems?: FlexSummaryItem[];
  minimalDisclosure?: boolean;
  now: Date;
}

const HEADER: Record<FlexTemplateId, { label: string; icon: FlexPreviewModel['headerIcon'] }> = {
  family: { label: 'นัดหมายครอบครัว', icon: 'family' },
  business: { label: 'นัดหมายงานบริษัท', icon: 'business' },
  personal: { label: 'นัดหมายส่วนตัว', icon: 'personal' },
  health: { label: 'นัดหมายสุขภาพ', icon: 'health' },
  special: { label: 'โอกาสพิเศษ', icon: 'special' },
  urgent: { label: 'แจ้งเตือนด่วน', icon: 'urgent' },
  changed: { label: 'นัดหมายมีการเปลี่ยนแปลง', icon: 'changed' },
  cancelled: { label: 'ยกเลิกนัดหมายแล้ว', icon: 'cancelled' },
  'daily-summary': { label: 'สรุปนัดหมายวันนี้', icon: 'summary' },
  saved: { label: 'บันทึกนัดหมายแล้ว', icon: 'saved' },
};

function themeFor(templateId: FlexTemplateId, category: CategoryId): FlexTheme {
  switch (templateId) {
    case 'cancelled':
      return 'neutral';
    case 'daily-summary':
    case 'saved':
      return 'brand';
    case 'changed':
      return category;
    default:
      return templateId;
  }
}

function whenText(localDate: string, start: Date, allDay: boolean, timeZone: string) {
  const date = formatThaiLocalDate(localDate);
  return { dateText: date.short, timeText: allDay ? 'ทั้งวัน' : formatThaiTime(start, timeZone) };
}

function destinationText(d: FlexPreviewInput['destination']): string | undefined {
  if (!d) return undefined;
  if (d.kind === 'private-self') return 'แจ้งเฉพาะคุณ (แชทส่วนตัวกับ Sally)';
  if (d.kind === 'individual') return `แจ้งส่วนตัวถึง ${d.displayName}`;
  return `แจ้งในกลุ่ม ${d.displayName}`;
}

function clampAlt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= ALT_TEXT_MAX ? flat : `${flat.slice(0, ALT_TEXT_MAX - 1)}…`;
}

export function buildFlexPreview(input: FlexPreviewInput): FlexPreviewModel {
  const header = HEADER[input.templateId];
  const minimal = Boolean(input.minimalDisclosure);
  const { dateText, timeText } = whenText(
    input.localDate,
    input.start,
    input.allDay,
    input.timeZone,
  );
  const timing =
    input.reminderOffsetMinutes !== undefined
      ? input.reminderOffsetMinutes === 0
        ? 'ถึงเวลานัดหมายแล้ว'
        : describeTimeUntilThai(
            input.start,
            new Date(input.start.getTime() - input.reminderOffsetMinutes * 60_000),
          )
      : input.allDay
        ? undefined
        : describeTimeUntilThai(input.start, input.now);

  const title = minimal ? 'นัดหมายสำคัญ' : input.title.trim();

  let sallyLine: string;
  switch (input.templateId) {
    case 'saved':
      sallyLine = 'Sally บันทึกนัดหมายให้เรียบร้อยแล้วค่ะ';
      break;
    case 'changed':
      sallyLine = 'นัดหมายนี้มีการเปลี่ยนเวลา โปรดตรวจสอบอีกครั้งนะคะ';
      break;
    case 'cancelled':
      sallyLine = 'นัดหมายนี้ถูกยกเลิกแล้วค่ะ';
      break;
    case 'daily-summary':
      sallyLine =
        input.summaryItems && input.summaryItems.length > 0
          ? `วันนี้มีนัดหมาย ${input.summaryItems.length} รายการค่ะ`
          : 'วันนี้ยังไม่มีนัดหมายค่ะ ใช้เวลากับสิ่งที่สำคัญได้เต็มที่เลยนะคะ';
      break;
    case 'business':
      sallyLine =
        input.reminderOffsetMinutes && input.reminderOffsetMinutes > 0
          ? `${describeOffsetThai(input.reminderOffsetMinutes).replace('ก่อน', 'อีก')}จะเริ่มแล้วค่ะ กรุณาเตรียมตัวให้พร้อมนะคะ`
          : 'ได้เวลาเริ่มแล้วค่ะ กรุณาเตรียมตัวให้พร้อมนะคะ';
      break;
    case 'family':
      sallyLine = 'อย่าลืมนัดสำคัญของครอบครัวนะคะ';
      break;
    case 'special':
      sallyLine = 'วันพิเศษใกล้มาถึงแล้วค่ะ';
      break;
    case 'urgent':
      sallyLine = 'เรื่องนี้ต้องดูแลโดยเร็วค่ะ';
      break;
    default:
      sallyLine =
        input.reminderOffsetMinutes && input.reminderOffsetMinutes > 0
          ? `${describeOffsetThai(input.reminderOffsetMinutes).replace('ก่อน', 'อีก')}จะถึงเวลานัดหมายแล้วนะคะ`
          : 'ถึงเวลานัดหมายแล้วค่ะ';
  }
  if (minimal) sallyLine = `คุณมีนัดหมายสำคัญเวลา ${timeText}`;

  const isReminder = ['family', 'business', 'personal', 'health', 'special', 'urgent'].includes(
    input.templateId,
  );
  const primaryAction: FlexAction = {
    label: minimal
      ? 'ดูรายละเอียด (เฉพาะผู้มีสิทธิ์)'
      : input.templateId === 'daily-summary'
        ? 'เปิดปฏิทิน'
        : 'ดูรายละเอียด',
    kind: 'uri',
  };
  const secondaryAction: FlexAction | undefined = isReminder
    ? { label: 'รับทราบแล้ว', kind: 'postback' }
    : input.templateId === 'changed'
      ? { label: 'รับทราบการเปลี่ยนแปลง', kind: 'postback' }
      : undefined;

  const previousWhenText =
    input.templateId === 'changed' && input.previous
      ? (() => {
          const p = whenText(
            input.previous.localDate,
            input.previous.start,
            input.previous.allDay,
            input.timeZone,
          );
          return `${p.dateText} · ${p.timeText}`;
        })()
      : undefined;

  const altParts = minimal
    ? [`[FLOW] คุณมีนัดหมายสำคัญ ${dateText} เวลา ${timeText}`]
    : input.templateId === 'daily-summary'
      ? [
          `[FLOW] ${header.label} ${dateText}`,
          ...(input.summaryItems ?? []).map((i) => `${i.timeText} ${i.title}`),
        ]
      : [`[FLOW] ${header.label}: ${title}`, `${dateText} ${timeText}`, timing ?? ''];

  return {
    templateId: input.templateId,
    // Minimal disclosure also hides the category colour, which could hint at the subject.
    theme: minimal && isReminder ? 'brand' : themeFor(input.templateId, input.category),
    headerLabel: minimal && isReminder ? 'แจ้งเตือนนัดหมาย' : header.label,
    headerIcon: minimal && isReminder ? 'personal' : header.icon,
    sallyLine,
    title: input.templateId === 'daily-summary' ? dateText : title,
    dateText,
    timeText,
    ...(timing && input.templateId !== 'cancelled' ? { timingContext: timing } : {}),
    ...(previousWhenText ? { previousWhenText } : {}),
    ...(!minimal && input.location ? { location: input.location.trim() } : {}),
    ...(!minimal && input.description ? { description: input.description.trim() } : {}),
    ...(input.destination ? { destinationText: destinationText(input.destination) } : {}),
    ...(input.summaryItems ? { summaryItems: minimal ? [] : input.summaryItems } : {}),
    primaryAction,
    ...(secondaryAction ? { secondaryAction } : {}),
    altText: clampAlt(altParts.filter(Boolean).join(' · ')),
    showSignature: input.templateId === 'saved' || input.templateId === 'daily-summary',
    minimalDisclosure: minimal,
  };
}

export function templateForCategory(category: CategoryId): FlexTemplateId {
  return category;
}

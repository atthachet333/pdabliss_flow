/**
 * Flex Message payloads for reminder previews (EP02) — the same deterministic template
 * service EP03 will use for delivery. EP02 only previews: nothing here sends anything.
 *
 *  buildReminderPreview  appointment + one reminder rule → FlexPreviewModel (EP00 model)
 *  toFlexMessage         FlexPreviewModel → LINE Flex Message JSON (bubble)
 *  validateFlexMessage   structural checks against the supported template contract
 *
 * Privacy: notes are NEVER included in a notification; `minimalDisclosure` (content policy
 * PRIVACY_SAFE) also removes title, location and category colour.
 */
import type { CategoryId, DestinationKind } from './domain.js';
import { ALT_TEXT_MAX, buildFlexPreview, type FlexPreviewModel } from './flex-preview.js';
import { formatThaiTime } from './time.js';

export const FLEX_CONTRACT_VERSION = 1;

export interface ReminderPreviewInput {
  title: string;
  category: CategoryId;
  allDay: boolean;
  localDate: string;
  start: Date;
  timeZone: string;
  location?: string | null;
  reminder: { kind: 'RELATIVE' | 'CALENDAR'; offsetMinutes?: number | null; fireAt: Date };
  destination?: { displayName: string; kind: DestinationKind };
  minimalDisclosure: boolean;
  now: Date;
}

export function buildReminderPreview(input: ReminderPreviewInput): FlexPreviewModel {
  const relativeMinutes =
    input.reminder.kind === 'RELATIVE'
      ? (input.reminder.offsetMinutes ?? 0)
      : Math.max(0, Math.round((input.start.getTime() - input.reminder.fireAt.getTime()) / 60_000));
  const model = buildFlexPreview({
    templateId: input.category,
    category: input.category,
    title: input.title,
    localDate: input.localDate,
    allDay: input.allDay,
    start: input.start,
    timeZone: input.timeZone,
    ...(input.location ? { location: input.location } : {}),
    ...(input.destination ? { destination: input.destination } : {}),
    reminderOffsetMinutes: relativeMinutes,
    minimalDisclosure: input.minimalDisclosure,
    now: input.now,
  });
  if (input.reminder.kind === 'CALENDAR' && !input.minimalDisclosure) {
    const hour = Number(formatThaiTime(input.reminder.fireAt, input.timeZone).slice(0, 2));
    const greeting = hour < 12 ? 'อรุณสวัสดิ์ค่ะ' : 'สวัสดีค่ะ';
    const when = input.allDay ? 'ทั้งวัน' : `เวลา ${model.timeText}`;
    return {
      ...model,
      sallyLine: `${greeting} วันนี้มีนัดหมาย${when}นะคะ`,
      timingContext: input.allDay ? 'วันนี้' : `วันนี้ ${model.timeText}`,
    };
  }
  return model;
}

// ───────────────────────── LINE Flex Message JSON ─────────────────────────

type FlexText = { type: 'text'; text: string; size?: string; weight?: string; color?: string; wrap?: boolean };
type FlexBox = { type: 'box'; layout: 'vertical' | 'horizontal' | 'baseline'; contents: FlexNode[]; spacing?: string; paddingAll?: string; backgroundColor?: string };
type FlexButton = { type: 'button'; style: 'primary' | 'secondary' | 'link'; height?: string; color?: string; action: { type: 'uri'; label: string; uri: string } | { type: 'postback'; label: string; data: string } };
type FlexNode = FlexText | FlexBox | FlexButton | { type: 'separator' };

export interface FlexMessage {
  type: 'flex';
  altText: string;
  contents: { type: 'bubble'; size: 'mega'; header: FlexBox; body: FlexBox; footer: FlexBox };
}

const THEME_COLORS: Record<string, string> = {
  brand: '#0B211C',
  neutral: '#5B6560',
  family: '#16836B',
  business: '#1F4E79',
  personal: '#7A4E9C',
  health: '#C0392B',
  special: '#B7791F',
  urgent: '#B3261E',
};

const text = (t: string, extra: Partial<FlexText> = {}): FlexText => ({ type: 'text', text: t, wrap: true, ...extra });

/**
 * `detailUri` must be an https LIFF deep link (validated). Postback data are opaque
 * placeholders in EP02 (signed tokens arrive with EP03/EP05).
 */
export function toFlexMessage(m: FlexPreviewModel, detailUri: string): FlexMessage {
  const color = THEME_COLORS[m.theme] ?? THEME_COLORS.brand;
  const bodyRows: FlexNode[] = [
    text(m.sallyLine, { size: 'sm', color: '#5B6560' }),
    text(m.title, { size: 'lg', weight: 'bold', color: '#0B211C' }),
    text(`${m.dateText} · ${m.timeText}`, { size: 'sm', color: '#0B211C' }),
  ];
  if (m.timingContext) bodyRows.push(text(m.timingContext, { size: 'xs', color: '#16836B' }));
  if (m.location) bodyRows.push(text(`สถานที่: ${m.location}`, { size: 'xs', color: '#5B6560' }));
  if (m.destinationText) bodyRows.push(text(m.destinationText, { size: 'xxs', color: '#8A938E' }));
  const buttons: FlexNode[] = [
    { type: 'button', style: 'primary', height: 'sm', color, action: { type: 'uri', label: m.primaryAction.label.slice(0, 40), uri: detailUri } },
  ];
  if (m.secondaryAction)
    buttons.push({ type: 'button', style: 'secondary', height: 'sm', action: { type: 'postback', label: m.secondaryAction.label.slice(0, 40), data: 'ack:preview' } });
  return {
    type: 'flex',
    altText: m.altText.slice(0, ALT_TEXT_MAX),
    contents: {
      type: 'bubble',
      size: 'mega',
      header: { type: 'box', layout: 'vertical', backgroundColor: color, paddingAll: '12px', contents: [text(m.headerLabel, { size: 'sm', weight: 'bold', color: '#FFFFFF' })] },
      body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: bodyRows },
      footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: buttons },
    },
  };
}

/** Returns a list of contract violations (empty = valid). */
export function validateFlexMessage(msg: unknown): string[] {
  const issues: string[] = [];
  const m = msg as Partial<FlexMessage> | null;
  if (!m || m.type !== 'flex') issues.push('type must be "flex"');
  if (!m || typeof m.altText !== 'string' || !m.altText.trim()) issues.push('altText required');
  else if (m.altText.length > ALT_TEXT_MAX) issues.push('altText too long');
  const c = m?.contents;
  if (!c || c.type !== 'bubble') issues.push('contents must be a bubble');
  const walk = (n: unknown, path: string, depth: number) => {
    if (depth > 6) return issues.push(`${path}: nested too deeply`);
    const node = n as { type?: string; text?: unknown; contents?: unknown[]; action?: { type?: string; uri?: string; label?: string } };
    if (!node || typeof node.type !== 'string') return issues.push(`${path}: missing type`);
    if (node.type === 'text' && (typeof node.text !== 'string' || !node.text.trim()))
      issues.push(`${path}: empty text`);
    if (node.type === 'box') {
      if (!Array.isArray(node.contents) || node.contents.length === 0) issues.push(`${path}: empty box`);
      else node.contents.forEach((x, i) => walk(x, `${path}.${i}`, depth + 1));
    }
    if (node.type === 'button') {
      const a = node.action;
      if (!a || !a.label || a.label.length > 40) issues.push(`${path}: bad action label`);
      if (a?.type === 'uri' && !/^https:\/\//.test(a.uri ?? '')) issues.push(`${path}: uri must be https`);
    }
    if (!['text', 'box', 'button', 'separator'].includes(node.type)) issues.push(`${path}: unsupported ${node.type}`);
    return undefined;
  };
  if (c && c.type === 'bubble') {
    walk(c.header, 'header', 0);
    walk(c.body, 'body', 0);
    walk(c.footer, 'footer', 0);
  }
  if (JSON.stringify(msg ?? null).length > 10_000) issues.push('payload too large');
  return issues;
}

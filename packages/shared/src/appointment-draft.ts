/**
 * Validation schema for an appointment draft as entered in the creation form.
 * EP00 uses it only for the local prototype; EP03 reuses it on the API boundary.
 */
import { z } from 'zod';
import { CATEGORY_IDS } from './domain.js';
import { isValidOffset, MAX_REMINDERS } from './reminders.js';
import { isValidLocalDate, isValidLocalTime } from './time.js';

export const TITLE_MAX_LENGTH = 120;
export const LOCATION_MAX_LENGTH = 160;
export const DESCRIPTION_MAX_LENGTH = 1000;

export const appointmentDraftSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'กรุณาระบุชื่อนัดหมาย')
      .max(TITLE_MAX_LENGTH, `ชื่อนัดหมายยาวได้ไม่เกิน ${TITLE_MAX_LENGTH} ตัวอักษร`),
    category: z.enum(CATEGORY_IDS),
    localDate: z.string().refine(isValidLocalDate, 'วันที่ไม่ถูกต้อง'),
    localTime: z.string().refine(isValidLocalTime, 'เวลาไม่ถูกต้อง'),
    allDay: z.boolean(),
    timeZone: z.string().min(1),
    location: z.string().trim().max(LOCATION_MAX_LENGTH).optional(),
    description: z.string().trim().max(DESCRIPTION_MAX_LENGTH).optional(),
    destinationIds: z.array(z.string().min(1)).min(1, 'กรุณาเลือกปลายทางการแจ้งเตือน'),
    reminderOffsets: z
      .array(z.number().refine(isValidOffset, 'เวลาแจ้งเตือนไม่ถูกต้อง'))
      .max(MAX_REMINDERS, `ตั้งการแจ้งเตือนได้ไม่เกิน ${MAX_REMINDERS} ครั้ง`),
    minimalDisclosure: z.boolean(),
  })
  .refine((d) => new Set(d.destinationIds).size === d.destinationIds.length, {
    message: 'มีปลายทางซ้ำกัน',
    path: ['destinationIds'],
  });

export type AppointmentDraft = z.infer<typeof appointmentDraftSchema>;

export interface DraftIssue {
  path: string;
  message: string;
}

export function validateDraft(
  input: unknown,
): { ok: true; value: AppointmentDraft } | { ok: false; issues: DraftIssue[] } {
  const result = appointmentDraftSchema.safeParse(input);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  };
}

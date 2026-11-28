/**
 * EP02 API contract v1 — request schemas (validated by the API) and response DTOs
 * (consumed by the web app). DTOs never contain LINE ids, token hashes or raw Prisma rows.
 * Endpoint reference: docs/EP02-API.md.
 */
import { z } from 'zod';
import { CATEGORY_IDS, type CategoryId } from './domain.js';
import type { MemberColorId } from './member-colors.js';
import { amountSchema, BILL_CURRENCIES, type BillCurrency, type PaymentStatus } from './money.js';
import { recurrenceSchema, type RecurrenceRule, type SeriesScope } from './recurrence.js';
import { MAX_REMINDER_RULES, type ReminderRuleStatus } from './reminder-rules.js';
import { isValidLocalDate, isValidLocalTime } from './time.js';

export const APPOINTMENT_TITLE_MAX = 120;
export const APPOINTMENT_LOCATION_MAX = 160;
export const APPOINTMENT_NOTES_MAX = 1000;
export const MAX_SHARED_USERS = 50;
export const MAX_APPOINTMENT_DESTINATIONS = 10;
export const MAX_ALL_DAY_SPAN_DAYS = 31;

const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const localDate = z.string().refine(isValidLocalDate, 'invalid date');
const localTime = z.string().refine(isValidLocalTime, 'invalid time');
const optionalText = (max: number) =>
  z
    .string()
    .max(max * 2)
    // eslint-disable-next-line no-control-regex -- Preserve tabs and line breaks in multiline text.
    .transform((s) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim())
    .refine((s) => [...s].length <= max, 'too long')
    .nullable()
    .optional()
    .transform((s) => (s ? s : null));

export const reminderRuleSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('RELATIVE'),
    offsetMinutes: z.number().int().min(0).max(43_200),
    enabled: z.boolean().default(true),
  }),
  z.object({
    kind: z.literal('CALENDAR'),
    dayOffset: z.number().int().min(-7).max(0),
    localTime,
    enabled: z.boolean().default(true),
  }),
]);
export type ReminderRuleDto = z.infer<typeof reminderRuleSchema>;

export const appointmentDestinationSchema = z.object({
  destinationId: uuid,
  contentPolicy: z.enum(['FULL', 'PRIVACY_SAFE']).default('PRIVACY_SAFE'),
});

export const appointmentInputSchema = z
  .object({
    workspaceId: uuid,
    title: z
      .string()
      .max(APPOINTMENT_TITLE_MAX * 2)
      // eslint-disable-next-line no-control-regex -- Strip C0 and DEL from single-line titles.
      .transform((s) => s.replace(/[\u0000-\u001f\u007f]/g, '').trim())
      .refine((s) => s.length > 0, 'required')
      .refine((s) => [...s].length <= APPOINTMENT_TITLE_MAX, 'too long'),
    category: z.enum(CATEGORY_IDS),
    allDay: z.boolean(),
    date: localDate,
    endDate: localDate.nullable().optional(),
    startTime: localTime.nullable().optional(),
    endTime: localTime.nullable().optional(),
    timeZone: z.string().min(1).max(40).default('Asia/Bangkok'),
    location: optionalText(APPOINTMENT_LOCATION_MAX),
    notes: optionalText(APPOINTMENT_NOTES_MAX),
    visibility: z.enum(['PRIVATE', 'WORKSPACE', 'SELECTED']).default('PRIVATE'),
    sharedWithUserIds: z.array(uuid).max(MAX_SHARED_USERS).default([]),
    destinations: z
      .array(appointmentDestinationSchema)
      .max(MAX_APPOINTMENT_DESTINATIONS)
      .default([]),
    confirmSensitive: z.boolean().default(false),
    reminders: z.array(reminderRuleSchema).max(MAX_REMINDER_RULES).default([]),
    /** EVENT (default) or BILL (a user-reported, optionally recurring payment due date). */
    kind: z.enum(['EVENT', 'BILL']).default('EVENT'),
    bill: z
      .object({
        amount: amountSchema.nullable().default(null),
        currency: z.enum(BILL_CURRENCIES).default('THB'),
      })
      .strict()
      .nullable()
      .optional(),
    /** Create a recurring series (create, or a FUTURE/ALL edit). Absent/null = once. */
    recurrence: recurrenceSchema.nullable().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.kind !== 'BILL' && v.bill)
      ctx.addIssue({ code: 'custom', path: ['bill'], message: 'only for BILL' });
    if (!v.allDay && !v.startTime)
      ctx.addIssue({ code: 'custom', path: ['startTime'], message: 'required' });
    const ids = v.destinations.map((d) => d.destinationId);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: 'custom', path: ['destinations'], message: 'duplicate' });
    if (new Set(v.sharedWithUserIds).size !== v.sharedWithUserIds.length)
      ctx.addIssue({ code: 'custom', path: ['sharedWithUserIds'], message: 'duplicate' });
    if (v.visibility !== 'SELECTED' && v.sharedWithUserIds.length)
      ctx.addIssue({
        code: 'custom',
        path: ['sharedWithUserIds'],
        message: 'only for SELECTED visibility',
      });
  });
export type AppointmentInput = z.infer<typeof appointmentInputSchema>;
export type AppointmentInputDraft = z.input<typeof appointmentInputSchema>;

export const seriesScopeSchema = z.enum(['THIS', 'FUTURE', 'ALL']);

export const appointmentUpdateSchema = z.object({
  version: z.number().int().min(1),
  appointment: z.unknown(),
  /** Recurring items only; one-off appointments ignore it. Default THIS. */
  scope: seriesScopeSchema.optional(),
});

export const paymentUpdateSchema = z
  .object({ version: z.number().int().min(1), status: z.enum(['UNPAID', 'PAID']) })
  .strict();

export const memberColorUpdateSchema = z.object({ color: z.string().max(16).nullable() }).strict();

// ───────────────────────── response DTOs ─────────────────────────

export type UserStatusDto = 'NEW' | 'PENDING' | 'ACTIVE' | 'REJECTED' | 'SUSPENDED' | 'REVOKED';
export type GlobalRoleDto = 'OWNER' | 'ADMIN' | 'USER';
export type WorkspaceRoleDto = 'ADMIN' | 'MEMBER' | 'VIEWER';
export type WorkspaceKindDto = 'PERSONAL' | 'FAMILY' | 'COMPANY' | 'CUSTOM';

export interface WorkspaceSummaryDto {
  id: string;
  name: string;
  kind: WorkspaceKindDto;
  role: WorkspaceRoleDto;
  version: number;
}

export interface MeDto {
  user: { id: string; displayName: string; status: UserStatusDto; globalRole: GlobalRoleDto };
  workspaces: WorkspaceSummaryDto[];
  permissions: {
    ownerConsole: boolean;
    manageRoles: boolean;
    manageDestinations: boolean;
    /** Owner-only operational areas of /admin (activity, quota, friends, health). */
    platformOperations: boolean;
  };
  adminBadge: { pendingRequests: number; pendingGroups: number } | null;
  preferences: PreferencesDto;
  access: { requestStatus: 'none' | 'pending' | 'rejected'; invitedWorkspaceName: string | null };
}

export interface PreferencesDto {
  defaultWorkspaceId: string | null;
  defaultReminders: ReminderRuleDto[];
  defaultVisibility: 'PRIVATE' | 'WORKSPACE' | 'SELECTED';
  defaultContentPolicy: 'FULL' | 'PRIVACY_SAFE';
}

export interface ReminderDto {
  index: number;
  kind: 'RELATIVE' | 'CALENDAR';
  offsetMinutes: number | null;
  dayOffset: number | null;
  localTime: string | null;
  enabled: boolean;
  status: ReminderRuleStatus;
  fireAt: string | null;
  labelTh: string;
}

export interface BillDto {
  amount: string | null;
  currency: BillCurrency;
  paymentStatus: PaymentStatus;
  /** User-reported only — never bank-verified. */
  paidAt: string | null;
}

export interface SeriesRefDto {
  id: string;
  frequency: RecurrenceRule['frequency'];
  occurrenceDate: string;
  isException: boolean;
}

export interface AppointmentSummaryDto {
  id: string;
  workspaceId: string;
  workspaceName: string;
  workspaceKind: WorkspaceKindDto;
  title: string;
  category: CategoryId;
  allDay: boolean;
  startDate: string;
  endDate: string;
  startAt: string | null;
  endAt: string | null;
  timeZone: string;
  location: string | null;
  visibility: 'PRIVATE' | 'WORKSPACE' | 'SELECTED';
  status: 'SCHEDULED' | 'CANCELLED';
  mine: boolean;
  scheduledReminders: number;
  kind: 'EVENT' | 'BILL';
  bill: BillDto | null;
  series: SeriesRefDto | null;
  /** Shared workspaces only: who created it, with their identity colour in this workspace. */
  creator: { displayName: string; color: MemberColorId } | null;
}

export interface AppointmentDetailDto extends AppointmentSummaryDto {
  notes: string | null;
  version: number;
  createdBy: { id: string; displayName: string };
  sharedWith: { id: string; displayName: string }[];
  destinations: {
    id: string;
    label: string;
    kind: 'PRIVATE_USER' | 'GROUP';
    contentPolicy: 'FULL' | 'PRIVACY_SAFE';
  }[];
  reminders: ReminderDto[];
  canEdit: boolean;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  recurrence: {
    rule: RecurrenceRule;
    startDate: string;
    status: 'ACTIVE' | 'ENDED' | 'CANCELLED';
    descriptionTh: string;
    generatedThrough: string | null;
  } | null;
  paidBy: string | null;
}

export type { SeriesScope };

export interface DestinationOptionDto {
  id: string;
  kind: 'PRIVATE_USER' | 'GROUP';
  label: string;
  status: 'PENDING' | 'ACTIVE' | 'DISABLED' | 'REMOVED';
  workspaceId: string | null;
  audienceSize: number | null;
  mine: boolean;
}

export interface PageDto<T> {
  items: T[];
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface ApiErrorDto {
  error: { code: string; message: string; requestId: string; details?: Record<string, unknown> };
}

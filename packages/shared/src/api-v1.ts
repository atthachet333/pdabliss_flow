/**
 * EP02 API contract v1 — request schemas (validated by the API) and response DTOs
 * (consumed by the web app). DTOs never contain LINE ids, token hashes or raw Prisma rows.
 * Endpoint reference: docs/EP02-API.md.
 */
import { z } from 'zod';
import { CATEGORY_IDS, type CategoryId } from './domain.js';
import { MAX_REMINDER_RULES } from './reminder-rules.js';
import { isValidLocalDate, isValidLocalTime } from './time.js';

export const APPOINTMENT_TITLE_MAX = 120;
export const APPOINTMENT_LOCATION_MAX = 160;
export const APPOINTMENT_NOTES_MAX = 1000;
export const MAX_SHARED_USERS = 50;
export const MAX_APPOINTMENT_DESTINATIONS = 10;
export const MAX_ALL_DAY_SPAN_DAYS = 31;

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const localDate = z.string().refine(isValidLocalDate, 'invalid date');
const localTime = z.string().refine(isValidLocalTime, 'invalid time');
const optionalText = (max: number) =>
  z
    .string()
    .max(max * 2)
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
    destinations: z.array(appointmentDestinationSchema).max(MAX_APPOINTMENT_DESTINATIONS).default([]),
    confirmSensitive: z.boolean().default(false),
    reminders: z.array(reminderRuleSchema).max(MAX_REMINDER_RULES).default([]),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!v.allDay && !v.startTime) ctx.addIssue({ code: 'custom', path: ['startTime'], message: 'required' });
    const ids = v.destinations.map((d) => d.destinationId);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['destinations'], message: 'duplicate' });
    if (new Set(v.sharedWithUserIds).size !== v.sharedWithUserIds.length)
      ctx.addIssue({ code: 'custom', path: ['sharedWithUserIds'], message: 'duplicate' });
    if (v.visibility !== 'SELECTED' && v.sharedWithUserIds.length)
      ctx.addIssue({ code: 'custom', path: ['sharedWithUserIds'], message: 'only for SELECTED visibility' });
  });
export type AppointmentInput = z.infer<typeof appointmentInputSchema>;
export type AppointmentInputDraft = z.input<typeof appointmentInputSchema>;

export const appointmentUpdateSchema = z.object({
  version: z.number().int().min(1),
  appointment: z.unknown(),
});

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
  permissions: { ownerConsole: boolean; manageRoles: boolean; manageDestinations: boolean };
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
  status: 'SCHEDULED' | 'PAST' | 'DISABLED' | 'DUPLICATE' | 'CANCELLED';
  fireAt: string | null;
  labelTh: string;
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
}

export interface AppointmentDetailDto extends AppointmentSummaryDto {
  notes: string | null;
  version: number;
  createdBy: { id: string; displayName: string };
  sharedWith: { id: string; displayName: string }[];
  destinations: { id: string; label: string; kind: 'PRIVATE_USER' | 'GROUP'; contentPolicy: 'FULL' | 'PRIVACY_SAFE' }[];
  reminders: ReminderDto[];
  canEdit: boolean;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
}

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

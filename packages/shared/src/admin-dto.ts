/**
 * Platform Administration Center contracts (EP02 consolidated, /admin).
 *
 * Truthfulness rules shared by API and UI:
 *  - `status: 'measured'` values come from FLOW's own database or a live LINE read.
 *  - `unavailable` = the source exists but could not be read now (never shown as zero).
 *  - `not-enabled` = the capability arrives in a later episode (EP03); the UI explains it.
 *  - Zero is a valid measured value, never a placeholder.
 *  - No DTO here carries appointment titles, notes, locations, bill amounts, raw LINE ids or
 *    creator identities except where explicitly stated (Activity titles with content access).
 */
import type { ReminderRuleStatus } from './reminder-rules.js';

export type MetricStatus = 'measured' | 'unavailable' | 'not-enabled';

export interface MetricDto {
  status: MetricStatus;
  value: number | null;
  /** Secondary measured value (e.g. quota limit) when relevant. */
  total?: number | null;
  /** Authorized detail route this card opens (filters included). */
  to: string;
  noteTh?: string;
}

export const ADMIN_METRIC_KEYS = [
  'usersTotal',
  'requestsPending',
  'usersActive',
  'usersRestricted',
  'workspaces',
  'groupsPending',
  'groupsRegistered',
  'remindersCalculated',
  'notificationFailures',
  'quota',
  'friends',
  'health',
  'audit24h',
] as const;
export type AdminMetricKey = (typeof ADMIN_METRIC_KEYS)[number];

export interface AdminOverviewDto {
  generatedAt: string;
  ownerOnly: boolean;
  metrics: Partial<Record<AdminMetricKey, MetricDto>>;
}

export interface QuotaDto {
  status: 'available' | 'stale' | 'not-configured' | 'unavailable';
  type: 'limited' | 'unlimited' | null;
  limit: number | null;
  used: number | null;
  remaining: number | null;
  percent: number | null;
  /** Reporting month (Asia/Bangkok, YYYY-MM) of the values shown. */
  month: string | null;
  lastSuccessAt: string | null;
  checkedAt: string;
  errorKind: string | null;
  /** FLOW-side reservations and delivery log are EP03 capabilities. */
  reservations: { status: 'not-enabled' };
  flowLog: { status: 'not-enabled' };
}

export interface FriendRowDto {
  userId: string;
  displayName: string;
  maskedLineId: string;
  /** When FLOW first saw this verified LINE identity (sign-in), not a friendship date. */
  firstObservedAt: string;
  /** Last server-side LINE login verification, not a friendship check. */
  lastVerifiedAt: string;
  friendship: 'friend' | 'blocked' | 'unknown';
  flowStatus: 'NEW' | 'PENDING' | 'ACTIVE' | 'REJECTED' | 'SUSPENDED' | 'REVOKED';
}

export interface FriendsDto {
  aggregate: { status: MetricStatus; followers: number | null; noteTh: string };
  registry: { status: MetricStatus; coverageTh: string };
  accounts: { registered: number; approved: number; pending: number };
  items: FriendRowDto[];
  hasMore: boolean;
  limit: number;
  offset: number;
}

export interface ActivityItemDto {
  /** ISO instant; for redacted rows truncated to the hour (`precision: 'hour'`). */
  fireAt: string;
  precision: 'minute' | 'hour';
  reminderKind: 'CALENDAR' | 'RELATIVE';
  status: ReminderRuleStatus;
  workspace: {
    id: string | null;
    name: string;
    kind: 'PERSONAL' | 'FAMILY' | 'COMPANY' | 'CUSTOM';
  };
  destinations: { kind: 'PRIVATE_USER' | 'GROUP'; label: string | null }[];
  /** null when redacted (the pattern could reveal private content). */
  recurring: boolean | null;
  itemKind: 'EVENT' | 'BILL' | null;
  /** Only when the viewer already has content access to the appointment. */
  title: string | null;
  redacted: boolean;
  /** Actual LINE delivery is an EP03 capability. */
  delivery: 'not-enabled';
}

export interface ActivityDto {
  from: string;
  to: string;
  items: ActivityItemDto[];
  totals: Partial<Record<ReminderRuleStatus, number>>;
  hasMore: boolean;
  limit: number;
  offset: number;
}

export interface HealthDto {
  checkedAt: string;
  api: { status: 'ok'; version: string; uptimeSeconds: number };
  database: { status: 'ok' | 'unavailable'; latencyMs: number | null };
  line: {
    login: 'configured' | 'not-configured';
    messagingRead: 'configured' | 'not-configured';
    webhook: 'configured' | 'not-configured';
    outbound: 'disabled';
  };
  worker: 'not-enabled';
  notificationEngine: 'not-enabled';
}

export interface NotificationOverviewDto {
  engine: 'not-enabled';
  controls: { pause: 'not-enabled'; resume: 'not-enabled'; emergencyStop: 'not-enabled' };
  calculated: Partial<Record<ReminderRuleStatus, number>>;
  next7Days: number;
}

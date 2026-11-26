/**
 * Core domain vocabulary for PDA BLISS FLOW.
 *
 * These are contracts shared by web, api and worker. Persistence (Prisma) arrives
 * in EP03; see docs/SYSTEM-ARCHITECTURE.md for the full proposed domain model.
 */

export const DEFAULT_TIMEZONE = 'Asia/Bangkok';

export const CATEGORY_IDS = [
  'family',
  'business',
  'personal',
  'health',
  'special',
  'urgent',
] as const;
export type CategoryId = (typeof CATEGORY_IDS)[number];

export interface CategoryDefinition {
  id: CategoryId;
  labelTh: string;
  labelEn: string;
  /** Categories whose details should default to minimal disclosure in group chats. */
  sensitive: boolean;
}

export const CATEGORIES: Readonly<Record<CategoryId, CategoryDefinition>> = {
  family: { id: 'family', labelTh: 'ครอบครัว', labelEn: 'Family', sensitive: true },
  business: { id: 'business', labelTh: 'งานบริษัท', labelEn: 'Business', sensitive: false },
  personal: { id: 'personal', labelTh: 'ส่วนตัว', labelEn: 'Personal', sensitive: true },
  health: { id: 'health', labelTh: 'สุขภาพ', labelEn: 'Health', sensitive: true },
  special: { id: 'special', labelTh: 'โอกาสพิเศษ', labelEn: 'Special occasion', sensitive: false },
  urgent: { id: 'urgent', labelTh: 'ด่วน', labelEn: 'Urgent', sensitive: false },
};

/** Where a notification is delivered. A LINE group is a destination, NOT an authorization boundary. */
export type DestinationKind = 'private-self' | 'line-group' | 'individual';

export type DestinationLifecycle =
  | 'pending-registration'
  | 'active'
  | 'disabled'
  | 'bot-removed'
  | 'verification-required'
  | 'archived';

export type WorkspaceRole = 'system-owner' | 'workspace-admin' | 'member' | 'viewer';

/**
 * A notification destination as shown to a user who is authorized to use it.
 * Raw LINE IDs are never part of this view model.
 */
export interface DestinationOption {
  id: string;
  kind: DestinationKind;
  displayName: string;
  /** Logical workspace label, e.g. "ครอบครัว" or "บริษัท". */
  workspaceLabel: string;
  /** Category of the group (family/business/...) used for suitability warnings. */
  workspaceKind: 'personal' | 'family' | 'company' | 'shared';
  /** Member count where known (LINE provides a count API); null = unknown. */
  memberCount: number | null;
  lifecycle: DestinationLifecycle;
  /** The current user's role in the owning workspace. */
  viewerRole: WorkspaceRole;
}

/** Notification job lifecycle (EP04). Acknowledgement is tracked separately. */
export const NOTIFICATION_STATES = [
  'scheduled',
  'processing',
  'provider-accepted',
  'retry-scheduled',
  'failed',
  'blocked-quota',
  'blocked-authorization',
  'cancelled',
  'expired',
] as const;
export type NotificationState = (typeof NOTIFICATION_STATES)[number];

export type AcknowledgementState = 'none' | 'acknowledged' | 'attending' | 'declined';

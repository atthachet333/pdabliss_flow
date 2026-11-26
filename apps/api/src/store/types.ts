/**
 * Store port (EP02). Two implementations satisfy the same contract tests:
 *   - PrismaStore  (MariaDB via Prisma 7 + @prisma/adapter-mariadb) — dev/test/prod runtime
 *   - MemoryStore  (fast, dependency-free) — unit tests in environments without MariaDB
 *
 * Rules every implementation must follow:
 *   - Row fields mirror apps/api/prisma/schema.prisma (calendar dates as "YYYY-MM-DD").
 *   - Callers always supply timestamps (no database clocks).
 *   - Conditional updates (versions, statuses, single-use tokens) are atomic.
 *   - Unique violations surface as StoreConflictError (never a raw driver error).
 *   - No method returns LINE ids except the identity/destination methods that need them.
 */

export type UserStatus = 'NEW' | 'PENDING' | 'ACTIVE' | 'REJECTED' | 'SUSPENDED' | 'REVOKED';
export type GlobalRole = 'OWNER' | 'ADMIN' | 'USER';
export type SessionEndReason = 'LOGGED_OUT' | 'REVOKED' | 'EXPIRED' | 'REPLACED';
export type AccessRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
export type InvitationStatus = 'ACTIVE' | 'REDEEMED' | 'REVOKED';
export type WorkspaceKind = 'PERSONAL' | 'FAMILY' | 'COMPANY' | 'CUSTOM';
export type WorkspaceStatus = 'ACTIVE' | 'ARCHIVED';
export type WorkspaceRole = 'ADMIN' | 'MEMBER' | 'VIEWER';
export type MemberStatus = 'ACTIVE' | 'REMOVED' | 'LEFT';
export type DestinationKind = 'PRIVATE_USER' | 'GROUP';
export type DestinationStatus = 'PENDING' | 'ACTIVE' | 'DISABLED' | 'REMOVED';
export type AppointmentVisibility = 'PRIVATE' | 'WORKSPACE' | 'SELECTED';
export type AppointmentStatus = 'SCHEDULED' | 'CANCELLED';
export type ContentPolicy = 'FULL' | 'PRIVACY_SAFE';
export type ReminderKind = 'RELATIVE' | 'CALENDAR';
export type ReminderStatus = 'SCHEDULED' | 'PAST' | 'DISABLED' | 'DUPLICATE' | 'CANCELLED';
export type AppointmentEventType =
  | 'CREATED'
  | 'UPDATED'
  | 'RESCHEDULED'
  | 'CANCELLED'
  | 'REMINDERS_CHANGED'
  | 'VISIBILITY_CHANGED'
  | 'DESTINATIONS_CHANGED';

export interface UserRow {
  id: string;
  displayName: string;
  status: UserStatus;
  globalRole: GlobalRole;
  authzVersion: number;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
  statusChangedAt: Date | null;
}

export interface LineIdentityRow {
  id: string;
  userId: string;
  lineUserId: string;
  loginChannelId: string;
  createdAt: Date;
  lastVerifiedAt: Date;
}

export interface SessionRow {
  id: string;
  keyHash: Uint8Array;
  userId: string;
  createdAt: Date;
  lastSeenAt: Date;
  absoluteExpiresAt: Date;
  endedAt: Date | null;
  endReason: SessionEndReason | null;
}

export interface AccessRequestRow {
  id: string;
  userId: string;
  status: AccessRequestStatus;
  message: string | null;
  invitationId: string | null;
  targetWorkspaceId: string | null;
  targetRole: WorkspaceRole | null;
  createdAt: Date;
  decidedAt: Date | null;
  decidedByUserId: string | null;
}

export interface InvitationRow {
  id: string;
  tokenHash: Uint8Array;
  workspaceId: string;
  role: WorkspaceRole;
  status: InvitationStatus;
  note: string | null;
  createdByUserId: string;
  createdAt: Date;
  expiresAt: Date;
  redeemedByUserId: string | null;
  redeemedAt: Date | null;
  revokedAt: Date | null;
}

export interface WorkspaceRow {
  id: string;
  name: string;
  kind: WorkspaceKind;
  status: WorkspaceStatus;
  personalOwnerId: string | null;
  createdByUserId: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export interface MemberRow {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  status: MemberStatus;
  addedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DestinationRow {
  id: string;
  kind: DestinationKind;
  lineTargetId: string;
  label: string;
  status: DestinationStatus;
  workspaceId: string | null;
  userId: string | null;
  audienceSize: number | null;
  createdAt: Date;
  updatedAt: Date;
  lastEventAt: Date | null;
}

export interface DestinationGrantRow {
  id: string;
  destinationId: string;
  userId: string;
  grantedByUserId: string;
  createdAt: Date;
}

export interface AppointmentRow {
  id: string;
  workspaceId: string;
  createdByUserId: string;
  title: string;
  category: string;
  allDay: boolean;
  timeZone: string;
  startDate: string; // YYYY-MM-DD (local)
  endDate: string; // YYYY-MM-DD (local, inclusive)
  startAt: Date | null;
  endAt: Date | null;
  location: string | null;
  notes: string | null;
  visibility: AppointmentVisibility;
  status: AppointmentStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  cancelledAt: Date | null;
  cancelledByUserId: string | null;
}

export interface AppointmentAccessRow {
  id: string;
  appointmentId: string;
  userId: string;
  createdAt: Date;
}

export interface AppointmentDestinationRow {
  id: string;
  appointmentId: string;
  destinationId: string;
  contentPolicy: ContentPolicy;
  createdAt: Date;
}

export interface ReminderRuleRow {
  id: string;
  appointmentId: string;
  ruleVersion: number;
  kind: ReminderKind;
  offsetMinutes: number | null;
  dayOffset: number | null;
  localTime: string | null;
  enabled: boolean;
  position: number;
  fireAt: Date | null;
  status: ReminderStatus;
  calculatedAt: Date;
}

export interface AppointmentEventRow {
  id: string;
  appointmentId: string;
  actorUserId: string | null;
  type: AppointmentEventType;
  fields: string[] | null;
  createdAt: Date;
}

export interface AppointmentBundle {
  appointment: AppointmentRow;
  accessGrants: AppointmentAccessRow[];
  destinations: AppointmentDestinationRow[];
  reminderRules: ReminderRuleRow[];
}

export interface PreferenceRow {
  userId: string;
  defaultWorkspaceId: string | null;
  defaultReminders: unknown;
  defaultVisibility: AppointmentVisibility;
  defaultContentPolicy: ContentPolicy;
  updatedAt: Date;
}

export interface IdempotencyRow {
  id: string;
  userId: string;
  scope: string;
  key: string;
  resultId: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface AuditRow {
  id: string;
  actorUserId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  workspaceId: string | null;
  metadata: Record<string, unknown> | null;
  correlationId: string | null;
  createdAt: Date;
}

export interface WebhookEventRow {
  eventId: string;
  type: string;
  sourceType: string;
  receivedAt: Date;
  expiresAt: Date;
}

/** Visibility-filtered appointment query (the ONLY way to list appointments). */
export interface AppointmentQuery {
  viewerUserId: string;
  /** Workspaces where the viewer is an ACTIVE member (resolved by the caller). */
  workspaceIds: string[];
  /** Inclusive local-date range overlap. */
  from?: string;
  to?: string;
  statuses?: AppointmentStatus[];
  categories?: string[];
  /** Case-insensitive substring match on title / location. */
  text?: string;
  order?: 'asc' | 'desc';
  limit: number;
  offset?: number;
}

export class StoreConflictError extends Error {
  constructor(public readonly constraint: string) {
    super(`conflict: ${constraint}`);
    this.name = 'StoreConflictError';
  }
}

/** The database rejected a transaction because another writer changed its snapshot. */
export class StoreTransactionConflictError extends Error {}

export interface Store {
  /** Runs fn atomically. Nested calls join the outer transaction. */
  transaction<T>(fn: (tx: Store) => Promise<T>): Promise<T>;
  close(): Promise<void>;

  // users & identities
  findIdentityByLineUserId(
    lineUserId: string,
  ): Promise<{ identity: LineIdentityRow; user: UserRow } | null>;
  getIdentityByUserId(userId: string): Promise<LineIdentityRow | null>;
  createUserWithIdentity(user: UserRow, identity: LineIdentityRow): Promise<void>;
  updateIdentityVerifiedAt(userId: string, at: Date): Promise<void>;
  getUser(id: string): Promise<UserRow | null>;
  getUsers(ids: string[]): Promise<UserRow[]>;
  /** Conditional on authzVersion when given; bumps authzVersion when bumpAuthz. Returns updated row or null. */
  updateUser(
    id: string,
    patch: Partial<
      Pick<UserRow, 'displayName' | 'status' | 'globalRole' | 'lastLoginAt' | 'statusChangedAt'>
    >,
    opts: { now: Date; expectAuthzVersion?: number; bumpAuthz?: boolean },
  ): Promise<UserRow | null>;
  listUsers(q: {
    statuses?: UserStatus[];
    text?: string;
    limit: number;
    offset?: number;
  }): Promise<UserRow[]>;
  countUsers(q: { statuses?: UserStatus[]; globalRoles?: GlobalRole[] }): Promise<number>;

  // sessions
  createSession(row: SessionRow): Promise<void>;
  getSessionByKeyHash(keyHash: Uint8Array): Promise<SessionRow | null>;
  touchSession(id: string, at: Date): Promise<void>;
  /** Ends an open session; returns false if it was already ended. */
  endSession(id: string, reason: SessionEndReason, at: Date): Promise<boolean>;
  endUserSessions(userId: string, reason: SessionEndReason, at: Date): Promise<number>;
  purgeSessions(endedOrExpiredBefore: Date): Promise<number>;

  // rate limiting (atomic fixed window)
  hitRateLimit(
    keyHash: Uint8Array,
    windowMs: number,
    now: Date,
  ): Promise<{ count: number; windowEnd: Date }>;
  purgeRateLimits(now: Date): Promise<number>;

  // webhook deduplication
  /** Inserts the event id; returns 'duplicate' when it already exists. */
  recordWebhookEvent(row: WebhookEventRow): Promise<'new' | 'duplicate'>;
  purgeWebhookEvents(now: Date): Promise<number>;
  /** Removes idempotency records whose window has passed. */
  purgeIdempotency(now: Date): Promise<number>;

  // access requests
  createAccessRequest(row: AccessRequestRow): Promise<void>;
  getAccessRequest(id: string): Promise<AccessRequestRow | null>;
  getOpenAccessRequest(userId: string): Promise<AccessRequestRow | null>;
  listAccessRequests(q: {
    statuses?: AccessRequestStatus[];
    userId?: string;
    limit: number;
  }): Promise<AccessRequestRow[]>;
  countAccessRequests(q: { statuses?: AccessRequestStatus[] }): Promise<number>;
  /** PENDING → status, atomically. Returns false if it was no longer PENDING. */
  decideAccessRequest(
    id: string,
    status: Exclude<AccessRequestStatus, 'PENDING'>,
    by: string | null,
    at: Date,
  ): Promise<boolean>;

  // invitations
  createInvitation(row: InvitationRow): Promise<void>;
  getInvitation(id: string): Promise<InvitationRow | null>;
  getInvitationByTokenHash(hash: Uint8Array): Promise<InvitationRow | null>;
  listInvitations(q: { workspaceId?: string; limit: number }): Promise<InvitationRow[]>;
  /** ACTIVE and not expired → REDEEMED by userId, atomically (single use). */
  redeemInvitation(id: string, userId: string, now: Date): Promise<boolean>;
  revokeInvitation(id: string, now: Date): Promise<boolean>;

  // workspaces & members
  createWorkspace(row: WorkspaceRow): Promise<void>;
  getWorkspace(id: string): Promise<WorkspaceRow | null>;
  getPersonalWorkspace(userId: string): Promise<WorkspaceRow | null>;
  listWorkspaces(q: {
    ids?: string[];
    statuses?: WorkspaceStatus[];
    limit: number;
  }): Promise<WorkspaceRow[]>;
  /** Optimistic: only when version matches; increments version. */
  updateWorkspace(
    id: string,
    expectedVersion: number,
    patch: Partial<Pick<WorkspaceRow, 'name' | 'kind' | 'status' | 'archivedAt'>>,
    now: Date,
  ): Promise<WorkspaceRow | null>;
  /** Insert, or reactivate/update an existing (workspace,user) row. */
  upsertMember(row: MemberRow): Promise<MemberRow>;
  getMember(workspaceId: string, userId: string): Promise<MemberRow | null>;
  listMembers(workspaceId: string, statuses?: MemberStatus[]): Promise<MemberRow[]>;
  listMembershipsForUser(userId: string, statuses?: MemberStatus[]): Promise<MemberRow[]>;
  updateMember(
    workspaceId: string,
    userId: string,
    patch: Partial<Pick<MemberRow, 'role' | 'status'>>,
    now: Date,
  ): Promise<MemberRow | null>;

  // destinations
  getDestination(id: string): Promise<DestinationRow | null>;
  getDestinationByTarget(lineTargetId: string): Promise<DestinationRow | null>;
  getPrivateDestination(userId: string): Promise<DestinationRow | null>;
  createDestination(row: DestinationRow): Promise<void>;
  updateDestination(
    id: string,
    patch: Partial<
      Pick<DestinationRow, 'label' | 'status' | 'workspaceId' | 'audienceSize' | 'lastEventAt'>
    >,
    now: Date,
  ): Promise<DestinationRow | null>;
  listDestinations(q: {
    ids?: string[];
    statuses?: DestinationStatus[];
    kinds?: DestinationKind[];
    workspaceIds?: string[];
    limit: number;
  }): Promise<DestinationRow[]>;
  createDestinationGrant(row: DestinationGrantRow): Promise<void>;
  deleteDestinationGrant(destinationId: string, userId: string): Promise<boolean>;
  listDestinationGrants(q: {
    destinationId?: string;
    userId?: string;
  }): Promise<DestinationGrantRow[]>;

  // appointments
  createAppointment(bundle: AppointmentBundle): Promise<void>;
  getAppointment(id: string): Promise<AppointmentBundle | null>;
  /**
   * Optimistic update: replaces the appointment row (version must equal expectedVersion,
   * stored version becomes expectedVersion + 1) and, when provided, replaces the related sets.
   */
  updateAppointment(
    id: string,
    expectedVersion: number,
    next: {
      appointment: AppointmentRow;
      accessGrants?: AppointmentAccessRow[];
      destinations?: AppointmentDestinationRow[];
      reminderRules?: ReminderRuleRow[];
    },
  ): Promise<boolean>;
  listAppointments(q: AppointmentQuery): Promise<AppointmentRow[]>;
  getAppointmentBundles(ids: string[]): Promise<AppointmentBundle[]>;
  appendAppointmentEvent(row: AppointmentEventRow): Promise<void>;
  listAppointmentEvents(appointmentId: string, limit: number): Promise<AppointmentEventRow[]>;

  // idempotency
  getIdempotency(userId: string, scope: string, key: string): Promise<IdempotencyRow | null>;
  /** Throws StoreConflictError('idempotency') when the key exists. */
  createIdempotency(row: IdempotencyRow): Promise<void>;

  // preferences
  getPreference(userId: string): Promise<PreferenceRow | null>;
  upsertPreference(row: PreferenceRow): Promise<void>;

  // audit
  appendAudit(row: AuditRow): Promise<void>;
  listAudit(q: {
    workspaceId?: string;
    resourceTypes?: string[];
    limit: number;
    offset?: number;
  }): Promise<AuditRow[]>;
}

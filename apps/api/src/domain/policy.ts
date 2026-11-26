/**
 * Central authorization policy (EP02). Deny by default. Three independent dimensions:
 *   1. application access + workspace membership  (who may use FLOW / a workspace)
 *   2. appointment visibility                     (who may read an appointment)
 *   3. LINE destination authorization            (where reminders may be sent)
 * None implies another. Global OWNER/ADMIN administer users and workspaces but have NO
 * implicit access to appointment content. Matrix: docs/EP02-PERMISSION-MATRIX.md.
 */
import type {
  AppointmentBundle,
  AppointmentVisibility,
  ContentPolicy,
  DestinationRow,
  GlobalRole,
  UserRow,
  WorkspaceRole,
  WorkspaceRow,
} from '../store/types.js';

export interface ActorMembership {
  workspace: WorkspaceRow;
  role: WorkspaceRole;
}

export interface Actor {
  user: UserRow;
  /** ACTIVE memberships in ACTIVE workspaces only. */
  memberships: Map<string, ActorMembership>;
}

export const SENSITIVE_CATEGORIES = new Set(['health', 'personal', 'family']);

export const isActive = (a: Actor) => a.user.status === 'ACTIVE';
export const isOwner = (a: Actor) => isActive(a) && a.user.globalRole === 'OWNER';
export const isGlobalAdmin = (a: Actor) =>
  isActive(a) && (a.user.globalRole === 'OWNER' || a.user.globalRole === 'ADMIN');
export const roleIn = (a: Actor, workspaceId: string): WorkspaceRole | null =>
  isActive(a) ? (a.memberships.get(workspaceId)?.role ?? null) : null;
export const activeWorkspaceIds = (a: Actor): string[] =>
  isActive(a) ? [...a.memberships.keys()] : [];

/** Workspace-scoped actions. */
export type WorkspaceAction =
  | 'workspace.view'
  | 'workspace.edit'
  | 'workspace.archive'
  | 'members.view'
  | 'members.manage'
  | 'workspace.leave'
  | 'appointment.create'
  | 'destinations.view';

const WORKSPACE_MATRIX: Record<WorkspaceAction, readonly WorkspaceRole[]> = {
  'workspace.view': ['ADMIN', 'MEMBER', 'VIEWER'],
  'workspace.edit': ['ADMIN'],
  'workspace.archive': ['ADMIN'],
  'members.view': ['ADMIN', 'MEMBER', 'VIEWER'],
  'members.manage': ['ADMIN'],
  'workspace.leave': ['ADMIN', 'MEMBER', 'VIEWER'],
  'appointment.create': ['ADMIN', 'MEMBER'],
  'destinations.view': ['ADMIN', 'MEMBER'],
};

export function canInWorkspace(a: Actor, action: WorkspaceAction, workspaceId: string): boolean {
  const m = isActive(a) ? a.memberships.get(workspaceId) : undefined;
  if (!m) return false;
  if (!WORKSPACE_MATRIX[action].includes(m.role)) return false;
  const personal = m.workspace.kind === 'PERSONAL';
  if (
    personal &&
    (action === 'workspace.archive' || action === 'workspace.leave' || action === 'members.manage')
  )
    return false;
  return true;
}

/** Global (application-level) actions. */
export type GlobalAction =
  | 'console.view'
  | 'requests.decide'
  | 'users.view'
  | 'users.status'
  | 'users.memberships'
  | 'users.role'
  | 'invitations.manage'
  | 'destinations.manage'
  | 'audit.view'
  | 'workspaces.create';

const GLOBAL_MATRIX: Record<GlobalAction, readonly GlobalRole[]> = {
  'console.view': ['OWNER', 'ADMIN'],
  'requests.decide': ['OWNER', 'ADMIN'],
  'users.view': ['OWNER', 'ADMIN'],
  'users.status': ['OWNER', 'ADMIN'],
  'users.memberships': ['OWNER', 'ADMIN'],
  'users.role': ['OWNER'],
  'invitations.manage': ['OWNER', 'ADMIN'],
  'destinations.manage': ['OWNER'],
  'audit.view': ['OWNER', 'ADMIN'],
  'workspaces.create': ['OWNER', 'ADMIN', 'USER'],
};

export function canGlobal(a: Actor, action: GlobalAction): boolean {
  return isActive(a) && GLOBAL_MATRIX[action].includes(a.user.globalRole);
}

/** May `a` act administratively on `target`? ADMINs cannot touch OWNER/ADMIN accounts; nobody acts on themselves. */
export function canAdministerUser(a: Actor, target: UserRow): boolean {
  if (!canGlobal(a, 'users.status')) return false;
  if (target.id === a.user.id) return false;
  if (a.user.globalRole === 'ADMIN' && target.globalRole !== 'USER') return false;
  return true;
}

// ───────────────────────── appointments ─────────────────────────

export function canViewAppointment(a: Actor, b: AppointmentBundle): boolean {
  const appt = b.appointment;
  if (roleIn(a, appt.workspaceId) === null) return false;
  if (appt.createdByUserId === a.user.id) return true;
  if (appt.visibility === 'WORKSPACE') return true;
  if (appt.visibility === 'SELECTED') return b.accessGrants.some((g) => g.userId === a.user.id);
  return false;
}

export function canEditAppointment(a: Actor, b: AppointmentBundle): boolean {
  if (!canViewAppointment(a, b)) return false;
  const role = roleIn(a, b.appointment.workspaceId);
  if (role === null || role === 'VIEWER') return false;
  if (b.appointment.createdByUserId === a.user.id) return true;
  return b.appointment.visibility === 'WORKSPACE' && role === 'ADMIN';
}

/**
 * Who could read an appointment with this visibility (used to validate private-chat
 * recipients: Sally never notifies someone who cannot see the appointment).
 */
export function visibleToUser(
  userId: string,
  creatorId: string,
  visibility: AppointmentVisibility,
  grantedUserIds: readonly string[],
  isActiveMember: boolean,
): boolean {
  if (!isActiveMember) return false;
  if (userId === creatorId) return true;
  if (visibility === 'WORKSPACE') return true;
  if (visibility === 'SELECTED') return grantedUserIds.includes(userId);
  return false;
}

// ───────────────────────── destinations ─────────────────────────

export type DestinationDecision =
  | { ok: true }
  | {
      ok: false;
      code:
        | 'DESTINATION_UNAVAILABLE'
        | 'DESTINATION_NOT_PERMITTED'
        | 'RECIPIENT_CANNOT_VIEW'
        | 'PRIVATE_CONTENT_TO_GROUP'
        | 'SENSITIVE_CONFIRMATION_REQUIRED';
    };

export interface DestinationContext {
  workspaceId: string;
  creatorId: string;
  visibility: AppointmentVisibility;
  grantedUserIds: readonly string[];
  category: string;
  contentPolicy: ContentPolicy;
  confirmSensitive: boolean;
  /** Is the private destination's owner an ACTIVE member of the workspace? */
  recipientIsActiveMember: boolean;
  /** Does the actor hold an explicit grant for this (group) destination? */
  actorHasGrant: boolean;
}

export function decideDestination(
  a: Actor,
  d: DestinationRow,
  ctx: DestinationContext,
): DestinationDecision {
  if (d.status !== 'ACTIVE') return { ok: false, code: 'DESTINATION_UNAVAILABLE' };
  const role = roleIn(a, ctx.workspaceId);
  if (role === null || role === 'VIEWER') return { ok: false, code: 'DESTINATION_NOT_PERMITTED' };
  if (d.kind === 'PRIVATE_USER') {
    if (!d.userId) return { ok: false, code: 'DESTINATION_UNAVAILABLE' };
    if (d.userId === a.user.id) return { ok: true };
    const canSee = visibleToUser(
      d.userId,
      ctx.creatorId,
      ctx.visibility,
      ctx.grantedUserIds,
      ctx.recipientIsActiveMember,
    );
    return canSee ? { ok: true } : { ok: false, code: 'RECIPIENT_CANNOT_VIEW' };
  }
  // GROUP: must belong to the appointment's workspace, and the actor must be its admin or hold a grant.
  if (d.workspaceId !== ctx.workspaceId) return { ok: false, code: 'DESTINATION_NOT_PERMITTED' };
  if (role !== 'ADMIN' && !ctx.actorHasGrant)
    return { ok: false, code: 'DESTINATION_NOT_PERMITTED' };
  // Everyone in a LINE group sees group messages: full details only for workspace-visible appointments.
  if (ctx.contentPolicy === 'FULL' && ctx.visibility !== 'WORKSPACE')
    return { ok: false, code: 'PRIVATE_CONTENT_TO_GROUP' };
  if (
    ctx.contentPolicy === 'FULL' &&
    SENSITIVE_CATEGORIES.has(ctx.category) &&
    !ctx.confirmSensitive
  )
    return { ok: false, code: 'SENSITIVE_CONFIRMATION_REQUIRED' };
  return { ok: true };
}

/** Machine-readable matrix for docs and tests. */
export const PERMISSION_MATRIX = { workspace: WORKSPACE_MATRIX, global: GLOBAL_MATRIX } as const;

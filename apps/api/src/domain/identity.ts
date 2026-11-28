/**
 * Identity, onboarding and user management (EP02).
 *
 * Journey: verified LINE login → user row (NEW) → in-app access request (PENDING) →
 * owner/admin decision in the mobile Owner Console (ACTIVE | REJECTED). No reference codes,
 * no CLI for ordinary users. Status changes bump `authzVersion` and end sessions where the
 * user must lose access immediately (suspend, revoke).
 */
import {
  type Clock,
  ApiError,
  badRequest,
  conflictError,
  forbidden,
  newId,
  notFound,
} from '../core/context.js';
import type { PersistentSessions } from '../auth/persistent.js';
import {
  type AccessRequestRow,
  type GlobalRole,
  type MemberRow,
  type Store,
  StoreConflictError,
  type UserRow,
  type WorkspaceRole,
  type WorkspaceRow,
} from '../store/types.js';
import { audit } from './audit.js';
import { type Actor, canAdministerUser, canGlobal } from './policy.js';
import { retryWriteConflict } from './transaction.js';

export const PERSONAL_WORKSPACE_NAME = 'พื้นที่ส่วนตัว';
export const PRIVATE_DESTINATION_LABEL = 'แชตส่วนตัวกับ Sally';
export const FALLBACK_DISPLAY_NAME = 'ผู้ใช้ LINE';

/** Display names from LINE are untrusted text: trim, strip control chars, cap at 100 code points. */
export function cleanDisplayName(name: string | null | undefined): string {
  // eslint-disable-next-line no-control-regex -- Strip C0 and DEL from untrusted single-line names.
  const s = (name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  const cps = [...s];
  return cps.length ? cps.slice(0, 100).join('') : FALLBACK_DISPLAY_NAME;
}

export async function ensurePersonalWorkspace(
  store: Store,
  user: UserRow,
  now: Date,
): Promise<WorkspaceRow> {
  const existing = await store.getPersonalWorkspace(user.id);
  if (existing) {
    await ensureMember(store, existing.id, user.id, 'ADMIN', null, now);
    return existing;
  }
  const ws: WorkspaceRow = {
    id: newId(),
    name: PERSONAL_WORKSPACE_NAME,
    kind: 'PERSONAL',
    status: 'ACTIVE',
    personalOwnerId: user.id,
    createdByUserId: user.id,
    version: 1,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
  await store.createWorkspace(ws);
  await ensureMember(store, ws.id, user.id, 'ADMIN', null, now);
  return ws;
}

export async function ensureMember(
  store: Store,
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
  addedBy: string | null,
  now: Date,
): Promise<MemberRow> {
  const existing = await store.getMember(workspaceId, userId);
  return store.upsertMember({
    id: existing?.id ?? newId(),
    workspaceId,
    userId,
    role,
    status: 'ACTIVE',
    addedByUserId: addedBy,
    // The member's own colour choice survives re-adds and role changes.
    colorToken: existing?.colorToken ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}

export async function ensurePrivateDestination(
  store: Store,
  userId: string,
  now: Date,
): Promise<void> {
  if (await store.getPrivateDestination(userId)) return;
  const identity = await store.getIdentityByUserId(userId);
  if (!identity) return;
  const byTarget = await store.getDestinationByTarget(identity.lineUserId);
  if (byTarget) return;
  await store.createDestination({
    id: newId(),
    kind: 'PRIVATE_USER',
    lineTargetId: identity.lineUserId,
    label: PRIVATE_DESTINATION_LABEL,
    status: 'ACTIVE',
    workspaceId: null,
    userId,
    audienceSize: 1,
    createdAt: now,
    updatedAt: now,
    lastEventAt: null,
  });
}

export class IdentityService {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
    private readonly sessions: PersistentSessions | null,
  ) {}

  /** Called only after LINE verified the ID token. Never trusts client profile data. */
  async upsertFromVerifiedLogin(
    lineUserId: string,
    name: string | null,
    loginChannelId: string,
  ): Promise<UserRow> {
    const now = this.clock();
    const displayName = cleanDisplayName(name);
    const found = await this.store.findIdentityByLineUserId(lineUserId);
    if (found) {
      await this.store.updateIdentityVerifiedAt(found.user.id, now);
      const updated = await this.store.updateUser(
        found.user.id,
        {
          lastLoginAt: now,
          ...(name && displayName !== found.user.displayName ? { displayName } : {}),
        },
        { now },
      );
      return updated ?? found.user;
    }
    const user: UserRow = {
      id: newId(),
      displayName,
      status: 'NEW',
      globalRole: 'USER',
      authzVersion: 1,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
      statusChangedAt: null,
    };
    try {
      await this.store.createUserWithIdentity(user, {
        id: newId(),
        userId: user.id,
        lineUserId,
        loginChannelId,
        createdAt: now,
        lastVerifiedAt: now,
      });
      return user;
    } catch (err) {
      // Concurrent first login of the same LINE user: the other request won — reuse it.
      if (err instanceof StoreConflictError) {
        const again = await this.store.findIdentityByLineUserId(lineUserId);
        if (again) return again.user;
      }
      throw err;
    }
  }

  async submitAccessRequest(actor: Actor, message: string | null): Promise<AccessRequestRow> {
    const status = actor.user.status;
    if (status === 'PENDING')
      throw conflictError('ALREADY_PENDING', 'An access request is already pending');
    if (status === 'ACTIVE') throw conflictError('ALREADY_ACTIVE', 'Access is already active');
    if (status !== 'NEW') throw forbidden(`ACCOUNT_${status}`);
    const now = this.clock();
    return this.store.transaction(async (tx) => {
      const req: AccessRequestRow = {
        id: newId(),
        userId: actor.user.id,
        status: 'PENDING',
        message: message ? message.slice(0, 200) : null,
        invitationId: null,
        targetWorkspaceId: null,
        targetRole: null,
        createdAt: now,
        decidedAt: null,
        decidedByUserId: null,
      };
      try {
        await tx.createAccessRequest(req);
      } catch (err) {
        if (err instanceof StoreConflictError) throw conflictError('ALREADY_PENDING');
        throw err;
      }
      const u = await tx.updateUser(
        actor.user.id,
        { status: 'PENDING', statusChangedAt: now },
        { now, expectAuthzVersion: actor.user.authzVersion, bumpAuthz: true },
      );
      if (!u) throw conflictError();
      await audit(tx, {
        actorUserId: actor.user.id,
        action: 'access.requested',
        resourceType: 'access_request',
        resourceId: req.id,
        at: now,
      });
      return req;
    });
  }

  async approveRequest(
    admin: Actor,
    requestId: string,
    assignments: { workspaceId: string; role: WorkspaceRole }[],
  ): Promise<void> {
    if (!canGlobal(admin, 'requests.decide')) throw forbidden();
    const now = this.clock();
    await retryWriteConflict(this.store, async (tx) => {
      const req = await tx.getAccessRequest(requestId);
      if (!req) throw notFound();
      const user = await tx.getUser(req.userId);
      if (!user) throw notFound();
      if (req.status !== 'PENDING')
        throw conflictError('REQUEST_ALREADY_DECIDED', 'This request was already decided');
      const wanted = new Map<string, WorkspaceRole>();
      if (req.targetWorkspaceId && req.targetRole)
        wanted.set(req.targetWorkspaceId, req.targetRole);
      for (const a of assignments) wanted.set(a.workspaceId, a.role);
      for (const wsId of wanted.keys()) {
        const ws = await tx.getWorkspace(wsId);
        if (!ws || ws.status !== 'ACTIVE' || ws.kind === 'PERSONAL')
          throw badRequest('INVALID_WORKSPACE');
      }
      if (!(await tx.decideAccessRequest(req.id, 'APPROVED', admin.user.id, now)))
        throw conflictError('REQUEST_ALREADY_DECIDED');
      const activated = await tx.updateUser(
        user.id,
        { status: 'ACTIVE', statusChangedAt: now },
        { now, bumpAuthz: true },
      );
      if (!activated) throw conflictError();
      await ensurePersonalWorkspace(tx, activated, now);
      await ensurePrivateDestination(tx, user.id, now);
      for (const [workspaceId, role] of wanted) {
        await ensureMember(tx, workspaceId, user.id, role, admin.user.id, now);
        await audit(tx, {
          actorUserId: admin.user.id,
          action: 'membership.added',
          resourceType: 'workspace',
          resourceId: workspaceId,
          workspaceId,
          meta: { targetUserId: user.id, role },
          at: now,
        });
      }
      await audit(tx, {
        actorUserId: admin.user.id,
        action: 'access.approved',
        resourceType: 'user',
        resourceId: user.id,
        meta: { requestId: req.id, count: wanted.size },
        at: now,
      });
    });
  }

  async rejectRequest(admin: Actor, requestId: string): Promise<void> {
    if (!canGlobal(admin, 'requests.decide')) throw forbidden();
    const now = this.clock();
    await retryWriteConflict(this.store, async (tx) => {
      const req = await tx.getAccessRequest(requestId);
      if (!req) throw notFound();
      if (!(await tx.decideAccessRequest(req.id, 'REJECTED', admin.user.id, now)))
        throw conflictError('REQUEST_ALREADY_DECIDED');
      await tx.updateUser(
        req.userId,
        { status: 'REJECTED', statusChangedAt: now },
        { now, bumpAuthz: true },
      );
      await audit(tx, {
        actorUserId: admin.user.id,
        action: 'access.rejected',
        resourceType: 'user',
        resourceId: req.userId,
        meta: { requestId: req.id },
        at: now,
      });
    });
  }

  private async assertNotLastOwner(store: Store, target: UserRow): Promise<void> {
    if (target.globalRole !== 'OWNER' || target.status !== 'ACTIVE') return;
    const owners = await store.countUsers({ statuses: ['ACTIVE'], globalRoles: ['OWNER'] });
    if (owners <= 1) throw conflictError('LAST_OWNER', 'The last active owner cannot be removed');
  }

  /**
   * Account lifecycle (Owner Console / Administration Center).
   *  - suspend: temporary; memberships kept, sessions ended, private notifications disabled.
   *  - reinstate: SUSPENDED → ACTIVE with the same memberships.
   *  - revoke: platform access removed; sessions ended; non-personal memberships removed,
   *    global ADMIN dropped to USER, LINE-group send grants removed and the private chat
   *    disabled. Appointments are never deleted — shared company appointments stay with
   *    their workspace; history and audit evidence are preserved.
   *  - reactivate: REVOKED/REJECTED → ACTIVE with ONLY the explicitly reviewed `assignments`
   *    (old privileges are never restored blindly). Stale reminders are not replayed: EP03
   *    never delivers a reminder whose time has passed (shared reminderEligibility).
   */
  async setUserStatus(
    admin: Actor,
    userId: string,
    action: 'suspend' | 'reinstate' | 'revoke' | 'reactivate',
    assignments: { workspaceId: string; role: WorkspaceRole }[] = [],
  ): Promise<UserRow> {
    if (action !== 'reactivate' && assignments.length)
      throw badRequest('ASSIGNMENTS_ONLY_ON_REACTIVATE');
    const now = this.clock();
    const result = await this.store.transaction(async (tx) => {
      const target = await tx.getUser(userId);
      if (!target) throw notFound();
      if (!canAdministerUser(admin, target)) throw forbidden();
      const from = target.status;
      const allowed: Record<typeof action, UserRow['status'][]> = {
        suspend: ['ACTIVE'],
        reinstate: ['SUSPENDED'],
        revoke: ['ACTIVE', 'SUSPENDED', 'PENDING', 'NEW'],
        reactivate: ['REVOKED', 'REJECTED'],
      };
      if (!allowed[action].includes(from))
        throw conflictError('INVALID_TRANSITION', 'Not possible in the current status');
      const to: UserRow['status'] =
        action === 'suspend' ? 'SUSPENDED' : action === 'revoke' ? 'REVOKED' : 'ACTIVE';
      if (to !== 'ACTIVE') await this.assertNotLastOwner(tx, target);
      for (const a of assignments) {
        const ws = await tx.getWorkspace(a.workspaceId);
        if (!ws || ws.status !== 'ACTIVE' || ws.kind === 'PERSONAL')
          throw badRequest('INVALID_WORKSPACE');
      }
      const updated = await tx.updateUser(
        target.id,
        {
          status: to,
          statusChangedAt: now,
          // Revocation removes platform administration; reactivation never restores it.
          ...(action === 'revoke' && target.globalRole === 'ADMIN'
            ? { globalRole: 'USER' as const }
            : {}),
        },
        { now, bumpAuthz: true },
      );
      if (!updated) throw conflictError();
      const privateChat = await tx.getPrivateDestination(target.id);
      if (to === 'ACTIVE') {
        await ensurePersonalWorkspace(tx, updated, now);
        await ensurePrivateDestination(tx, updated.id, now);
        if (privateChat && privateChat.status === 'DISABLED')
          await tx.updateDestination(privateChat.id, { status: 'ACTIVE' }, now);
        for (const a of assignments) {
          await ensureMember(tx, a.workspaceId, target.id, a.role, admin.user.id, now);
          await audit(tx, {
            actorUserId: admin.user.id,
            action: 'membership.added',
            resourceType: 'workspace',
            resourceId: a.workspaceId,
            workspaceId: a.workspaceId,
            meta: { targetUserId: target.id, role: a.role, reason: 'reactivation-review' },
            at: now,
          });
        }
      } else if (privateChat && privateChat.status === 'ACTIVE') {
        // No private notification may reach a suspended or revoked account.
        await tx.updateDestination(privateChat.id, { status: 'DISABLED' }, now);
      }
      if (action === 'revoke') {
        let removed = 0;
        for (const m of await tx.listMembershipsForUser(target.id, ['ACTIVE'])) {
          const ws = await tx.getWorkspace(m.workspaceId);
          if (!ws || ws.kind === 'PERSONAL') continue;
          await tx.updateMember(m.workspaceId, target.id, { status: 'REMOVED' }, now);
          removed += 1;
        }
        for (const g of await tx.listDestinationGrants({ userId: target.id }))
          await tx.deleteDestinationGrant(g.destinationId, target.id);
        if (removed)
          await audit(tx, {
            actorUserId: admin.user.id,
            action: 'membership.removed',
            resourceType: 'user',
            resourceId: target.id,
            meta: { count: removed, reason: 'revocation' },
            at: now,
          });
      }
      if (from === 'PENDING') {
        const open = await tx.getOpenAccessRequest(target.id);
        if (open) await tx.decideAccessRequest(open.id, 'REJECTED', admin.user.id, now);
      }
      await audit(tx, {
        actorUserId: admin.user.id,
        action: `user.${action}`,
        resourceType: 'user',
        resourceId: target.id,
        meta: { fromStatus: from, toStatus: to },
        at: now,
      });
      return updated;
    });
    if (result.status === 'SUSPENDED' || result.status === 'REVOKED')
      await this.sessions?.revokeUser(result.id);
    return result;
  }

  async setGlobalRole(
    owner: Actor,
    userId: string,
    role: Exclude<GlobalRole, 'OWNER'>,
  ): Promise<UserRow> {
    if (!canGlobal(owner, 'users.role')) throw forbidden();
    if (userId === owner.user.id) throw forbidden('CANNOT_CHANGE_OWN_ROLE');
    const now = this.clock();
    return this.store.transaction(async (tx) => {
      const target = await tx.getUser(userId);
      if (!target) throw notFound();
      if (target.status !== 'ACTIVE') throw conflictError('USER_NOT_ACTIVE');
      if (target.globalRole === role) return target;
      if (target.globalRole === 'OWNER') await this.assertNotLastOwner(tx, target);
      const updated = await tx.updateUser(
        target.id,
        { globalRole: role },
        { now, bumpAuthz: true },
      );
      if (!updated) throw conflictError();
      await audit(tx, {
        actorUserId: owner.user.id,
        action: 'user.role_changed',
        resourceType: 'user',
        resourceId: target.id,
        meta: { fromRole: target.globalRole, toRole: role },
        at: now,
      });
      return updated;
    });
  }

  /** Owner Console membership assignment (role null = remove). */
  async setMembership(
    admin: Actor,
    userId: string,
    workspaceId: string,
    role: WorkspaceRole | null,
  ): Promise<void> {
    if (!canGlobal(admin, 'users.memberships')) throw forbidden();
    const now = this.clock();
    await this.store.transaction(async (tx) => {
      const target = await tx.getUser(userId);
      const ws = await tx.getWorkspace(workspaceId);
      if (!target || !ws) throw notFound();
      if (
        admin.user.globalRole === 'ADMIN' &&
        target.globalRole !== 'USER' &&
        target.id !== admin.user.id
      )
        throw forbidden();
      if (ws.kind === 'PERSONAL' || ws.status !== 'ACTIVE') throw badRequest('INVALID_WORKSPACE');
      if (role !== null && target.status !== 'ACTIVE') throw conflictError('USER_NOT_ACTIVE');
      const current = await tx.getMember(workspaceId, userId);
      if (current?.status === 'ACTIVE' && current.role === 'ADMIN' && role !== 'ADMIN') {
        const admins = (await tx.listMembers(workspaceId, ['ACTIVE'])).filter(
          (m) => m.role === 'ADMIN',
        );
        if (admins.length <= 1)
          throw conflictError('LAST_WORKSPACE_ADMIN', 'A workspace needs at least one admin');
      }
      if (role === null) {
        if (!current || current.status !== 'ACTIVE') return;
        await tx.updateMember(workspaceId, userId, { status: 'REMOVED' }, now);
      } else {
        await ensureMember(tx, workspaceId, userId, role, admin.user.id, now);
      }
      await tx.updateUser(userId, {}, { now, bumpAuthz: true });
      await audit(tx, {
        actorUserId: admin.user.id,
        action: role === null ? 'membership.removed' : 'membership.set',
        resourceType: 'workspace',
        resourceId: workspaceId,
        workspaceId,
        meta: {
          targetUserId: userId,
          fromRole: current?.status === 'ACTIVE' ? current.role : null,
          toRole: role,
        },
        at: now,
      });
    });
  }
}

/**
 * Local-only, idempotent import of the EP01 owner (CLI). The caller supplies the verified
 * LINE user id from the EP01 access file; nothing here is reachable over HTTP.
 */
export async function importOwner(
  store: Store,
  input: {
    lineUserId: string;
    displayName: string | null;
    loginChannelId: string;
    allowAdditionalOwner: boolean;
  },
  now: Date,
): Promise<{ outcome: 'created' | 'promoted' | 'unchanged'; userId: string }> {
  if (!/^U[0-9a-f]{32}$/.test(input.lineUserId)) throw new ApiError(400, 'INVALID_LINE_ID');
  return store.transaction(async (tx) => {
    const found = await tx.findIdentityByLineUserId(input.lineUserId);
    const owners = await tx.countUsers({ statuses: ['ACTIVE'], globalRoles: ['OWNER'] });
    if (found) {
      const u = found.user;
      if (u.globalRole === 'OWNER' && u.status === 'ACTIVE') {
        await ensurePersonalWorkspace(tx, u, now);
        await ensurePrivateDestination(tx, u.id, now);
        return { outcome: 'unchanged' as const, userId: u.id };
      }
      if (u.status === 'REVOKED' || u.status === 'SUSPENDED')
        throw new ApiError(
          409,
          'CONFLICTING_STATUS',
          'This identity is suspended or revoked; resolve it first',
        );
      if (owners > 0 && !input.allowAdditionalOwner)
        throw new ApiError(
          409,
          'OWNER_EXISTS',
          'Another active owner exists (use --allow-additional-owner)',
        );
      const p = await tx.updateUser(
        u.id,
        { status: 'ACTIVE', globalRole: 'OWNER', statusChangedAt: now },
        { now, bumpAuthz: true },
      );
      if (!p) throw new ApiError(409, 'CONFLICT');
      await ensurePersonalWorkspace(tx, p, now);
      await ensurePrivateDestination(tx, p.id, now);
      const open = await tx.getOpenAccessRequest(u.id);
      if (open) await tx.decideAccessRequest(open.id, 'APPROVED', null, now);
      await audit(tx, {
        actorUserId: null,
        action: 'owner.imported',
        resourceType: 'user',
        resourceId: u.id,
        meta: { reason: 'promoted' },
        at: now,
      });
      return { outcome: 'promoted' as const, userId: u.id };
    }
    if (owners > 0 && !input.allowAdditionalOwner)
      throw new ApiError(
        409,
        'OWNER_EXISTS',
        'Another active owner exists (use --allow-additional-owner)',
      );
    const user: UserRow = {
      id: newId(),
      displayName: cleanDisplayName(input.displayName),
      status: 'ACTIVE',
      globalRole: 'OWNER',
      authzVersion: 1,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
      statusChangedAt: now,
    };
    await tx.createUserWithIdentity(user, {
      id: newId(),
      userId: user.id,
      lineUserId: input.lineUserId,
      loginChannelId: input.loginChannelId,
      createdAt: now,
      lastVerifiedAt: now,
    });
    await ensurePersonalWorkspace(tx, user, now);
    await ensurePrivateDestination(tx, user.id, now);
    await audit(tx, {
      actorUserId: null,
      action: 'owner.imported',
      resourceType: 'user',
      resourceId: user.id,
      meta: { reason: 'created' },
      at: now,
    });
    return { outcome: 'created' as const, userId: user.id };
  });
}

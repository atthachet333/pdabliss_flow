/** Workspaces and memberships (My Groups). Authorization via policy.ts only. */
import { isMemberColorId } from '@flow/shared';
import {
  type Clock,
  badRequest,
  conflictError,
  forbidden,
  newId,
  notFound,
} from '../core/context.js';
import type {
  MemberRow,
  Store,
  WorkspaceKind,
  WorkspaceRole,
  WorkspaceRow,
} from '../store/types.js';
import { audit } from './audit.js';
import { ensureMember } from './identity.js';
import { type Actor, canGlobal, canInWorkspace } from './policy.js';

export const WORKSPACE_NAME_MAX = 80;

function cleanName(name: string): string {
  // eslint-disable-next-line no-control-regex -- Strip C0 and DEL from single-line workspace names.
  const s = name.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!s || [...s].length > WORKSPACE_NAME_MAX) throw badRequest('INVALID_NAME');
  return s;
}

export class WorkspaceService {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
  ) {}

  async create(
    actor: Actor,
    name: string,
    kind: Exclude<WorkspaceKind, 'PERSONAL'>,
  ): Promise<WorkspaceRow> {
    if (!canGlobal(actor, 'workspaces.create')) throw forbidden();
    const now = this.clock();
    return this.store.transaction(async (tx) => {
      const ws: WorkspaceRow = {
        id: newId(),
        name: cleanName(name),
        kind,
        status: 'ACTIVE',
        personalOwnerId: null,
        createdByUserId: actor.user.id,
        version: 1,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      };
      await tx.createWorkspace(ws);
      await ensureMember(tx, ws.id, actor.user.id, 'ADMIN', actor.user.id, now);
      await audit(tx, {
        actorUserId: actor.user.id,
        action: 'workspace.created',
        resourceType: 'workspace',
        resourceId: ws.id,
        workspaceId: ws.id,
        meta: { kind },
        at: now,
      });
      return ws;
    });
  }

  async update(
    actor: Actor,
    workspaceId: string,
    version: number,
    patch: { name?: string; kind?: Exclude<WorkspaceKind, 'PERSONAL'> },
  ): Promise<WorkspaceRow> {
    if (!canInWorkspace(actor, 'workspace.edit', workspaceId)) throw notFound();
    const ws = actor.memberships.get(workspaceId)!.workspace;
    if (ws.kind === 'PERSONAL' && patch.kind) throw badRequest('PERSONAL_KIND_FIXED');
    const now = this.clock();
    const updated = await this.store.updateWorkspace(
      workspaceId,
      version,
      {
        ...(patch.name !== undefined ? { name: cleanName(patch.name) } : {}),
        ...(patch.kind ? { kind: patch.kind } : {}),
      },
      now,
    );
    if (!updated) throw conflictError('VERSION_CONFLICT');
    await audit(this.store, {
      actorUserId: actor.user.id,
      action: 'workspace.updated',
      resourceType: 'workspace',
      resourceId: workspaceId,
      workspaceId,
      meta: { version: updated.version },
      at: now,
    });
    return updated;
  }

  async archive(actor: Actor, workspaceId: string, version: number): Promise<WorkspaceRow> {
    if (!canInWorkspace(actor, 'workspace.archive', workspaceId)) throw notFound();
    const now = this.clock();
    const updated = await this.store.updateWorkspace(
      workspaceId,
      version,
      { status: 'ARCHIVED', archivedAt: now },
      now,
    );
    if (!updated) throw conflictError('VERSION_CONFLICT');
    await audit(this.store, {
      actorUserId: actor.user.id,
      action: 'workspace.archived',
      resourceType: 'workspace',
      resourceId: workspaceId,
      workspaceId,
      at: now,
    });
    return updated;
  }

  private async assertAdminRemains(
    store: Store,
    workspaceId: string,
    changingUserId: string,
  ): Promise<void> {
    const admins = (await store.listMembers(workspaceId, ['ACTIVE'])).filter(
      (m) => m.role === 'ADMIN',
    );
    if (admins.length <= 1 && admins[0]?.userId === changingUserId)
      throw conflictError('LAST_WORKSPACE_ADMIN', 'A workspace needs at least one admin');
  }

  async addMember(
    actor: Actor,
    workspaceId: string,
    userId: string,
    role: WorkspaceRole,
  ): Promise<MemberRow> {
    if (!canInWorkspace(actor, 'members.manage', workspaceId)) throw notFound();
    const now = this.clock();
    return this.store.transaction(async (tx) => {
      const target = await tx.getUser(userId);
      if (!target || target.status !== 'ACTIVE') throw badRequest('USER_NOT_ACTIVE');
      const m = await ensureMember(tx, workspaceId, userId, role, actor.user.id, now);
      await tx.updateUser(userId, {}, { now, bumpAuthz: true });
      await audit(tx, {
        actorUserId: actor.user.id,
        action: 'membership.added',
        resourceType: 'workspace',
        resourceId: workspaceId,
        workspaceId,
        meta: { targetUserId: userId, role },
        at: now,
      });
      return m;
    });
  }

  async changeRole(
    actor: Actor,
    workspaceId: string,
    userId: string,
    role: WorkspaceRole,
  ): Promise<MemberRow> {
    if (!canInWorkspace(actor, 'members.manage', workspaceId)) throw notFound();
    const now = this.clock();
    return this.store.transaction(async (tx) => {
      const current = await tx.getMember(workspaceId, userId);
      if (!current || current.status !== 'ACTIVE') throw notFound();
      if (current.role === 'ADMIN' && role !== 'ADMIN')
        await this.assertAdminRemains(tx, workspaceId, userId);
      const m = await tx.updateMember(workspaceId, userId, { role }, now);
      if (!m) throw notFound();
      await tx.updateUser(userId, {}, { now, bumpAuthz: true });
      await audit(tx, {
        actorUserId: actor.user.id,
        action: 'membership.role_changed',
        resourceType: 'workspace',
        resourceId: workspaceId,
        workspaceId,
        meta: { targetUserId: userId, fromRole: current.role, toRole: role },
        at: now,
      });
      return m;
    });
  }

  async removeMember(actor: Actor, workspaceId: string, userId: string): Promise<void> {
    const self = userId === actor.user.id;
    if (!canInWorkspace(actor, self ? 'workspace.leave' : 'members.manage', workspaceId))
      throw notFound();
    const now = this.clock();
    await this.store.transaction(async (tx) => {
      const current = await tx.getMember(workspaceId, userId);
      if (!current || current.status !== 'ACTIVE') throw notFound();
      if (current.role === 'ADMIN') await this.assertAdminRemains(tx, workspaceId, userId);
      await tx.updateMember(workspaceId, userId, { status: self ? 'LEFT' : 'REMOVED' }, now);
      await tx.updateUser(userId, {}, { now, bumpAuthz: true });
      await audit(tx, {
        actorUserId: actor.user.id,
        action: self ? 'membership.left' : 'membership.removed',
        resourceType: 'workspace',
        resourceId: workspaceId,
        workspaceId,
        meta: { targetUserId: userId },
        at: now,
      });
    });
  }

  /**
   * A member sets (or resets with null) their OWN identity colour in one workspace. Only
   * palette token ids are accepted — no free-form colour or CSS ever reaches storage.
   * There is deliberately no API to change another member's colour.
   */
  async setMyColor(actor: Actor, workspaceId: string, color: string | null): Promise<void> {
    if (!canInWorkspace(actor, 'workspace.view', workspaceId)) throw notFound();
    if (color !== null && !isMemberColorId(color)) throw badRequest('INVALID_COLOR');
    const now = this.clock();
    const updated = await this.store.updateMember(
      workspaceId,
      actor.user.id,
      { colorToken: color },
      now,
    );
    if (!updated || updated.status !== 'ACTIVE') throw notFound();
  }
}

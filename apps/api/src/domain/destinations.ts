/**
 * LINE destinations (EP02): private chats and registered groups.
 *  - A webhook `join` creates/refreshes a GROUP destination in PENDING; `leave` marks it
 *    REMOVED. Neither grants anyone application access or send permission.
 *  - The owner maps a pending group to a workspace and activates it (Owner Console).
 *  - Send permission = workspace ADMIN of the mapped workspace, or an explicit grant.
 *  - LINE ids never leave the API.
 */
import { type Clock, badRequest, forbidden, newId, notFound } from '../core/context.js';
import type { DestinationRow, Store } from '../store/types.js';
import { audit } from './audit.js';
import { type Actor, canGlobal, roleIn } from './policy.js';

export interface DestinationView {
  id: string;
  kind: DestinationRow['kind'];
  label: string;
  status: DestinationRow['status'];
  workspaceId: string | null;
  audienceSize: number | null;
  mine: boolean;
}

export const toDestinationView = (d: DestinationRow, viewerId: string): DestinationView => ({
  id: d.id,
  kind: d.kind,
  label: d.label,
  status: d.status,
  workspaceId: d.workspaceId,
  audienceSize: d.audienceSize,
  mine: d.kind === 'PRIVATE_USER' && d.userId === viewerId,
});

export class DestinationService {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
  ) {}

  /** Destinations the actor may select for an appointment in `workspaceId`. */
  async usable(actor: Actor, workspaceId: string): Promise<DestinationView[]> {
    const role = roleIn(actor, workspaceId);
    if (role === null || role === 'VIEWER') return [];
    const out: DestinationView[] = [];
    const own = await this.store.getPrivateDestination(actor.user.id);
    if (own && own.status === 'ACTIVE') out.push(toDestinationView(own, actor.user.id));
    const groups = await this.store.listDestinations({
      kinds: ['GROUP'],
      statuses: ['ACTIVE'],
      workspaceIds: [workspaceId],
      limit: 100,
    });
    const grants = new Set(
      (await this.store.listDestinationGrants({ userId: actor.user.id })).map((g) => g.destinationId),
    );
    for (const g of groups) if (role === 'ADMIN' || grants.has(g.id)) out.push(toDestinationView(g, actor.user.id));
    // Private chats of other active members (eligibility re-checked against visibility on save).
    const members = (await this.store.listMembers(workspaceId, ['ACTIVE'])).filter((m) => m.userId !== actor.user.id);
    if (members.length) {
      const users = new Map((await this.store.getUsers(members.map((m) => m.userId))).map((u) => [u.id, u]));
      for (const m of members) {
        const u = users.get(m.userId);
        if (!u || u.status !== 'ACTIVE') continue;
        const d = await this.store.getPrivateDestination(m.userId);
        if (d && d.status === 'ACTIVE')
          out.push({ ...toDestinationView(d, actor.user.id), label: `แชตส่วนตัว · ${u.displayName}` });
      }
    }
    return out;
  }

  async listForOwner(actor: Actor): Promise<DestinationView[]> {
    if (!canGlobal(actor, 'destinations.manage')) throw forbidden();
    const rows = await this.store.listDestinations({ kinds: ['GROUP'], limit: 200 });
    return rows.map((d) => toDestinationView(d, actor.user.id));
  }

  async configure(
    actor: Actor,
    id: string,
    patch: { label?: string; workspaceId?: string | null; status?: 'ACTIVE' | 'DISABLED'; audienceSize?: number | null },
  ): Promise<DestinationView> {
    if (!canGlobal(actor, 'destinations.manage')) throw forbidden();
    const now = this.clock();
    return this.store.transaction(async (tx) => {
      const d = await tx.getDestination(id);
      if (!d || d.kind !== 'GROUP') throw notFound();
      if (d.status === 'REMOVED' && patch.status === 'ACTIVE') throw badRequest('DESTINATION_REMOVED');
      const workspaceId = patch.workspaceId === undefined ? d.workspaceId : patch.workspaceId;
      if (workspaceId) {
        const ws = await tx.getWorkspace(workspaceId);
        if (!ws || ws.status !== 'ACTIVE' || ws.kind === 'PERSONAL') throw badRequest('INVALID_WORKSPACE');
      }
      if (patch.status === 'ACTIVE' && !workspaceId) throw badRequest('WORKSPACE_REQUIRED');
      const label = patch.label?.replace(/[\u0000-\u001f\u007f]/g, '').trim();
      if (label !== undefined && (!label || [...label].length > 100)) throw badRequest('INVALID_LABEL');
      const updated = await tx.updateDestination(
        id,
        {
          ...(label !== undefined ? { label } : {}),
          ...(patch.workspaceId !== undefined ? { workspaceId: patch.workspaceId } : {}),
          ...(patch.status ? { status: patch.status } : {}),
          ...(patch.audienceSize !== undefined ? { audienceSize: patch.audienceSize } : {}),
        },
        now,
      );
      if (!updated) throw notFound();
      await audit(tx, {
        actorUserId: actor.user.id,
        action: 'destination.configured',
        resourceType: 'destination',
        resourceId: id,
        workspaceId: updated.workspaceId,
        meta: { fromStatus: d.status, toStatus: updated.status },
        at: now,
      });
      return toDestinationView(updated, actor.user.id);
    });
  }

  async setGrant(actor: Actor, destinationId: string, userId: string, granted: boolean): Promise<void> {
    if (!canGlobal(actor, 'destinations.manage')) throw forbidden();
    const now = this.clock();
    await this.store.transaction(async (tx) => {
      const d = await tx.getDestination(destinationId);
      const u = await tx.getUser(userId);
      if (!d || d.kind !== 'GROUP' || !u) throw notFound();
      if (granted) {
        if (!d.workspaceId) throw badRequest('WORKSPACE_REQUIRED');
        const m = await tx.getMember(d.workspaceId, userId);
        if (!m || m.status !== 'ACTIVE' || m.role === 'VIEWER') throw badRequest('NOT_A_MEMBER');
        const existing = await tx.listDestinationGrants({ destinationId, userId });
        if (!existing.length)
          await tx.createDestinationGrant({ id: newId(), destinationId, userId, grantedByUserId: actor.user.id, createdAt: now });
      } else {
        await tx.deleteDestinationGrant(destinationId, userId);
      }
      await audit(tx, {
        actorUserId: actor.user.id,
        action: granted ? 'destination.granted' : 'destination.grant_removed',
        resourceType: 'destination',
        resourceId: destinationId,
        workspaceId: d.workspaceId,
        meta: { targetUserId: userId },
        at: now,
      });
    });
  }

  /** Webhook group lifecycle. Idempotent; redeliveries never duplicate registrations. */
  async onGroupEvent(kind: 'join' | 'leave', groupId: string): Promise<void> {
    if (!/^C[0-9a-f]{32}$/.test(groupId)) return;
    const now = this.clock();
    await this.store.transaction(async (tx) => {
      const d = await tx.getDestinationByTarget(groupId);
      if (kind === 'join') {
        if (!d) {
          await tx.createDestination({
            id: newId(),
            kind: 'GROUP',
            lineTargetId: groupId,
            label: 'กลุ่ม LINE ใหม่ (รอลงทะเบียน)',
            status: 'PENDING',
            workspaceId: null,
            userId: null,
            audienceSize: null,
            createdAt: now,
            updatedAt: now,
            lastEventAt: now,
          });
          await audit(tx, { actorUserId: null, action: 'group.joined', resourceType: 'destination', at: now });
        } else if (d.status === 'REMOVED') {
          // Rejoined: requires a fresh owner registration.
          await tx.updateDestination(d.id, { status: 'PENDING', lastEventAt: now }, now);
          await audit(tx, { actorUserId: null, action: 'group.rejoined', resourceType: 'destination', resourceId: d.id, at: now });
        } else {
          await tx.updateDestination(d.id, { lastEventAt: now }, now);
        }
      } else if (d && d.status !== 'REMOVED') {
        await tx.updateDestination(d.id, { status: 'REMOVED', lastEventAt: now }, now);
        await audit(tx, { actorUserId: null, action: 'group.left', resourceType: 'destination', resourceId: d.id, at: now });
      }
    });
  }

  async counts(): Promise<{ pendingGroups: number; activeGroups: number }> {
    const rows = await this.store.listDestinations({ kinds: ['GROUP'], statuses: ['PENDING', 'ACTIVE'], limit: 500 });
    return {
      pendingGroups: rows.filter((r) => r.status === 'PENDING').length,
      activeGroups: rows.filter((r) => r.status === 'ACTIVE').length,
    };
  }
}

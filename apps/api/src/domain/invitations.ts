/**
 * Invitation links (EP02).
 *  - 32 random bytes (base64url) shown ONCE; only SHA-256(token) is stored.
 *  - Expiring (24 h default; 1/24/72/168 h allowed), revocable, single use, consumed with
 *    an atomic conditional update (concurrent redemptions: exactly one wins).
 *  - Never grants a global role; requires a verified LINE session; never bypasses
 *    REJECTED/SUSPENDED/REVOKED; default policy: redemption creates an access/membership
 *    request that an owner/admin approves (no direct activation in EP02).
 */
import { createHash, randomBytes } from 'node:crypto';
import { type Clock, ApiError, badRequest, conflictError, forbidden, newId, notFound } from '../core/context.js';
import { type InvitationRow, type Store, StoreConflictError, type WorkspaceRole } from '../store/types.js';
import { audit } from './audit.js';
import { type Actor, canGlobal } from './policy.js';

export const INVITATION_EXPIRY_HOURS = [1, 24, 72, 168] as const;
export const DEFAULT_INVITATION_HOURS = 24;
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export const hashToken = (token: string): Uint8Array => createHash('sha256').update(token, 'utf8').digest();

export type InvitationState = 'valid' | 'expired' | 'revoked' | 'used' | 'invalid';

export function invitationState(i: InvitationRow | null, now: Date): InvitationState {
  if (!i) return 'invalid';
  if (i.status === 'REVOKED') return 'revoked';
  if (i.status === 'REDEEMED') return 'used';
  if (i.expiresAt <= now) return 'expired';
  return 'valid';
}

export class InvitationService {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
  ) {}

  async create(
    admin: Actor,
    input: { workspaceId: string; role: WorkspaceRole; expiresInHours: number; note: string | null },
  ): Promise<{ invitation: InvitationRow; token: string }> {
    if (!canGlobal(admin, 'invitations.manage')) throw forbidden();
    if (!(INVITATION_EXPIRY_HOURS as readonly number[]).includes(input.expiresInHours)) throw badRequest('INVALID_EXPIRY');
    const ws = await this.store.getWorkspace(input.workspaceId);
    if (!ws || ws.status !== 'ACTIVE' || ws.kind === 'PERSONAL') throw badRequest('INVALID_WORKSPACE');
    const now = this.clock();
    const token = randomBytes(32).toString('base64url');
    const invitation: InvitationRow = {
      id: newId(),
      tokenHash: hashToken(token),
      workspaceId: ws.id,
      role: input.role,
      status: 'ACTIVE',
      note: input.note ? input.note.slice(0, 80) : null,
      createdByUserId: admin.user.id,
      createdAt: now,
      expiresAt: new Date(now.getTime() + input.expiresInHours * 3_600_000),
      redeemedByUserId: null,
      redeemedAt: null,
      revokedAt: null,
    };
    await this.store.transaction(async (tx) => {
      await tx.createInvitation(invitation);
      await audit(tx, {
        actorUserId: admin.user.id,
        action: 'invitation.created',
        resourceType: 'invitation',
        resourceId: invitation.id,
        workspaceId: ws.id,
        meta: { role: input.role, expiresInHours: input.expiresInHours },
        at: now,
      });
    });
    return { invitation, token };
  }

  async revoke(admin: Actor, id: string): Promise<void> {
    if (!canGlobal(admin, 'invitations.manage')) throw forbidden();
    const now = this.clock();
    await this.store.transaction(async (tx) => {
      const inv = await tx.getInvitation(id);
      if (!inv) throw notFound();
      if (!(await tx.revokeInvitation(id, now))) throw conflictError('INVITATION_NOT_ACTIVE');
      await audit(tx, {
        actorUserId: admin.user.id,
        action: 'invitation.revoked',
        resourceType: 'invitation',
        resourceId: id,
        workspaceId: inv.workspaceId,
        at: now,
      });
    });
  }

  /** Read-only check (does not consume). Reveals only the workspace name and role for a valid token. */
  async inspect(token: string): Promise<{ state: InvitationState; workspaceName?: string; role?: WorkspaceRole }> {
    if (!TOKEN_RE.test(token)) return { state: 'invalid' };
    const inv = await this.store.getInvitationByTokenHash(hashToken(token));
    const state = invitationState(inv, this.clock());
    if (state !== 'valid' || !inv) return { state };
    const ws = await this.store.getWorkspace(inv.workspaceId);
    if (!ws || ws.status !== 'ACTIVE') return { state: 'invalid' };
    return { state, workspaceName: ws.name, role: inv.role };
  }

  /**
   * Redeem: consume the token atomically and file a request for the invited membership.
   * The membership becomes effective only after owner/admin approval.
   */
  async redeem(actor: Actor, token: string): Promise<{ state: 'requested' | 'already-member' }> {
    const blocked = ['REJECTED', 'SUSPENDED', 'REVOKED'];
    if (blocked.includes(actor.user.status)) throw forbidden(`ACCOUNT_${actor.user.status}`);
    if (!TOKEN_RE.test(token)) throw new ApiError(404, 'INVITATION_INVALID', 'Invitation is not valid');
    const now = this.clock();
    return this.store.transaction(async (tx) => {
      const inv = await tx.getInvitationByTokenHash(hashToken(token));
      const state = invitationState(inv, now);
      if (state !== 'valid' || !inv) {
        const code = { invalid: 'INVITATION_INVALID', expired: 'INVITATION_EXPIRED', revoked: 'INVITATION_REVOKED', used: 'INVITATION_USED' }[
          state as Exclude<InvitationState, 'valid'>
        ];
        throw new ApiError(state === 'invalid' ? 404 : 410, code, 'Invitation cannot be used');
      }
      const member = await tx.getMember(inv.workspaceId, actor.user.id);
      if (actor.user.status === 'ACTIVE' && member?.status === 'ACTIVE') return { state: 'already-member' as const };
      if (await tx.getOpenAccessRequest(actor.user.id)) throw conflictError('ALREADY_PENDING');
      if (!(await tx.redeemInvitation(inv.id, actor.user.id, now)))
        throw new ApiError(410, 'INVITATION_USED', 'Invitation cannot be used');
      try {
        await tx.createAccessRequest({
          id: newId(),
          userId: actor.user.id,
          status: 'PENDING',
          message: null,
          invitationId: inv.id,
          targetWorkspaceId: inv.workspaceId,
          targetRole: inv.role,
          createdAt: now,
          decidedAt: null,
          decidedByUserId: null,
        });
      } catch (err) {
        if (err instanceof StoreConflictError) throw conflictError('ALREADY_PENDING');
        throw err;
      }
      if (actor.user.status === 'NEW')
        await tx.updateUser(actor.user.id, { status: 'PENDING', statusChangedAt: now }, { now, bumpAuthz: true });
      await audit(tx, {
        actorUserId: actor.user.id,
        action: 'invitation.redeemed',
        resourceType: 'invitation',
        resourceId: inv.id,
        workspaceId: inv.workspaceId,
        meta: { role: inv.role },
        at: now,
      });
      return { state: 'requested' as const };
    });
  }
}

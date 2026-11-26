/**
 * In-memory Store for unit tests and environments without MariaDB. It emulates the
 * constraints the MariaDB schema enforces (uniques, single-open-request, atomic
 * conditional updates) and runs transactions with snapshot/rollback + a mutex.
 * Never used for real data.
 */
import {
  type AccessRequestRow,
  type AppointmentBundle,
  type AppointmentEventRow,
  type AppointmentQuery,
  type AppointmentRow,
  type AuditRow,
  type DestinationGrantRow,
  type DestinationRow,
  type IdempotencyRow,
  type InvitationRow,
  type LineIdentityRow,
  type MemberRow,
  type PreferenceRow,
  type SessionRow,
  type Store,
  StoreConflictError,
  type UserRow,
  type WebhookEventRow,
  type WorkspaceRow,
} from './types.js';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const clone = <T>(v: T): T => structuredClone(v);

interface State {
  users: Map<string, UserRow>;
  identities: Map<string, LineIdentityRow>;
  sessions: Map<string, SessionRow>;
  rate: Map<string, { count: number; windowEnd: Date }>;
  webhook: Map<string, WebhookEventRow>;
  requests: Map<string, AccessRequestRow>;
  invitations: Map<string, InvitationRow>;
  workspaces: Map<string, WorkspaceRow>;
  members: Map<string, MemberRow>;
  destinations: Map<string, DestinationRow>;
  grants: Map<string, DestinationGrantRow>;
  appointments: Map<string, AppointmentRow>;
  access: Map<string, AppointmentBundle['accessGrants'][number]>;
  apptDest: Map<string, AppointmentBundle['destinations'][number]>;
  rules: Map<string, AppointmentBundle['reminderRules'][number]>;
  events: AppointmentEventRow[];
  idem: Map<string, IdempotencyRow>;
  prefs: Map<string, PreferenceRow>;
  audit: AuditRow[];
}

function emptyState(): State {
  return {
    users: new Map(),
    identities: new Map(),
    sessions: new Map(),
    rate: new Map(),
    webhook: new Map(),
    requests: new Map(),
    invitations: new Map(),
    workspaces: new Map(),
    members: new Map(),
    destinations: new Map(),
    grants: new Map(),
    appointments: new Map(),
    access: new Map(),
    apptDest: new Map(),
    rules: new Map(),
    events: [],
    idem: new Map(),
    prefs: new Map(),
    audit: [],
  };
}

function overlaps(row: AppointmentRow, from?: string, to?: string): boolean {
  if (from && row.endDate < from) return false;
  if (to && row.startDate > to) return false;
  return true;
}

export class MemoryStore implements Store {
  private s: State = emptyState();
  private lock: Promise<void> = Promise.resolve();
  private inTx = false;

  async transaction<T>(fn: (tx: Store) => Promise<T>): Promise<T> {
    if (this.inTx) return fn(this);
    let release: () => void = () => undefined;
    const prev = this.lock;
    this.lock = new Promise<void>((r) => (release = r));
    await prev;
    const snapshot = clone(this.s);
    this.inTx = true;
    try {
      const out = await fn(this);
      return out;
    } catch (err) {
      this.s = snapshot;
      throw err;
    } finally {
      this.inTx = false;
      release();
    }
  }

  async close(): Promise<void> {}

  /** Test helper: wipe everything. */
  reset(): void {
    this.s = emptyState();
  }

  // ───────── users & identities
  async findIdentityByLineUserId(lineUserId: string) {
    for (const i of this.s.identities.values()) {
      if (i.lineUserId === lineUserId) {
        const user = this.s.users.get(i.userId);
        return user ? { identity: clone(i), user: clone(user) } : null;
      }
    }
    return null;
  }
  async getIdentityByUserId(userId: string) {
    for (const i of this.s.identities.values()) if (i.userId === userId) return clone(i);
    return null;
  }
  async createUserWithIdentity(user: UserRow, identity: LineIdentityRow) {
    for (const i of this.s.identities.values()) {
      if (i.lineUserId === identity.lineUserId) throw new StoreConflictError('lineUserId');
      if (i.userId === identity.userId) throw new StoreConflictError('identity.userId');
    }
    if (this.s.users.has(user.id)) throw new StoreConflictError('user.id');
    this.s.users.set(user.id, clone(user));
    this.s.identities.set(identity.id, clone(identity));
  }
  async updateIdentityVerifiedAt(userId: string, at: Date) {
    for (const i of this.s.identities.values()) if (i.userId === userId) i.lastVerifiedAt = at;
  }
  async getUser(id: string) {
    const u = this.s.users.get(id);
    return u ? clone(u) : null;
  }
  async getUsers(ids: string[]) {
    return ids
      .map((id) => this.s.users.get(id))
      .filter((u): u is UserRow => !!u)
      .map(clone);
  }
  async updateUser(
    id: string,
    patch: Partial<
      Pick<UserRow, 'displayName' | 'status' | 'globalRole' | 'lastLoginAt' | 'statusChangedAt'>
    >,
    opts: { now: Date; expectAuthzVersion?: number; bumpAuthz?: boolean },
  ) {
    const u = this.s.users.get(id);
    if (!u) return null;
    if (opts.expectAuthzVersion !== undefined && u.authzVersion !== opts.expectAuthzVersion)
      return null;
    Object.assign(u, patch, { updatedAt: opts.now });
    if (opts.bumpAuthz) u.authzVersion += 1;
    return clone(u);
  }
  async listUsers(q: {
    statuses?: UserRow['status'][];
    text?: string;
    limit: number;
    offset?: number;
  }) {
    const t = q.text?.toLowerCase();
    return [...this.s.users.values()]
      .filter((u) => !q.statuses || q.statuses.includes(u.status))
      .filter((u) => !t || u.displayName.toLowerCase().includes(t))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id))
      .slice(q.offset ?? 0, (q.offset ?? 0) + q.limit)
      .map(clone);
  }
  async countUsers(q: { statuses?: UserRow['status'][]; globalRoles?: UserRow['globalRole'][] }) {
    return [...this.s.users.values()].filter(
      (u) =>
        (!q.statuses || q.statuses.includes(u.status)) &&
        (!q.globalRoles || q.globalRoles.includes(u.globalRole)),
    ).length;
  }

  // ───────── sessions
  async createSession(row: SessionRow) {
    for (const s of this.s.sessions.values())
      if (hex(s.keyHash) === hex(row.keyHash)) throw new StoreConflictError('session.keyHash');
    this.s.sessions.set(row.id, clone(row));
  }
  async getSessionByKeyHash(keyHash: Uint8Array) {
    const k = hex(keyHash);
    for (const s of this.s.sessions.values()) if (hex(s.keyHash) === k) return clone(s);
    return null;
  }
  async touchSession(id: string, at: Date) {
    const s = this.s.sessions.get(id);
    if (s && !s.endedAt) s.lastSeenAt = at;
  }
  async endSession(id: string, reason: SessionRow['endReason'] & string, at: Date) {
    const s = this.s.sessions.get(id);
    if (!s || s.endedAt) return false;
    s.endedAt = at;
    s.endReason = reason;
    return true;
  }
  async endUserSessions(userId: string, reason: SessionRow['endReason'] & string, at: Date) {
    let n = 0;
    for (const s of this.s.sessions.values()) {
      if (s.userId === userId && !s.endedAt) {
        s.endedAt = at;
        s.endReason = reason;
        n += 1;
      }
    }
    return n;
  }
  async purgeSessions(before: Date) {
    let n = 0;
    for (const [id, s] of this.s.sessions) {
      if ((s.endedAt && s.endedAt < before) || s.absoluteExpiresAt < before) {
        this.s.sessions.delete(id);
        n += 1;
      }
    }
    return n;
  }

  // ───────── rate limits
  async hitRateLimit(keyHash: Uint8Array, windowMs: number, now: Date) {
    const k = hex(keyHash);
    const cur = this.s.rate.get(k);
    if (!cur || cur.windowEnd <= now) {
      const fresh = { count: 1, windowEnd: new Date(now.getTime() + windowMs) };
      this.s.rate.set(k, fresh);
      return clone(fresh);
    }
    cur.count += 1;
    return clone(cur);
  }
  async purgeRateLimits(now: Date) {
    let n = 0;
    for (const [k, v] of this.s.rate) {
      if (v.windowEnd <= now) {
        this.s.rate.delete(k);
        n += 1;
      }
    }
    return n;
  }

  // ───────── webhook
  async recordWebhookEvent(row: WebhookEventRow) {
    if (this.s.webhook.has(row.eventId)) return 'duplicate' as const;
    this.s.webhook.set(row.eventId, clone(row));
    return 'new' as const;
  }
  async purgeWebhookEvents(now: Date) {
    let n = 0;
    for (const [k, v] of this.s.webhook) {
      if (v.expiresAt <= now) {
        this.s.webhook.delete(k);
        n += 1;
      }
    }
    return n;
  }

  // ───────── access requests
  async createAccessRequest(row: AccessRequestRow) {
    if (row.status === 'PENDING') {
      for (const r of this.s.requests.values())
        if (r.userId === row.userId && r.status === 'PENDING')
          throw new StoreConflictError('openKey');
    }
    this.s.requests.set(row.id, clone(row));
  }
  async getAccessRequest(id: string) {
    const r = this.s.requests.get(id);
    return r ? clone(r) : null;
  }
  async getOpenAccessRequest(userId: string) {
    for (const r of this.s.requests.values())
      if (r.userId === userId && r.status === 'PENDING') return clone(r);
    return null;
  }
  async listAccessRequests(q: {
    statuses?: AccessRequestRow['status'][];
    userId?: string;
    limit: number;
  }) {
    return [...this.s.requests.values()]
      .filter(
        (r) =>
          (!q.statuses || q.statuses.includes(r.status)) && (!q.userId || r.userId === q.userId),
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, q.limit)
      .map(clone);
  }
  async countAccessRequests(q: { statuses?: AccessRequestRow['status'][] }) {
    return [...this.s.requests.values()].filter((r) => !q.statuses || q.statuses.includes(r.status))
      .length;
  }
  async decideAccessRequest(
    id: string,
    status: Exclude<AccessRequestRow['status'], 'PENDING'>,
    by: string | null,
    at: Date,
  ) {
    const r = this.s.requests.get(id);
    if (!r || r.status !== 'PENDING') return false;
    r.status = status;
    r.decidedAt = at;
    r.decidedByUserId = by;
    return true;
  }

  // ───────── invitations
  async createInvitation(row: InvitationRow) {
    for (const i of this.s.invitations.values())
      if (hex(i.tokenHash) === hex(row.tokenHash)) throw new StoreConflictError('tokenHash');
    this.s.invitations.set(row.id, clone(row));
  }
  async getInvitation(id: string) {
    const i = this.s.invitations.get(id);
    return i ? clone(i) : null;
  }
  async getInvitationByTokenHash(hash: Uint8Array) {
    const k = hex(hash);
    for (const i of this.s.invitations.values()) if (hex(i.tokenHash) === k) return clone(i);
    return null;
  }
  async listInvitations(q: { workspaceId?: string; limit: number }) {
    return [...this.s.invitations.values()]
      .filter((i) => !q.workspaceId || i.workspaceId === q.workspaceId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, q.limit)
      .map(clone);
  }
  async redeemInvitation(id: string, userId: string, now: Date) {
    const i = this.s.invitations.get(id);
    if (!i || i.status !== 'ACTIVE' || i.expiresAt <= now) return false;
    i.status = 'REDEEMED';
    i.redeemedByUserId = userId;
    i.redeemedAt = now;
    return true;
  }
  async revokeInvitation(id: string, now: Date) {
    const i = this.s.invitations.get(id);
    if (!i || i.status !== 'ACTIVE') return false;
    i.status = 'REVOKED';
    i.revokedAt = now;
    return true;
  }

  // ───────── workspaces & members
  async createWorkspace(row: WorkspaceRow) {
    if (row.personalOwnerId) {
      for (const w of this.s.workspaces.values())
        if (w.personalOwnerId === row.personalOwnerId)
          throw new StoreConflictError('personalOwnerId');
    }
    this.s.workspaces.set(row.id, clone(row));
  }
  async getWorkspace(id: string) {
    const w = this.s.workspaces.get(id);
    return w ? clone(w) : null;
  }
  async getPersonalWorkspace(userId: string) {
    for (const w of this.s.workspaces.values()) if (w.personalOwnerId === userId) return clone(w);
    return null;
  }
  async listWorkspaces(q: { ids?: string[]; statuses?: WorkspaceRow['status'][]; limit: number }) {
    return [...this.s.workspaces.values()]
      .filter(
        (w) => (!q.ids || q.ids.includes(w.id)) && (!q.statuses || q.statuses.includes(w.status)),
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
      .slice(0, q.limit)
      .map(clone);
  }
  async updateWorkspace(
    id: string,
    expectedVersion: number,
    patch: Partial<Pick<WorkspaceRow, 'name' | 'kind' | 'status' | 'archivedAt'>>,
    now: Date,
  ) {
    const w = this.s.workspaces.get(id);
    if (!w || w.version !== expectedVersion) return null;
    Object.assign(w, patch, { updatedAt: now, version: w.version + 1 });
    return clone(w);
  }
  async upsertMember(row: MemberRow) {
    for (const m of this.s.members.values()) {
      if (m.workspaceId === row.workspaceId && m.userId === row.userId) {
        Object.assign(m, {
          role: row.role,
          status: row.status,
          updatedAt: row.updatedAt,
          addedByUserId: row.addedByUserId,
        });
        return clone(m);
      }
    }
    this.s.members.set(row.id, clone(row));
    return clone(row);
  }
  async getMember(workspaceId: string, userId: string) {
    for (const m of this.s.members.values())
      if (m.workspaceId === workspaceId && m.userId === userId) return clone(m);
    return null;
  }
  async listMembers(workspaceId: string, statuses?: MemberRow['status'][]) {
    return [...this.s.members.values()]
      .filter((m) => m.workspaceId === workspaceId && (!statuses || statuses.includes(m.status)))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(clone);
  }
  async listMembershipsForUser(userId: string, statuses?: MemberRow['status'][]) {
    return [...this.s.members.values()]
      .filter((m) => m.userId === userId && (!statuses || statuses.includes(m.status)))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(clone);
  }
  async updateMember(
    workspaceId: string,
    userId: string,
    patch: Partial<Pick<MemberRow, 'role' | 'status'>>,
    now: Date,
  ) {
    for (const m of this.s.members.values()) {
      if (m.workspaceId === workspaceId && m.userId === userId) {
        Object.assign(m, patch, { updatedAt: now });
        return clone(m);
      }
    }
    return null;
  }

  // ───────── destinations
  async getDestination(id: string) {
    const d = this.s.destinations.get(id);
    return d ? clone(d) : null;
  }
  async getDestinationByTarget(lineTargetId: string) {
    for (const d of this.s.destinations.values())
      if (d.lineTargetId === lineTargetId) return clone(d);
    return null;
  }
  async getPrivateDestination(userId: string) {
    for (const d of this.s.destinations.values())
      if (d.kind === 'PRIVATE_USER' && d.userId === userId) return clone(d);
    return null;
  }
  async createDestination(row: DestinationRow) {
    for (const d of this.s.destinations.values()) {
      if (d.lineTargetId === row.lineTargetId) throw new StoreConflictError('lineTargetId');
      if (row.userId && d.userId === row.userId) throw new StoreConflictError('destination.userId');
    }
    this.s.destinations.set(row.id, clone(row));
  }
  async updateDestination(
    id: string,
    patch: Partial<
      Pick<DestinationRow, 'label' | 'status' | 'workspaceId' | 'audienceSize' | 'lastEventAt'>
    >,
    now: Date,
  ) {
    const d = this.s.destinations.get(id);
    if (!d) return null;
    Object.assign(d, patch, { updatedAt: now });
    return clone(d);
  }
  async listDestinations(q: {
    ids?: string[];
    statuses?: DestinationRow['status'][];
    kinds?: DestinationRow['kind'][];
    workspaceIds?: string[];
    limit: number;
  }) {
    return [...this.s.destinations.values()]
      .filter(
        (d) =>
          (!q.ids || q.ids.includes(d.id)) &&
          (!q.statuses || q.statuses.includes(d.status)) &&
          (!q.kinds || q.kinds.includes(d.kind)) &&
          (!q.workspaceIds || (d.workspaceId !== null && q.workspaceIds.includes(d.workspaceId))),
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, q.limit)
      .map(clone);
  }
  async createDestinationGrant(row: DestinationGrantRow) {
    for (const g of this.s.grants.values())
      if (g.destinationId === row.destinationId && g.userId === row.userId)
        throw new StoreConflictError('grant');
    this.s.grants.set(row.id, clone(row));
  }
  async deleteDestinationGrant(destinationId: string, userId: string) {
    for (const [id, g] of this.s.grants)
      if (g.destinationId === destinationId && g.userId === userId) return this.s.grants.delete(id);
    return false;
  }
  async listDestinationGrants(q: { destinationId?: string; userId?: string }) {
    return [...this.s.grants.values()]
      .filter(
        (g) =>
          (!q.destinationId || g.destinationId === q.destinationId) &&
          (!q.userId || g.userId === q.userId),
      )
      .map(clone);
  }

  // ───────── appointments
  private bundle(a: AppointmentRow): AppointmentBundle {
    return {
      appointment: clone(a),
      accessGrants: [...this.s.access.values()].filter((g) => g.appointmentId === a.id).map(clone),
      destinations: [...this.s.apptDest.values()]
        .filter((d) => d.appointmentId === a.id)
        .map(clone),
      reminderRules: [...this.s.rules.values()]
        .filter((r) => r.appointmentId === a.id)
        .sort((x, y) => x.position - y.position)
        .map(clone),
    };
  }
  private replaceChildren(id: string, b: Partial<Omit<AppointmentBundle, 'appointment'>>) {
    if (b.accessGrants) {
      for (const [k, g] of this.s.access) if (g.appointmentId === id) this.s.access.delete(k);
      const seen = new Set<string>();
      for (const g of b.accessGrants) {
        if (seen.has(g.userId)) throw new StoreConflictError('appointment_access');
        seen.add(g.userId);
        this.s.access.set(g.id, clone(g));
      }
    }
    if (b.destinations) {
      for (const [k, d] of this.s.apptDest) if (d.appointmentId === id) this.s.apptDest.delete(k);
      const seen = new Set<string>();
      for (const d of b.destinations) {
        if (seen.has(d.destinationId)) throw new StoreConflictError('appointment_destinations');
        if (!this.s.destinations.has(d.destinationId))
          throw new StoreConflictError('destination.fk');
        seen.add(d.destinationId);
        this.s.apptDest.set(d.id, clone(d));
      }
    }
    if (b.reminderRules) {
      for (const [k, r] of this.s.rules) if (r.appointmentId === id) this.s.rules.delete(k);
      for (const r of b.reminderRules) this.s.rules.set(r.id, clone(r));
    }
  }
  async createAppointment(b: AppointmentBundle) {
    if (!this.s.workspaces.has(b.appointment.workspaceId))
      throw new StoreConflictError('workspace.fk');
    if (this.s.appointments.has(b.appointment.id)) throw new StoreConflictError('appointment.id');
    this.s.appointments.set(b.appointment.id, clone(b.appointment));
    this.replaceChildren(b.appointment.id, b);
  }
  async getAppointment(id: string) {
    const a = this.s.appointments.get(id);
    return a ? this.bundle(a) : null;
  }
  async updateAppointment(
    id: string,
    expectedVersion: number,
    next: {
      appointment: AppointmentRow;
      accessGrants?: AppointmentBundle['accessGrants'];
      destinations?: AppointmentBundle['destinations'];
      reminderRules?: AppointmentBundle['reminderRules'];
    },
  ) {
    const a = this.s.appointments.get(id);
    if (!a || a.version !== expectedVersion) return false;
    this.s.appointments.set(id, { ...clone(next.appointment), id, version: expectedVersion + 1 });
    this.replaceChildren(id, next);
    return true;
  }
  async listAppointments(q: AppointmentQuery) {
    if (!q.viewerUserId || !Array.isArray(q.workspaceIds))
      throw new Error('listAppointments requires a viewer and workspace scope');
    const ws = new Set(q.workspaceIds);
    const granted = new Set(
      [...this.s.access.values()]
        .filter((g) => g.userId === q.viewerUserId)
        .map((g) => g.appointmentId),
    );
    const t = q.text?.toLowerCase();
    const dir = q.order === 'desc' ? -1 : 1;
    return [...this.s.appointments.values()]
      .filter((a) => ws.has(a.workspaceId))
      .filter(
        (a) =>
          a.createdByUserId === q.viewerUserId ||
          a.visibility === 'WORKSPACE' ||
          (a.visibility === 'SELECTED' && granted.has(a.id)),
      )
      .filter((a) => overlaps(a, q.from, q.to))
      .filter((a) => !q.statuses || q.statuses.includes(a.status))
      .filter((a) => !q.categories || q.categories.includes(a.category))
      .filter(
        (a) =>
          !t || a.title.toLowerCase().includes(t) || (a.location ?? '').toLowerCase().includes(t),
      )
      .sort(
        (a, b) =>
          dir *
          (a.startDate.localeCompare(b.startDate) ||
            (a.startAt?.getTime() ?? 0) - (b.startAt?.getTime() ?? 0) ||
            a.id.localeCompare(b.id)),
      )
      .slice(q.offset ?? 0, (q.offset ?? 0) + q.limit)
      .map(clone);
  }
  async getAppointmentBundles(ids: string[]) {
    return ids
      .map((id) => this.s.appointments.get(id))
      .filter((a): a is AppointmentRow => !!a)
      .map((a) => this.bundle(a));
  }
  async appendAppointmentEvent(row: AppointmentEventRow) {
    this.s.events.push(clone(row));
  }
  async listAppointmentEvents(appointmentId: string, limit: number) {
    return this.s.events
      .filter((e) => e.appointmentId === appointmentId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map(clone);
  }

  // ───────── idempotency
  async getIdempotency(userId: string, scope: string, key: string) {
    for (const r of this.s.idem.values())
      if (r.userId === userId && r.scope === scope && r.key === key) return clone(r);
    return null;
  }
  async createIdempotency(row: IdempotencyRow) {
    if (await this.getIdempotency(row.userId, row.scope, row.key))
      throw new StoreConflictError('idempotency');
    this.s.idem.set(row.id, clone(row));
  }
  async purgeIdempotency(now: Date) {
    let n = 0;
    for (const [k, v] of this.s.idem) {
      if (v.expiresAt <= now) {
        this.s.idem.delete(k);
        n += 1;
      }
    }
    return n;
  }

  // ───────── preferences
  async getPreference(userId: string) {
    const p = this.s.prefs.get(userId);
    return p ? clone(p) : null;
  }
  async upsertPreference(row: PreferenceRow) {
    this.s.prefs.set(row.userId, clone(row));
  }

  // ───────── audit
  async appendAudit(row: AuditRow) {
    this.s.audit.push(clone(row));
  }
  async listAudit(q: {
    workspaceId?: string;
    resourceTypes?: string[];
    limit: number;
    offset?: number;
  }) {
    return this.s.audit
      .filter(
        (a) =>
          (!q.workspaceId || a.workspaceId === q.workspaceId) &&
          (!q.resourceTypes || q.resourceTypes.includes(a.resourceType)),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(q.offset ?? 0, (q.offset ?? 0) + q.limit)
      .map(clone);
  }
}

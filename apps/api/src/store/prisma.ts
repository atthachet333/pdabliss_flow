/**
 * MariaDB Store (Prisma 7 + @prisma/adapter-mariadb). See store/types.ts for the contract.
 *
 * - Every pool connection runs `SET time_zone = '+00:00'`; DATETIME values are UTC.
 * - DATE columns are mapped to/from "YYYY-MM-DD" without any time-zone arithmetic.
 * - Unique/foreign-key violations become StoreConflictError (no driver details leak).
 * - The appointment visibility predicate lives in ONE place: visibleWhere().
 */
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import {
  type Appointment as PAppointment,
  type AuditLog as PAuditLog,
  type Invitation as PInvitation,
  Prisma,
  PrismaClient,
  type Session as PSession,
} from '../generated/prisma/client.js';
import { type DbPurpose, assertDatabaseTarget } from '../db/guard.js';
import { assertFailClosedWhere } from './fail-closed.js';
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
  StoreTransactionConflictError,
  type UserRow,
  type WebhookEventRow,
  type WorkspaceRow,
} from './types.js';

type Db = PrismaClient | Prisma.TransactionClient;

const bytes = (b: Uint8Array): Uint8Array<ArrayBuffer> => Uint8Array.from(b);
const toDate = (d: string): Date => new Date(`${d}T00:00:00.000Z`);
const fromDate = (d: Date): string => d.toISOString().slice(0, 10);

function conflict(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') throw new StoreConflictError('unique');
    if (err.code === 'P2003') throw new StoreConflictError('foreign-key');
  }
  throw err;
}

async function guarded<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (err) {
    return conflict(err);
  }
}

function mapAppointment(a: PAppointment): AppointmentRow {
  return {
    id: a.id,
    workspaceId: a.workspaceId,
    createdByUserId: a.createdByUserId,
    title: a.title,
    category: a.category,
    allDay: a.allDay,
    timeZone: a.timeZone,
    startDate: fromDate(a.startDate),
    endDate: fromDate(a.endDate),
    startAt: a.startAt,
    endAt: a.endAt,
    location: a.location,
    notes: a.notes,
    visibility: a.visibility,
    status: a.status,
    version: a.version,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    cancelledAt: a.cancelledAt,
    cancelledByUserId: a.cancelledByUserId,
  };
}

function appointmentData(a: AppointmentRow) {
  return {
    ...a,
    startDate: toDate(a.startDate),
    endDate: toDate(a.endDate),
  };
}

const bundleInclude = {
  accessGrants: true,
  destinations: true,
  reminderRules: { orderBy: { position: 'asc' as const } },
} satisfies Prisma.AppointmentInclude;

function mapBundle(
  a: Prisma.AppointmentGetPayload<{ include: typeof bundleInclude }>,
): AppointmentBundle {
  return {
    appointment: mapAppointment(a),
    accessGrants: a.accessGrants,
    destinations: a.destinations,
    reminderRules: a.reminderRules,
  };
}

const mapSession = (s: PSession): SessionRow => ({ ...s, keyHash: s.keyHash });
const mapInvitation = (i: PInvitation): InvitationRow => ({ ...i, tokenHash: i.tokenHash });
const mapAudit = (a: PAuditLog): AuditRow => ({
  ...a,
  metadata: (a.metadata as Record<string, unknown> | null) ?? null,
});

export function createPrismaClient(url: string | undefined, purpose: DbPurpose): PrismaClient {
  const t = assertDatabaseTarget(url, purpose);
  const adapter = new PrismaMariaDb({
    host: t.host === 'localhost' ? '127.0.0.1' : t.host,
    port: t.port,
    user: t.user,
    password: t.password,
    database: t.database,
    connectionLimit: purpose === 'test' ? 4 : 8,
    connectTimeout: 5000,
    acquireTimeout: 10000,
    initSql: "SET time_zone = '+00:00'",
  });
  // Every model operation is checked: a `where` containing an explicit undefined (which Prisma
  // would silently drop, matching every row) is refused before reaching MariaDB.
  return new PrismaClient({ adapter }).$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          assertFailClosedWhere(model, operation, args);
          return query(args);
        },
      },
    },
  }) as unknown as PrismaClient;
}

export class PrismaStore implements Store {
  constructor(
    private readonly root: PrismaClient,
    private readonly db: Db = root,
    private readonly nested = false,
  ) {}

  async transaction<T>(fn: (tx: Store) => Promise<T>): Promise<T> {
    if (this.nested) return fn(this);
    try {
      return await this.root.$transaction((tx) => fn(new PrismaStore(this.root, tx, true)), {
        maxWait: 5000,
        timeout: 15000,
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        const adapter = err.meta?.driverAdapterError as
          { cause?: { originalCode?: string } } | undefined;
        // MariaDB ER_CHECKREAD (1020) is exposed by Prisma as a generic external error.
        if (
          err.code === 'P2034' ||
          (err.code === 'P2039' && adapter?.cause?.originalCode === '1020')
        )
          throw new StoreTransactionConflictError();
      }
      throw err;
    }
  }

  /**
   * Start-up check: the live connection must be the expected database with a UTC session.
   * Throws (server refuses to start) instead of running against anything else.
   */
  async verifyConnection(expectedDatabase: string): Promise<void> {
    const [row] = await this.root.$queryRawUnsafe<{ db: string | null; tz: string }[]>(
      'SELECT DATABASE() AS db, @@session.time_zone AS tz',
    );
    if (row?.db !== expectedDatabase)
      throw new Error(`Connected database is not ${expectedDatabase}`);
    if (row.tz !== '+00:00') throw new Error('Database session time zone is not UTC');
  }

  async close(): Promise<void> {
    if (!this.nested) await this.root.$disconnect();
  }

  /** The one and only appointment visibility predicate (see docs/EP02-PERMISSION-MATRIX.md). */
  private visibleWhere(viewerUserId: string, workspaceIds: string[]): Prisma.AppointmentWhereInput {
    if (!viewerUserId || !Array.isArray(workspaceIds))
      throw new Error('visibleWhere requires a viewer and workspace scope');
    return {
      workspaceId: { in: workspaceIds },
      OR: [
        { createdByUserId: viewerUserId },
        { visibility: 'WORKSPACE' },
        { visibility: 'SELECTED', accessGrants: { some: { userId: viewerUserId } } },
      ],
    };
  }

  // ───────── users & identities
  async findIdentityByLineUserId(lineUserId: string) {
    const i = await this.db.lineIdentity.findUnique({
      where: { lineUserId },
      include: { user: true },
    });
    if (!i) return null;
    const { user, ...identity } = i;
    return { identity, user };
  }
  async getIdentityByUserId(userId: string) {
    return this.db.lineIdentity.findUnique({ where: { userId } });
  }
  async createUserWithIdentity(user: UserRow, identity: LineIdentityRow) {
    const { userId: _userId, ...ident } = identity;
    await guarded(this.db.user.create({ data: { ...user, lineIdentity: { create: ident } } }));
  }
  async updateIdentityVerifiedAt(userId: string, at: Date) {
    await this.db.lineIdentity.updateMany({ where: { userId }, data: { lastVerifiedAt: at } });
  }
  async getUser(id: string) {
    return this.db.user.findUnique({ where: { id } });
  }
  async getUsers(ids: string[]) {
    if (!ids.length) return [];
    return this.db.user.findMany({ where: { id: { in: ids } } });
  }
  async updateUser(
    id: string,
    patch: Partial<
      Pick<UserRow, 'displayName' | 'status' | 'globalRole' | 'lastLoginAt' | 'statusChangedAt'>
    >,
    opts: { now: Date; expectAuthzVersion?: number; bumpAuthz?: boolean },
  ) {
    const n = await this.db.user.updateMany({
      where: {
        id,
        ...(opts.expectAuthzVersion !== undefined ? { authzVersion: opts.expectAuthzVersion } : {}),
      },
      data: {
        ...patch,
        updatedAt: opts.now,
        ...(opts.bumpAuthz ? { authzVersion: { increment: 1 } } : {}),
      },
    });
    return n.count === 1 ? this.getUser(id) : null;
  }
  async listUsers(q: {
    statuses?: UserRow['status'][];
    text?: string;
    limit: number;
    offset?: number;
  }) {
    return this.db.user.findMany({
      where: {
        ...(q.statuses ? { status: { in: q.statuses } } : {}),
        ...(q.text ? { displayName: { contains: q.text } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: q.limit,
      skip: q.offset ?? 0,
    });
  }
  async countUsers(q: { statuses?: UserRow['status'][]; globalRoles?: UserRow['globalRole'][] }) {
    return this.db.user.count({
      where: {
        ...(q.statuses ? { status: { in: q.statuses } } : {}),
        ...(q.globalRoles ? { globalRole: { in: q.globalRoles } } : {}),
      },
    });
  }

  // ───────── sessions
  async createSession(row: SessionRow) {
    await guarded(this.db.session.create({ data: { ...row, keyHash: bytes(row.keyHash) } }));
  }
  async getSessionByKeyHash(keyHash: Uint8Array) {
    const s = await this.db.session.findUnique({ where: { keyHash: bytes(keyHash) } });
    return s ? mapSession(s) : null;
  }
  async touchSession(id: string, at: Date) {
    await this.db.session.updateMany({ where: { id, endedAt: null }, data: { lastSeenAt: at } });
  }
  async endSession(id: string, reason: NonNullable<SessionRow['endReason']>, at: Date) {
    const n = await this.db.session.updateMany({
      where: { id, endedAt: null },
      data: { endedAt: at, endReason: reason },
    });
    return n.count === 1;
  }
  async endUserSessions(userId: string, reason: NonNullable<SessionRow['endReason']>, at: Date) {
    const n = await this.db.session.updateMany({
      where: { userId, endedAt: null },
      data: { endedAt: at, endReason: reason },
    });
    return n.count;
  }
  async purgeSessions(before: Date) {
    const n = await this.db.session.deleteMany({
      where: { OR: [{ endedAt: { lt: before } }, { absoluteExpiresAt: { lt: before } }] },
    });
    return n.count;
  }

  // ───────── rate limits (single atomic statement; window resets inside MariaDB)
  async hitRateLimit(keyHash: Uint8Array, windowMs: number, now: Date) {
    const k = Buffer.from(keyHash);
    const end = new Date(now.getTime() + windowMs);
    const run = async (db: Db) => {
      await db.$executeRaw`INSERT INTO rate_limit_buckets (keyHash, count, windowEnd) VALUES (${k}, 1, ${end})
        ON DUPLICATE KEY UPDATE
          count = IF(windowEnd <= ${now}, 1, count + 1),
          windowEnd = IF(windowEnd <= ${now}, ${end}, windowEnd)`;
      const row = await db.rateLimitBucket.findUnique({ where: { keyHash: bytes(keyHash) } });
      return { count: row?.count ?? 1, windowEnd: row?.windowEnd ?? end };
    };
    return this.nested ? run(this.db) : this.root.$transaction((tx) => run(tx));
  }
  async purgeRateLimits(now: Date) {
    return (await this.db.rateLimitBucket.deleteMany({ where: { windowEnd: { lte: now } } })).count;
  }

  // ───────── webhook
  async recordWebhookEvent(row: WebhookEventRow) {
    const n = await this.db.webhookEvent.createMany({ data: [row], skipDuplicates: true });
    return n.count === 1 ? ('new' as const) : ('duplicate' as const);
  }
  async purgeWebhookEvents(now: Date) {
    return (await this.db.webhookEvent.deleteMany({ where: { expiresAt: { lte: now } } })).count;
  }
  async purgeIdempotency(now: Date) {
    return (await this.db.idempotencyRecord.deleteMany({ where: { expiresAt: { lte: now } } }))
      .count;
  }

  // ───────── access requests
  async createAccessRequest(row: AccessRequestRow) {
    await guarded(
      this.db.accessRequest.create({
        data: { ...row, openKey: row.status === 'PENDING' ? row.userId : null },
      }),
    );
  }
  async getAccessRequest(id: string) {
    return this.db.accessRequest.findUnique({ where: { id }, omit: { openKey: true } });
  }
  async getOpenAccessRequest(userId: string) {
    return this.db.accessRequest.findUnique({
      where: { openKey: userId },
      omit: { openKey: true },
    });
  }
  async listAccessRequests(q: {
    statuses?: AccessRequestRow['status'][];
    userId?: string;
    limit: number;
  }) {
    return this.db.accessRequest.findMany({
      where: {
        ...(q.statuses ? { status: { in: q.statuses } } : {}),
        ...(q.userId ? { userId: q.userId } : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: q.limit,
      omit: { openKey: true },
    });
  }
  async countAccessRequests(q: { statuses?: AccessRequestRow['status'][] }) {
    return this.db.accessRequest.count({ where: q.statuses ? { status: { in: q.statuses } } : {} });
  }
  async decideAccessRequest(
    id: string,
    status: Exclude<AccessRequestRow['status'], 'PENDING'>,
    by: string | null,
    at: Date,
  ) {
    const n = await this.db.accessRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: { status, decidedAt: at, decidedByUserId: by, openKey: null },
    });
    return n.count === 1;
  }

  // ───────── invitations
  async createInvitation(row: InvitationRow) {
    await guarded(this.db.invitation.create({ data: { ...row, tokenHash: bytes(row.tokenHash) } }));
  }
  async getInvitation(id: string) {
    const i = await this.db.invitation.findUnique({ where: { id } });
    return i ? mapInvitation(i) : null;
  }
  async getInvitationByTokenHash(hash: Uint8Array) {
    const i = await this.db.invitation.findUnique({ where: { tokenHash: bytes(hash) } });
    return i ? mapInvitation(i) : null;
  }
  async listInvitations(q: { workspaceId?: string; limit: number }) {
    const rows = await this.db.invitation.findMany({
      where: q.workspaceId ? { workspaceId: q.workspaceId } : {},
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: q.limit,
    });
    return rows.map(mapInvitation);
  }
  async redeemInvitation(id: string, userId: string, now: Date) {
    const n = await this.db.invitation.updateMany({
      where: { id, status: 'ACTIVE', expiresAt: { gt: now } },
      data: { status: 'REDEEMED', redeemedByUserId: userId, redeemedAt: now },
    });
    return n.count === 1;
  }
  async revokeInvitation(id: string, now: Date) {
    const n = await this.db.invitation.updateMany({
      where: { id, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: now },
    });
    return n.count === 1;
  }

  // ───────── workspaces & members
  async createWorkspace(row: WorkspaceRow) {
    await guarded(this.db.workspace.create({ data: row }));
  }
  async getWorkspace(id: string) {
    return this.db.workspace.findUnique({ where: { id } });
  }
  async getPersonalWorkspace(userId: string) {
    return this.db.workspace.findUnique({ where: { personalOwnerId: userId } });
  }
  async listWorkspaces(q: { ids?: string[]; statuses?: WorkspaceRow['status'][]; limit: number }) {
    return this.db.workspace.findMany({
      where: {
        ...(q.ids ? { id: { in: q.ids } } : {}),
        ...(q.statuses ? { status: { in: q.statuses } } : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: q.limit,
    });
  }
  async updateWorkspace(
    id: string,
    expectedVersion: number,
    patch: Partial<Pick<WorkspaceRow, 'name' | 'kind' | 'status' | 'archivedAt'>>,
    now: Date,
  ) {
    const n = await this.db.workspace.updateMany({
      where: { id, version: expectedVersion },
      data: { ...patch, updatedAt: now, version: { increment: 1 } },
    });
    return n.count === 1 ? this.getWorkspace(id) : null;
  }
  async upsertMember(row: MemberRow) {
    return guarded(
      this.db.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId: row.workspaceId, userId: row.userId } },
        create: row,
        update: {
          role: row.role,
          status: row.status,
          updatedAt: row.updatedAt,
          addedByUserId: row.addedByUserId,
        },
      }),
    );
  }
  async getMember(workspaceId: string, userId: string) {
    return this.db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
  }
  async listMembers(workspaceId: string, statuses?: MemberRow['status'][]) {
    return this.db.workspaceMember.findMany({
      where: { workspaceId, ...(statuses ? { status: { in: statuses } } : {}) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }
  async listMembershipsForUser(userId: string, statuses?: MemberRow['status'][]) {
    return this.db.workspaceMember.findMany({
      where: { userId, ...(statuses ? { status: { in: statuses } } : {}) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }
  async updateMember(
    workspaceId: string,
    userId: string,
    patch: Partial<Pick<MemberRow, 'role' | 'status'>>,
    now: Date,
  ) {
    const n = await this.db.workspaceMember.updateMany({
      where: { workspaceId, userId },
      data: { ...patch, updatedAt: now },
    });
    return n.count === 1 ? this.getMember(workspaceId, userId) : null;
  }

  // ───────── destinations
  async getDestination(id: string) {
    return this.db.lineDestination.findUnique({ where: { id } });
  }
  async getDestinationByTarget(lineTargetId: string) {
    return this.db.lineDestination.findUnique({ where: { lineTargetId } });
  }
  async getPrivateDestination(userId: string) {
    return this.db.lineDestination.findUnique({ where: { userId } });
  }
  async createDestination(row: DestinationRow) {
    await guarded(this.db.lineDestination.create({ data: row }));
  }
  async updateDestination(
    id: string,
    patch: Partial<
      Pick<DestinationRow, 'label' | 'status' | 'workspaceId' | 'audienceSize' | 'lastEventAt'>
    >,
    now: Date,
  ) {
    const n = await this.db.lineDestination.updateMany({
      where: { id },
      data: { ...patch, updatedAt: now },
    });
    return n.count === 1 ? this.getDestination(id) : null;
  }
  async listDestinations(q: {
    ids?: string[];
    statuses?: DestinationRow['status'][];
    kinds?: DestinationRow['kind'][];
    workspaceIds?: string[];
    limit: number;
  }) {
    return this.db.lineDestination.findMany({
      where: {
        ...(q.ids ? { id: { in: q.ids } } : {}),
        ...(q.statuses ? { status: { in: q.statuses } } : {}),
        ...(q.kinds ? { kind: { in: q.kinds } } : {}),
        ...(q.workspaceIds ? { workspaceId: { in: q.workspaceIds } } : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: q.limit,
    });
  }
  async createDestinationGrant(row: DestinationGrantRow) {
    await guarded(this.db.destinationGrant.create({ data: row }));
  }
  async deleteDestinationGrant(destinationId: string, userId: string) {
    const n = await this.db.destinationGrant.deleteMany({ where: { destinationId, userId } });
    return n.count > 0;
  }
  async listDestinationGrants(q: { destinationId?: string; userId?: string }) {
    return this.db.destinationGrant.findMany({
      where: {
        ...(q.destinationId ? { destinationId: q.destinationId } : {}),
        ...(q.userId ? { userId: q.userId } : {}),
      },
    });
  }

  // ───────── appointments
  private async replaceChildren(id: string, b: Partial<Omit<AppointmentBundle, 'appointment'>>) {
    if (b.accessGrants) {
      await this.db.appointmentAccess.deleteMany({ where: { appointmentId: id } });
      if (b.accessGrants.length)
        await guarded(this.db.appointmentAccess.createMany({ data: b.accessGrants }));
    }
    if (b.destinations) {
      await this.db.appointmentDestination.deleteMany({ where: { appointmentId: id } });
      if (b.destinations.length)
        await guarded(this.db.appointmentDestination.createMany({ data: b.destinations }));
    }
    if (b.reminderRules) {
      await this.db.reminderRule.deleteMany({ where: { appointmentId: id } });
      if (b.reminderRules.length)
        await guarded(this.db.reminderRule.createMany({ data: b.reminderRules }));
    }
  }
  async createAppointment(b: AppointmentBundle) {
    await guarded(this.db.appointment.create({ data: appointmentData(b.appointment) }));
    await this.replaceChildren(b.appointment.id, b);
  }
  async getAppointment(id: string) {
    const a = await this.db.appointment.findUnique({ where: { id }, include: bundleInclude });
    return a ? mapBundle(a) : null;
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
    const { id: _id, version: _v, ...rest } = appointmentData(next.appointment);
    const n = await this.db.appointment.updateMany({
      where: { id, version: expectedVersion },
      data: { ...rest, version: expectedVersion + 1 },
    });
    if (n.count !== 1) return false;
    await this.replaceChildren(id, next);
    return true;
  }
  async listAppointments(q: AppointmentQuery) {
    const and: Prisma.AppointmentWhereInput[] = [this.visibleWhere(q.viewerUserId, q.workspaceIds)];
    if (q.from) and.push({ endDate: { gte: toDate(q.from) } });
    if (q.to) and.push({ startDate: { lte: toDate(q.to) } });
    if (q.statuses) and.push({ status: { in: q.statuses } });
    if (q.categories) and.push({ category: { in: q.categories } });
    if (q.text)
      and.push({ OR: [{ title: { contains: q.text } }, { location: { contains: q.text } }] });
    const dir = q.order === 'desc' ? 'desc' : 'asc';
    const rows = await this.db.appointment.findMany({
      where: { AND: and },
      orderBy: [{ startDate: dir }, { startAt: dir }, { id: dir }],
      take: q.limit,
      skip: q.offset ?? 0,
    });
    return rows.map(mapAppointment);
  }
  async getAppointmentBundles(ids: string[]) {
    if (!ids.length) return [];
    const rows = await this.db.appointment.findMany({
      where: { id: { in: ids } },
      include: bundleInclude,
    });
    const byId = new Map(rows.map((r) => [r.id, mapBundle(r)]));
    return ids.map((id) => byId.get(id)).filter((b): b is AppointmentBundle => !!b);
  }
  async appendAppointmentEvent(row: AppointmentEventRow) {
    await this.db.appointmentEvent.create({
      data: { ...row, fields: row.fields === null ? Prisma.DbNull : row.fields },
    });
  }
  async listAppointmentEvents(appointmentId: string, limit: number) {
    const rows = await this.db.appointmentEvent.findMany({
      where: { appointmentId },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: limit,
    });
    return rows.map((r) => ({ ...r, fields: (r.fields as string[] | null) ?? null }));
  }

  // ───────── idempotency
  async getIdempotency(userId: string, scope: string, key: string) {
    return this.db.idempotencyRecord.findUnique({
      where: { userId_scope_key: { userId, scope, key } },
    });
  }
  async createIdempotency(row: IdempotencyRow) {
    await guarded(this.db.idempotencyRecord.create({ data: row }));
  }

  // ───────── preferences
  async getPreference(userId: string) {
    const p = await this.db.userPreference.findUnique({ where: { userId } });
    return p ? { ...p, defaultReminders: p.defaultReminders ?? null } : null;
  }
  async upsertPreference(row: PreferenceRow) {
    const data = {
      ...row,
      defaultReminders:
        row.defaultReminders === null || row.defaultReminders === undefined
          ? Prisma.DbNull
          : (row.defaultReminders as Prisma.InputJsonValue),
    };
    await this.db.userPreference.upsert({
      where: { userId: row.userId },
      create: data,
      update: data,
    });
  }

  // ───────── audit
  async appendAudit(row: AuditRow) {
    await this.db.auditLog.create({
      data: {
        ...row,
        metadata: row.metadata === null ? Prisma.DbNull : (row.metadata as Prisma.InputJsonValue),
      },
    });
  }
  async listAudit(q: {
    workspaceId?: string;
    resourceTypes?: string[];
    limit: number;
    offset?: number;
  }) {
    const rows = await this.db.auditLog.findMany({
      where: {
        ...(q.workspaceId ? { workspaceId: q.workspaceId } : {}),
        ...(q.resourceTypes ? { resourceType: { in: q.resourceTypes } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: q.limit,
      skip: q.offset ?? 0,
    });
    return rows.map(mapAudit);
  }
}

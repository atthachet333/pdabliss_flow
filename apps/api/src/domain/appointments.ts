/**
 * Appointments (EP02): CRUD, visibility, destinations, multi-stage reminders, previews and
 * every read model (Today, Calendar, History, Search). All reads go through
 * Store.listAppointments (one visibility predicate) or canViewAppointment.
 *
 * Time semantics (docs/EP02-ARCHITECTURE.md §Time):
 *  - timed: startAt/endAt are UTC instants computed from local date+time in `timeZone`;
 *    startDate/endDate are the local calendar dates of those instants;
 *  - all-day: no instants; startDate..endDate are calendar dates (never converted via UTC);
 *  - no business rule depends on the server's, browser's or database's local zone.
 */
import {
  type AppointmentDetailDto,
  type AppointmentInput,
  type AppointmentSummaryDto,
  type CategoryId,
  type ReminderDto,
  type ReminderRuleDto,
  MAX_ALL_DAY_SPAN_DAYS,
  addDaysToLocalDate,
  buildReminderPreview,
  calculateReminders,
  reminderLabelTh,
  estimateQuota,
  toFlexMessage,
  toLocalDateString,
  toLocalTimeString,
  validateFlexMessage,
  zonedLocalToUtc,
} from '@flow/shared';
import { type Clock, ApiError, badRequest, conflictError, newId, notFound } from '../core/context.js';
import {
  type AppointmentBundle,
  type AppointmentEventType,
  type AppointmentRow,
  type ContentPolicy,
  type DestinationRow,
  type ReminderRuleRow,
  type Store,
  StoreConflictError,
} from '../store/types.js';
import { audit } from './audit.js';
import {
  type Actor,
  activeWorkspaceIds,
  canEditAppointment,
  canInWorkspace,
  canViewAppointment,
  decideDestination,
} from './policy.js';

export const IDEMPOTENCY_SCOPE_CREATE = 'appointment.create';
const IDEMPOTENCY_TTL_MS = 24 * 3_600_000;
const MAX_RANGE_DAYS = 62;
const YEARS_WINDOW = 5;

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

interface Timing {
  allDay: boolean;
  timeZone: string;
  startDate: string;
  endDate: string;
  startAt: Date | null;
  endAt: Date | null;
  startTime: string | null;
}

export function computeTiming(input: AppointmentInput, now: Date): Timing {
  if (!isValidTimeZone(input.timeZone)) throw badRequest('INVALID_TIMEZONE');
  const today = toLocalDateString(now, input.timeZone);
  if (Math.abs(daysBetween(today, input.date)) > YEARS_WINDOW * 366) throw badRequest('DATE_OUT_OF_RANGE');
  if (input.allDay) {
    const endDate = input.endDate ?? input.date;
    const span = daysBetween(input.date, endDate);
    if (span < 0) throw badRequest('END_BEFORE_START');
    if (span >= MAX_ALL_DAY_SPAN_DAYS) throw badRequest('SPAN_TOO_LONG');
    return { allDay: true, timeZone: input.timeZone, startDate: input.date, endDate, startAt: null, endAt: null, startTime: null };
  }
  const startTime = input.startTime as string;
  const startAt = zonedLocalToUtc(input.date, startTime, input.timeZone);
  let endAt: Date | null = null;
  if (input.endTime) {
    endAt = zonedLocalToUtc(input.endDate ?? input.date, input.endTime, input.timeZone);
    if (endAt.getTime() <= startAt.getTime()) throw badRequest('END_BEFORE_START');
    if (endAt.getTime() - startAt.getTime() > MAX_ALL_DAY_SPAN_DAYS * 86_400_000) throw badRequest('SPAN_TOO_LONG');
  } else if (input.endDate && input.endDate !== input.date) {
    throw badRequest('END_TIME_REQUIRED');
  }
  return {
    allDay: false,
    timeZone: input.timeZone,
    startDate: input.date,
    endDate: endAt ? toLocalDateString(endAt, input.timeZone) : input.date,
    startAt,
    endAt,
    startTime,
  };
}

const ruleInputs = (rules: ReminderRuleDto[]) =>
  rules.map((r) =>
    r.kind === 'RELATIVE'
      ? { kind: 'RELATIVE' as const, offsetMinutes: r.offsetMinutes, enabled: r.enabled }
      : { kind: 'CALENDAR' as const, dayOffset: r.dayOffset, localTime: r.localTime, enabled: r.enabled },
  );

export function buildReminderRows(
  appointmentId: string,
  timing: Pick<Timing, 'allDay' | 'startDate' | 'startTime' | 'timeZone'>,
  rules: ReminderRuleDto[],
  cancelled: boolean,
  now: Date,
): ReminderRuleRow[] {
  const calc = calculateReminders(
    { allDay: timing.allDay, localDate: timing.startDate, localTime: timing.startTime, timeZone: timing.timeZone, cancelled },
    ruleInputs(rules),
    now,
  );
  if (!calc.valid) {
    const issues = calc.reminders.filter((r) => r.issue).map((r) => ({ index: r.index, issue: r.issue }));
    throw badRequest('INVALID_REMINDERS', { reminders: issues });
  }
  return calc.reminders.map((c, i) => {
    const r = rules[i] as ReminderRuleDto;
    return {
      id: newId(),
      appointmentId,
      ruleVersion: 1,
      kind: r.kind,
      offsetMinutes: r.kind === 'RELATIVE' ? r.offsetMinutes : null,
      dayOffset: r.kind === 'CALENDAR' ? r.dayOffset : null,
      localTime: r.kind === 'CALENDAR' ? r.localTime : null,
      enabled: r.enabled,
      position: i,
      fireAt: c.fireAt,
      status: c.status,
      calculatedAt: now,
    };
  });
}

function rulesFromRows(rows: ReminderRuleRow[]): ReminderRuleDto[] {
  return rows.map((r) =>
    r.kind === 'RELATIVE'
      ? { kind: 'RELATIVE', offsetMinutes: r.offsetMinutes ?? 0, enabled: r.enabled }
      : { kind: 'CALENDAR', dayOffset: r.dayOffset ?? 0, localTime: r.localTime ?? '06:00', enabled: r.enabled },
  );
}

export class AppointmentService {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
    private readonly publicBaseUrl: string | null,
  ) {}

  // ───────────────────────── validation shared by create/update

  private async validateAudience(
    actor: Actor,
    creatorId: string,
    input: AppointmentInput,
    store: Store,
  ): Promise<{ destinations: { row: DestinationRow; policy: ContentPolicy }[] }> {
    const members = new Map(
      (await store.listMembers(input.workspaceId, ['ACTIVE'])).map((m) => [m.userId, m]),
    );
    const activeUsers = new Set(
      (await store.getUsers([...members.keys()])).filter((u) => u.status === 'ACTIVE').map((u) => u.id),
    );
    for (const uid of input.sharedWithUserIds) {
      if (uid === creatorId || !members.has(uid) || !activeUsers.has(uid))
        throw badRequest('INVALID_SHARED_USER');
    }
    const ids = input.destinations.map((d) => d.destinationId);
    const rows = ids.length ? await store.listDestinations({ ids, limit: ids.length }) : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const grants = new Set(
      (await store.listDestinationGrants({ userId: actor.user.id })).map((g) => g.destinationId),
    );
    const out: { row: DestinationRow; policy: ContentPolicy }[] = [];
    for (const d of input.destinations) {
      const row = byId.get(d.destinationId);
      // Unknown and forbidden ids are indistinguishable to the caller (no enumeration).
      if (!row) throw badRequest('DESTINATION_NOT_PERMITTED');
      const decision = decideDestination(actor, row, {
        workspaceId: input.workspaceId,
        creatorId,
        visibility: input.visibility,
        grantedUserIds: input.sharedWithUserIds,
        category: input.category,
        contentPolicy: d.contentPolicy,
        confirmSensitive: input.confirmSensitive,
        recipientIsActiveMember: row.userId ? members.has(row.userId) && activeUsers.has(row.userId) : false,
        actorHasGrant: grants.has(row.id),
      });
      if (!decision.ok) throw badRequest(decision.code === 'DESTINATION_UNAVAILABLE' ? 'DESTINATION_NOT_PERMITTED' : decision.code);
      out.push({ row, policy: d.contentPolicy });
    }
    return { destinations: out };
  }

  private bundleFrom(
    id: string,
    actor: Actor,
    input: AppointmentInput,
    timing: Timing,
    destinations: { row: DestinationRow; policy: ContentPolicy }[],
    base: Pick<AppointmentRow, 'createdAt' | 'version' | 'createdByUserId'> | null,
    now: Date,
  ): AppointmentBundle {
    const appointment: AppointmentRow = {
      id,
      workspaceId: input.workspaceId,
      createdByUserId: base?.createdByUserId ?? actor.user.id,
      title: input.title,
      category: input.category,
      allDay: timing.allDay,
      timeZone: timing.timeZone,
      startDate: timing.startDate,
      endDate: timing.endDate,
      startAt: timing.startAt,
      endAt: timing.endAt,
      location: input.location ?? null,
      notes: input.notes ?? null,
      visibility: input.visibility,
      status: 'SCHEDULED',
      version: base?.version ?? 1,
      createdAt: base?.createdAt ?? now,
      updatedAt: now,
      cancelledAt: null,
      cancelledByUserId: null,
    };
    return {
      appointment,
      accessGrants: (input.visibility === 'SELECTED' ? input.sharedWithUserIds : []).map((userId) => ({
        id: newId(),
        appointmentId: id,
        userId,
        createdAt: now,
      })),
      destinations: destinations.map((d) => ({
        id: newId(),
        appointmentId: id,
        destinationId: d.row.id,
        contentPolicy: d.policy,
        createdAt: now,
      })),
      reminderRules: buildReminderRows(id, timing, input.reminders, false, now),
    };
  }

  // ───────────────────────── commands

  async create(actor: Actor, input: AppointmentInput, idempotencyKey: string): Promise<{ id: string; replayed: boolean }> {
    if (!canInWorkspace(actor, 'appointment.create', input.workspaceId)) throw badRequest('WORKSPACE_NOT_PERMITTED');
    const now = this.clock();
    const timing = computeTiming(input, now);
    const existing = await this.store.getIdempotency(actor.user.id, IDEMPOTENCY_SCOPE_CREATE, idempotencyKey);
    if (existing?.resultId) return { id: existing.resultId, replayed: true };
    try {
      return await this.store.transaction(async (tx) => {
        const { destinations } = await this.validateAudience(actor, actor.user.id, input, tx);
        const id = newId();
        const bundle = this.bundleFrom(id, actor, input, timing, destinations, null, now);
        await tx.createAppointment(bundle);
        // Claim the key in the same transaction: a concurrent duplicate fails on the unique
        // (userId, scope, key) constraint and its whole transaction rolls back.
        await tx.createIdempotency({
          id: newId(),
          userId: actor.user.id,
          scope: IDEMPOTENCY_SCOPE_CREATE,
          key: idempotencyKey,
          resultId: id,
          createdAt: now,
          expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
        });
        await tx.appendAppointmentEvent({ id: newId(), appointmentId: id, actorUserId: actor.user.id, type: 'CREATED', fields: null, createdAt: now });
        await audit(tx, {
          actorUserId: actor.user.id,
          action: 'appointment.created',
          resourceType: 'appointment',
          resourceId: id,
          workspaceId: input.workspaceId,
          meta: { visibility: input.visibility, count: bundle.reminderRules.length },
          at: now,
        });
        return { id, replayed: false };
      });
    } catch (err) {
      if (err instanceof StoreConflictError) {
        const again = await this.store.getIdempotency(actor.user.id, IDEMPOTENCY_SCOPE_CREATE, idempotencyKey);
        if (again?.resultId) return { id: again.resultId, replayed: true };
        throw conflictError('REQUEST_IN_PROGRESS', 'This appointment is already being saved');
      }
      throw err;
    }
  }

  async update(actor: Actor, id: string, version: number, input: AppointmentInput): Promise<void> {
    const now = this.clock();
    await this.store.transaction(async (tx) => {
      const current = await tx.getAppointment(id);
      if (!current || !canViewAppointment(actor, current)) throw notFound();
      if (!canEditAppointment(actor, current)) throw new ApiError(403, 'FORBIDDEN', 'Not permitted');
      if (current.appointment.status === 'CANCELLED') throw conflictError('APPOINTMENT_CANCELLED', 'Cancelled appointments cannot be edited');
      if (input.workspaceId !== current.appointment.workspaceId) throw badRequest('WORKSPACE_IMMUTABLE');
      if (current.appointment.version !== version) throw conflictError('VERSION_CONFLICT');
      const timing = computeTiming(input, now);
      const creatorId = current.appointment.createdByUserId;
      if (creatorId !== actor.user.id) {
        const prevShared = current.accessGrants.map((g) => g.userId).sort().join();
        const nextShared = [...input.sharedWithUserIds].sort().join();
        if (input.visibility !== current.appointment.visibility || prevShared !== nextShared)
          throw new ApiError(403, 'ONLY_CREATOR_CHANGES_VISIBILITY', 'Only the creator can change who sees this');
      }
      const { destinations } = await this.validateAudience(actor, creatorId, input, tx);
      const next = this.bundleFrom(id, actor, input, timing, destinations, current.appointment, now);
      if (!(await tx.updateAppointment(id, version, next))) throw conflictError('VERSION_CONFLICT');
      const changed = diffFields(current, next);
      const types = eventTypes(changed);
      for (const type of types)
        await tx.appendAppointmentEvent({ id: newId(), appointmentId: id, actorUserId: actor.user.id, type, fields: changed, createdAt: now });
      await audit(tx, {
        actorUserId: actor.user.id,
        action: 'appointment.updated',
        resourceType: 'appointment',
        resourceId: id,
        workspaceId: current.appointment.workspaceId,
        meta: { fields: changed, version: version + 1 },
        at: now,
      });
    });
  }

  async cancel(actor: Actor, id: string, version: number): Promise<void> {
    const now = this.clock();
    await this.store.transaction(async (tx) => {
      const current = await tx.getAppointment(id);
      if (!current || !canViewAppointment(actor, current)) throw notFound();
      if (!canEditAppointment(actor, current)) throw new ApiError(403, 'FORBIDDEN', 'Not permitted');
      if (current.appointment.status === 'CANCELLED') return;
      if (current.appointment.version !== version) throw conflictError('VERSION_CONFLICT');
      const a = current.appointment;
      const ok = await tx.updateAppointment(id, version, {
        appointment: { ...a, status: 'CANCELLED', cancelledAt: now, cancelledByUserId: actor.user.id, updatedAt: now },
        reminderRules: current.reminderRules.map((r) => ({ ...r, status: 'CANCELLED', calculatedAt: now })),
      });
      if (!ok) throw conflictError('VERSION_CONFLICT');
      await tx.appendAppointmentEvent({ id: newId(), appointmentId: id, actorUserId: actor.user.id, type: 'CANCELLED', fields: null, createdAt: now });
      await audit(tx, {
        actorUserId: actor.user.id,
        action: 'appointment.cancelled',
        resourceType: 'appointment',
        resourceId: id,
        workspaceId: a.workspaceId,
        at: now,
      });
    });
  }

  // ───────────────────────── reads

  private async workspaceNames(actor: Actor): Promise<Map<string, { name: string; kind: AppointmentSummaryDto['workspaceKind'] }>> {
    return new Map([...actor.memberships.values()].map((m) => [m.workspace.id, { name: m.workspace.name, kind: m.workspace.kind }]));
  }

  private summary(
    actor: Actor,
    b: AppointmentBundle,
    names: Map<string, { name: string; kind: AppointmentSummaryDto['workspaceKind'] }>,
  ): AppointmentSummaryDto {
    const a = b.appointment;
    const ws = names.get(a.workspaceId);
    return {
      id: a.id,
      workspaceId: a.workspaceId,
      workspaceName: ws?.name ?? '',
      workspaceKind: ws?.kind ?? 'CUSTOM',
      title: a.title,
      category: a.category as CategoryId,
      allDay: a.allDay,
      startDate: a.startDate,
      endDate: a.endDate,
      startAt: a.startAt?.toISOString() ?? null,
      endAt: a.endAt?.toISOString() ?? null,
      timeZone: a.timeZone,
      location: a.location,
      visibility: a.visibility,
      status: a.status,
      mine: a.createdByUserId === actor.user.id,
      scheduledReminders: b.reminderRules.filter((r) => r.status === 'SCHEDULED').length,
    };
  }

  async list(
    actor: Actor,
    q: { from?: string; to?: string; workspaceId?: string; categories?: string[]; statuses?: ('SCHEDULED' | 'CANCELLED')[]; text?: string; order?: 'asc' | 'desc'; limit: number; offset?: number },
  ): Promise<{ items: AppointmentSummaryDto[]; hasMore: boolean }> {
    let workspaceIds = activeWorkspaceIds(actor);
    if (q.workspaceId) workspaceIds = workspaceIds.includes(q.workspaceId) ? [q.workspaceId] : [];
    if (q.from && q.to && daysBetween(q.from, q.to) > MAX_RANGE_DAYS) throw badRequest('RANGE_TOO_LARGE');
    if (!workspaceIds.length) return { items: [], hasMore: false };
    const rows = await this.store.listAppointments({
      viewerUserId: actor.user.id,
      workspaceIds,
      ...(q.from ? { from: q.from } : {}),
      ...(q.to ? { to: q.to } : {}),
      ...(q.categories?.length ? { categories: q.categories } : {}),
      ...(q.statuses ? { statuses: q.statuses } : {}),
      ...(q.text ? { text: q.text } : {}),
      order: q.order ?? 'asc',
      limit: q.limit + 1,
      offset: q.offset ?? 0,
    });
    const page = rows.slice(0, q.limit);
    const bundles = await this.store.getAppointmentBundles(page.map((r) => r.id));
    const names = await this.workspaceNames(actor);
    // Defence in depth: re-check every row with the policy (the store predicate is the primary filter).
    const items = bundles.filter((b) => canViewAppointment(actor, b)).map((b) => this.summary(actor, b, names));
    return { items, hasMore: rows.length > q.limit };
  }

  async detail(actor: Actor, id: string): Promise<AppointmentDetailDto> {
    const b = await this.store.getAppointment(id);
    if (!b || !canViewAppointment(actor, b)) throw notFound();
    const names = await this.workspaceNames(actor);
    const userIds = [b.appointment.createdByUserId, ...b.accessGrants.map((g) => g.userId)];
    const users = new Map((await this.store.getUsers(userIds)).map((u) => [u.id, u.displayName]));
    const destRows = b.destinations.length
      ? await this.store.listDestinations({ ids: b.destinations.map((d) => d.destinationId), limit: 20 })
      : [];
    const destById = new Map(destRows.map((d) => [d.id, d]));
    const privateOwners = new Map(
      (await this.store.getUsers(destRows.filter((d) => d.userId).map((d) => d.userId as string))).map((u) => [u.id, u.displayName]),
    );
    const reminders: ReminderDto[] = b.reminderRules.map((r, i) => ({
      index: i,
      kind: r.kind,
      offsetMinutes: r.offsetMinutes,
      dayOffset: r.dayOffset,
      localTime: r.localTime,
      enabled: r.enabled,
      status: r.status,
      fireAt: r.fireAt?.toISOString() ?? null,
      labelTh: labelFor(r),
    }));
    const a = b.appointment;
    return {
      ...this.summary(actor, b, names),
      notes: a.notes,
      version: a.version,
      createdBy: { id: a.createdByUserId, displayName: users.get(a.createdByUserId) ?? '' },
      sharedWith: b.accessGrants.map((g) => ({ id: g.userId, displayName: users.get(g.userId) ?? '' })),
      destinations: b.destinations.flatMap((d) => {
        const row = destById.get(d.destinationId);
        if (!row) return [];
        const label =
          row.kind === 'PRIVATE_USER'
            ? row.userId === actor.user.id
              ? 'แชตส่วนตัวของฉัน'
              : `แชตส่วนตัว · ${privateOwners.get(row.userId ?? '') ?? ''}`
            : row.label;
        return [{ id: row.id, label, kind: row.kind, contentPolicy: d.contentPolicy }];
      }),
      reminders,
      canEdit: canEditAppointment(actor, b),
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
      cancelledAt: a.cancelledAt?.toISOString() ?? null,
    };
  }

  async events(actor: Actor, id: string) {
    const b = await this.store.getAppointment(id);
    if (!b || !canViewAppointment(actor, b)) throw notFound();
    const rows = await this.store.listAppointmentEvents(id, 50);
    const users = new Map(
      (await this.store.getUsers(rows.map((r) => r.actorUserId).filter((x): x is string => !!x))).map((u) => [u.id, u.displayName]),
    );
    return rows.map((r) => ({
      type: r.type,
      fields: r.fields ?? [],
      actor: r.actorUserId ? (users.get(r.actorUserId) ?? '') : null,
      at: r.createdAt.toISOString(),
    }));
  }

  async today(actor: Actor, timeZone = 'Asia/Bangkok') {
    const now = this.clock();
    const today = toLocalDateString(now, timeZone);
    const horizon = addDaysToLocalDate(today, 14);
    const { items } = await this.list(actor, { from: today, to: horizon, statuses: ['SCHEDULED'], limit: 100 });
    const todays = items.filter((i) => i.startDate <= today && i.endDate >= today);
    const upcoming = items.filter((i) => i.startAt ? new Date(i.startAt) > now : i.startDate > today);
    const next = upcoming[0] ?? null;
    const scheduledNextWeek = (await this.store.getAppointmentBundles(items.map((i) => i.id)))
      .flatMap((b) => b.reminderRules)
      .filter((r) => r.status === 'SCHEDULED' && r.fireAt && r.fireAt.getTime() - now.getTime() < 7 * 86_400_000).length;
    return {
      date: today,
      timeZone,
      today: todays,
      next,
      upcoming: upcoming.slice(0, 10),
      reminders: { scheduledNext7Days: scheduledNextWeek, deliveryEnabled: false },
    };
  }

  async calendar(actor: Actor, from: string, to: string, filters: { workspaceId?: string; categories?: string[]; includeCancelled?: boolean }) {
    const { items, hasMore } = await this.list(actor, {
      from,
      to,
      ...(filters.workspaceId ? { workspaceId: filters.workspaceId } : {}),
      ...(filters.categories ? { categories: filters.categories } : {}),
      statuses: filters.includeCancelled ? ['SCHEDULED', 'CANCELLED'] : ['SCHEDULED'],
      limit: 500,
    });
    const days: Record<string, number> = {};
    for (const i of items) {
      for (let d = i.startDate < from ? from : i.startDate; d <= i.endDate && d <= to; d = addDaysToLocalDate(d, 1))
        days[d] = (days[d] ?? 0) + 1;
    }
    return { from, to, items, days, truncated: hasMore };
  }

  async history(actor: Actor, scope: 'upcoming' | 'past' | 'cancelled', limit: number, offset: number, timeZone = 'Asia/Bangkok') {
    const today = toLocalDateString(this.clock(), timeZone);
    if (scope === 'cancelled') return this.list(actor, { statuses: ['CANCELLED'], order: 'desc', limit, offset });
    if (scope === 'upcoming') return this.list(actor, { from: today, statuses: ['SCHEDULED'], order: 'asc', limit, offset });
    return this.list(actor, { to: addDaysToLocalDate(today, -1), statuses: ['SCHEDULED'], order: 'desc', limit, offset });
  }

  /** Protected preview: built only from data the actor may see/use. Never sent. */
  async preview(
    actor: Actor,
    input: AppointmentInput,
    ruleIndex: number,
    destinationId: string | null,
  ) {
    if (!canInWorkspace(actor, 'appointment.create', input.workspaceId)) throw badRequest('WORKSPACE_NOT_PERMITTED');
    const now = this.clock();
    const timing = computeTiming(input, now);
    const rules = buildReminderRows('preview', timing, input.reminders, false, now);
    const rule = rules[ruleIndex];
    if (!rule || !rule.fireAt) throw badRequest('INVALID_RULE_INDEX');
    const { destinations } = await this.validateAudience(actor, actor.user.id, input, this.store);
    const dest = destinationId ? destinations.find((d) => d.row.id === destinationId) : destinations[0];
    if (destinationId && !dest) throw badRequest('DESTINATION_NOT_PERMITTED');
    const minimal = dest ? dest.policy === 'PRIVACY_SAFE' : false;
    const start = timing.startAt ?? zonedLocalToUtc(timing.startDate, '08:00', timing.timeZone);
    const model = buildReminderPreview({
      title: input.title,
      category: input.category,
      allDay: timing.allDay,
      localDate: timing.startDate,
      start,
      timeZone: timing.timeZone,
      location: dest?.policy === 'FULL' ? input.location : null,
      reminder: { kind: rule.kind, offsetMinutes: rule.offsetMinutes, fireAt: rule.fireAt },
      ...(dest
        ? { destination: { displayName: dest.row.kind === 'PRIVATE_USER' ? 'แชตส่วนตัว' : dest.row.label, kind: dest.row.kind === 'GROUP' ? 'line-group' as const : 'private-self' as const } }
        : {}),
      minimalDisclosure: minimal,
      now,
    });
    const detailUri = `${(this.publicBaseUrl ?? 'https://flow.pdabliss.com').replace(/\/$/, '')}/today`;
    const message = toFlexMessage(model, detailUri);
    return {
      preview: true as const,
      model,
      message,
      issues: validateFlexMessage(message),
      fireAt: rule.fireAt.toISOString(),
      fireAtLocal: `${toLocalDateString(rule.fireAt, timing.timeZone)} ${toLocalTimeString(rule.fireAt, timing.timeZone)}`,
    };
  }

  /** Local estimate only — never LINE-reported consumption. */
  async estimate(actor: Actor, input: AppointmentInput, quota: { limit: number | null; used: number | null }) {
    const now = this.clock();
    const timing = computeTiming(input, now);
    const rules = buildReminderRows('estimate', timing, input.reminders, false, now);
    const { destinations } = await this.validateAudience(actor, actor.user.id, input, this.store);
    const scheduled = rules.filter((r) => r.status === 'SCHEDULED').length;
    const est = estimateQuota(
      destinations.map((d) => ({
        id: d.row.id,
        kind: d.row.kind === 'GROUP' ? ('line-group' as const) : ('private-self' as const),
        memberCount: d.row.kind === 'GROUP' ? d.row.audienceSize : 1,
      })),
      scheduled,
      { monthlyLimit: quota.limit ?? 0, consumedThisMonth: quota.used ?? 0, reservedThisMonth: 0, safetyReserve: 0 },
    );
    return { estimate: est, quotaKnown: quota.limit !== null, scheduledReminders: scheduled };
  }

  /** Draft for "duplicate": copies fields the actor may see; dates/reminders kept, ids dropped. */
  async duplicateDraft(actor: Actor, id: string) {
    const b = await this.store.getAppointment(id);
    if (!b || !canViewAppointment(actor, b)) throw notFound();
    const a = b.appointment;
    const workspaceId = canInWorkspace(actor, 'appointment.create', a.workspaceId) ? a.workspaceId : null;
    return {
      workspaceId,
      title: a.title,
      category: a.category,
      allDay: a.allDay,
      date: a.startDate,
      endDate: a.allDay ? a.endDate : null,
      startTime: a.startAt ? toLocalTimeString(a.startAt, a.timeZone) : null,
      endTime: a.endAt ? toLocalTimeString(a.endAt, a.timeZone) : null,
      timeZone: a.timeZone,
      location: a.location,
      notes: a.createdByUserId === actor.user.id ? a.notes : null,
      visibility: 'PRIVATE' as const,
      reminders: rulesFromRows(b.reminderRules),
    };
  }
}

function labelFor(r: ReminderRuleRow): string {
  return reminderLabelTh({ kind: r.kind, offsetMinutes: r.offsetMinutes, dayOffset: r.dayOffset, localTime: r.localTime, enabled: r.enabled });
}

function diffFields(prev: AppointmentBundle, next: AppointmentBundle): string[] {
  const a = prev.appointment;
  const b = next.appointment;
  const fields: string[] = [];
  const keys: (keyof AppointmentRow)[] = ['title', 'category', 'location', 'notes', 'visibility', 'allDay', 'startDate', 'endDate', 'timeZone'];
  for (const k of keys) if (a[k] !== b[k]) fields.push(k);
  if ((a.startAt?.getTime() ?? null) !== (b.startAt?.getTime() ?? null)) fields.push('startAt');
  if ((a.endAt?.getTime() ?? null) !== (b.endAt?.getTime() ?? null)) fields.push('endAt');
  const grants = (x: AppointmentBundle) => x.accessGrants.map((g) => g.userId).sort().join();
  if (grants(prev) !== grants(next)) fields.push('sharedWith');
  const dests = (x: AppointmentBundle) => x.destinations.map((d) => `${d.destinationId}:${d.contentPolicy}`).sort().join();
  if (dests(prev) !== dests(next)) fields.push('destinations');
  const rules = (x: AppointmentBundle) =>
    x.reminderRules.map((r) => `${r.kind}:${r.offsetMinutes}:${r.dayOffset}:${r.localTime}:${r.enabled}`).join('|');
  if (rules(prev) !== rules(next)) fields.push('reminders');
  return fields;
}

function eventTypes(fields: string[]): AppointmentEventType[] {
  const t = new Set<AppointmentEventType>();
  if (fields.some((f) => ['startDate', 'endDate', 'startAt', 'endAt', 'allDay', 'timeZone'].includes(f))) t.add('RESCHEDULED');
  if (fields.includes('visibility') || fields.includes('sharedWith')) t.add('VISIBILITY_CHANGED');
  if (fields.includes('destinations')) t.add('DESTINATIONS_CHANGED');
  if (fields.includes('reminders')) t.add('REMINDERS_CHANGED');
  if (fields.some((f) => ['title', 'category', 'location', 'notes'].includes(f))) t.add('UPDATED');
  return [...t];
}

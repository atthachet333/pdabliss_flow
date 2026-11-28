/**
 * Recurring appointments and bills (EP02 consolidated). Design: docs/EP02-RECURRENCE-AND-BILLS.md.
 *
 *  - A series row holds the rule and a validated occurrence template.
 *  - Occurrences are ordinary appointment rows materialized up to a bounded rolling horizon
 *    (shared RECURRENCE_HORIZON_DAYS, at most RECURRENCE_MAX_MATERIALIZED per pass), so every
 *    read model, the visibility predicate and the reminder rows apply unchanged.
 *  - Identity: (seriesId, occurrenceDate) is unique in MariaDB; generation skips dates that
 *    exist in any status, so re-running it never duplicates and a cancelled or moved
 *    occurrence is never resurrected.
 *  - Protected occurrences (edited individually, cancelled, or a paid bill) are never
 *    rewritten or removed by series operations. Untouched generated occurrences are derived
 *    data: a series edit updates them in place (same id) or removes them when the new rule no
 *    longer produces their date.
 */
import {
  type AppointmentInput,
  type RecurrenceRule,
  type SeriesScope,
  addDaysToLocalDate,
  appointmentInputSchema,
  expandRecurrence,
  horizonEnd,
  occurrencesBefore,
  recurrenceFinishedAfter,
  recurrenceSchema,
  RECURRENCE_MAX_MATERIALIZED,
  toLocalDateString,
} from '@flow/shared';
import { type Clock, ApiError, badRequest, conflictError, newId } from '../core/context.js';
import {
  type AppointmentBundle,
  type AppointmentEventRow,
  type SeriesRow,
  type Store,
  StoreConflictError,
  StoreTransactionConflictError,
} from '../store/types.js';
import {
  type AppointmentService,
  computeTiming,
  IDEMPOTENCY_SCOPE_CREATE,
  seriesRule,
} from './appointments.js';
import { audit } from './audit.js';
import { type Actor, canInWorkspace } from './policy.js';

const IDEMPOTENCY_TTL_MS = 24 * 3_600_000;

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function ruleToSeriesFields(rule: RecurrenceRule) {
  return {
    frequency: rule.frequency,
    interval: rule.interval,
    monthDay: rule.monthDay === 'LAST' ? -1 : rule.monthDay,
    missingDayPolicy: rule.missingDay,
    endType: rule.end.type,
    untilDate: rule.end.type === 'UNTIL' ? rule.end.until : null,
    occurrenceCount: rule.end.type === 'COUNT' ? rule.end.count : null,
  } satisfies Partial<SeriesRow>;
}

/** Template = validated input without date/recurrence (dates come from the rule). */
function toTemplate(input: AppointmentInput): Record<string, unknown> {
  const { recurrence: _r, ...rest } = input;
  return rest;
}

function fromTemplate(series: SeriesRow): AppointmentInput {
  const parsed = appointmentInputSchema.safeParse({
    ...(series.template as Record<string, unknown>),
    date: series.startDate,
    recurrence: null,
  });
  if (!parsed.success) throw new ApiError(500, 'SERIES_TEMPLATE_INVALID');
  return parsed.data;
}

/** Input for one occurrence date (all-day spans keep their length). */
function occurrenceInput(template: AppointmentInput, date: string): AppointmentInput {
  const span =
    template.allDay && template.endDate ? daysBetween(template.date, template.endDate) : 0;
  return {
    ...template,
    date,
    endDate: template.allDay && span > 0 ? addDaysToLocalDate(date, span) : null,
    recurrence: null,
  };
}

const isProtected = (b: AppointmentBundle) =>
  b.appointment.isException ||
  b.appointment.status !== 'SCHEDULED' ||
  b.appointment.paymentStatus === 'PAID';

export interface Regeneration {
  created: number;
  updated: number;
  removed: number;
  firstId: string | null;
}

export class SeriesService {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
    private readonly appointments: AppointmentService,
    private readonly loadActor: (userId: string) => Promise<Actor | null>,
  ) {}

  /**
   * Materializes `series` from `cutoff` through its horizon: creates missing occurrences,
   * rewrites untouched ones in place, removes untouched ones the rule no longer produces.
   */
  async regenerate(
    tx: Store,
    actor: Actor,
    series: SeriesRow,
    cutoff: string,
    now: Date,
  ): Promise<Regeneration> {
    const template = fromTemplate(series);
    const rule = seriesRule(series);
    const today = toLocalDateString(now, template.timeZone);
    const end = horizonEnd(rule, today);
    const desired =
      cutoff > end
        ? []
        : expandRecurrence(rule, series.startDate, {
            from: cutoff,
            to: end,
            max: RECURRENCE_MAX_MATERIALIZED,
          });
    const wanted = new Set(desired.map((o) => o.date));
    const existing = await tx.listSeriesOccurrences(series.id, cutoff);
    const byDate = new Map(existing.map((b) => [b.appointment.occurrenceDate as string, b]));
    const { destinations } = await this.appointments.validateAudience(
      actor,
      series.createdByUserId,
      template,
      tx,
    );

    const removed = existing
      .filter((b) => !isProtected(b) && !wanted.has(b.appointment.occurrenceDate as string))
      .map((b) => b.appointment.id);
    await tx.deleteAppointments(removed);

    const creates: AppointmentBundle[] = [];
    const events: AppointmentEventRow[] = [];
    let updated = 0;
    let firstId: string | null = null;
    for (const occ of desired) {
      const input = occurrenceInput(template, occ.date);
      const timing = computeTiming(input, now);
      const ex = byDate.get(occ.date);
      if (!ex) {
        const id = newId();
        creates.push(
          this.appointments.bundleFrom(
            id,
            actor,
            input,
            timing,
            destinations,
            {
              createdByUserId: series.createdByUserId,
              seriesId: series.id,
              occurrenceDate: occ.date,
              isException: false,
            },
            now,
          ),
        );
        events.push({
          id: newId(),
          appointmentId: id,
          actorUserId: actor.user.id,
          type: 'CREATED',
          fields: null,
          createdAt: now,
        });
        firstId ??= id;
        continue;
      }
      firstId ??= ex.appointment.id;
      if (isProtected(ex)) continue;
      const next = this.appointments.bundleFrom(
        ex.appointment.id,
        actor,
        input,
        timing,
        destinations,
        ex.appointment,
        now,
      );
      if (!(await tx.updateAppointment(ex.appointment.id, ex.appointment.version, next)))
        throw conflictError('VERSION_CONFLICT');
      events.push({
        id: newId(),
        appointmentId: ex.appointment.id,
        actorUserId: actor.user.id,
        type: 'UPDATED',
        fields: ['series'],
        createdAt: now,
      });
      updated += 1;
    }
    await tx.createAppointments(creates);
    await tx.appendAppointmentEvents(events);

    const lastDate = desired.length >= RECURRENCE_MAX_MATERIALIZED ? desired.at(-1)?.date : end;
    const through = lastDate ?? end;
    const finished = recurrenceFinishedAfter(rule, series.startDate, through);
    const saved = await tx.updateSeries(
      series.id,
      series.version,
      { generatedThrough: through, ...(finished ? { status: 'ENDED' as const } : {}) },
      now,
    );
    if (!saved) throw conflictError('VERSION_CONFLICT');
    Object.assign(series, saved);
    return { created: creates.length, updated, removed: removed.length, firstId };
  }

  // ───────────────────────── create

  async create(
    actor: Actor,
    input: AppointmentInput,
    idempotencyKey: string,
  ): Promise<{ id: string; replayed: boolean }> {
    const rule = recurrenceSchema.parse(input.recurrence) as RecurrenceRule;
    const now = this.clock();
    computeTiming(input, now); // validates time zone, range and times up front
    const existing = await this.store.getIdempotency(
      actor.user.id,
      IDEMPOTENCY_SCOPE_CREATE,
      idempotencyKey,
    );
    if (existing?.resultId) return { id: existing.resultId, replayed: true };
    return this.store.transaction(async (tx) => {
      const series: SeriesRow = {
        id: newId(),
        workspaceId: input.workspaceId,
        createdByUserId: actor.user.id,
        kind: input.kind,
        ...ruleToSeriesFields(rule),
        startDate: input.date,
        template: toTemplate(input),
        generatedThrough: null,
        status: 'ACTIVE',
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      await tx.createSeries(series);
      const r = await this.regenerate(tx, actor, series, input.date, now);
      if (!r.firstId) throw badRequest('RECURRENCE_EMPTY');
      await tx.createIdempotency({
        id: newId(),
        userId: actor.user.id,
        scope: IDEMPOTENCY_SCOPE_CREATE,
        key: idempotencyKey,
        resultId: r.firstId,
        createdAt: now,
        expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
      });
      await audit(tx, {
        actorUserId: actor.user.id,
        action: 'series.created',
        resourceType: 'appointment_series',
        resourceId: series.id,
        workspaceId: series.workspaceId,
        meta: { kind: rule.frequency, count: r.created, visibility: input.visibility },
        at: now,
      });
      return { id: r.firstId, replayed: false };
    });
  }

  // ───────────────────────── edit (FUTURE / ALL)

  async updateScoped(
    actor: Actor,
    current: AppointmentBundle,
    version: number,
    input: AppointmentInput,
    scope: Exclude<SeriesScope, 'THIS'>,
  ): Promise<{ id: string }> {
    const now = this.clock();
    return this.store.transaction(async (tx) => {
      const fresh = await tx.getAppointment(current.appointment.id);
      if (!fresh || fresh.appointment.version !== version) throw conflictError('VERSION_CONFLICT');
      const old = await tx.getSeries(fresh.appointment.seriesId as string);
      if (!old) throw conflictError('SERIES_MISSING');
      const a = fresh.appointment;
      if (a.createdByUserId !== actor.user.id) {
        const tpl = fromTemplate(old);
        const prevShared = [...tpl.sharedWithUserIds].sort().join();
        const nextShared = [...input.sharedWithUserIds].sort().join();
        if (input.visibility !== tpl.visibility || prevShared !== nextShared)
          throw new ApiError(
            403,
            'ONLY_CREATOR_CHANGES_VISIBILITY',
            'Only the creator can change who sees this',
          );
      }
      const occDate = a.occurrenceDate as string;
      const delta = daysBetween(occDate, input.date);
      const oldRule = seriesRule(old);
      const today = toLocalDateString(now, input.timeZone);
      const template = toTemplate({ ...input, date: input.date });
      // The occurrence the user is editing takes the new values even if edited before.
      if (a.isException)
        await tx.updateAppointment(a.id, a.version, { appointment: { ...a, isException: false } });

      let target: SeriesRow;
      let cutoff: string;
      if (scope === 'ALL' || occDate <= old.startDate) {
        const rule = (
          input.recurrence ? recurrenceSchema.parse(input.recurrence) : oldRule
        ) as RecurrenceRule;
        const saved = await tx.updateSeries(
          old.id,
          old.version,
          {
            ...ruleToSeriesFields(rule),
            startDate: addDaysToLocalDate(old.startDate, delta),
            template,
            status: 'ACTIVE',
          },
          now,
        );
        if (!saved) throw conflictError('VERSION_CONFLICT');
        target = saved;
        // Entire series: the occurrence being edited and every occurrence from today on
        // (earlier ones stay as history). FUTURE at the first occurrence: from there on.
        cutoff = scope === 'ALL' && today < occDate ? today : occDate;
      } else {
        // Split: the old series ends the day before; a new series continues from here.
        let rule = (
          input.recurrence ? recurrenceSchema.parse(input.recurrence) : oldRule
        ) as RecurrenceRule;
        if (!input.recurrence && oldRule.end.type === 'COUNT') {
          const left = oldRule.end.count - occurrencesBefore(oldRule, old.startDate, occDate);
          rule = { ...rule, end: { type: 'COUNT', count: Math.max(1, left) } };
        }
        const ended = await tx.updateSeries(
          old.id,
          old.version,
          {
            endType: 'UNTIL',
            untilDate: addDaysToLocalDate(occDate, -1),
            occurrenceCount: null,
            status: 'ENDED',
          },
          now,
        );
        if (!ended) throw conflictError('VERSION_CONFLICT');
        target = {
          id: newId(),
          workspaceId: old.workspaceId,
          createdByUserId: old.createdByUserId,
          kind: old.kind,
          ...ruleToSeriesFields(rule),
          startDate: input.date,
          template,
          generatedThrough: null,
          status: 'ACTIVE',
          version: 1,
          createdAt: now,
          updatedAt: now,
        };
        await tx.createSeries(target);
        const moving = await tx.listSeriesOccurrences(old.id, occDate);
        await tx.moveOccurrences(
          moving.map((b) => b.appointment.id),
          target.id,
        );
        cutoff = occDate < input.date ? occDate : input.date;
      }
      const r = await this.regenerate(tx, actor, target, cutoff, now);
      await audit(tx, {
        actorUserId: actor.user.id,
        action: 'series.updated',
        resourceType: 'appointment_series',
        resourceId: target.id,
        workspaceId: target.workspaceId,
        meta: { kind: scope, count: r.created + r.updated + r.removed },
        at: now,
      });
      const shown =
        (await tx.listSeriesOccurrences(target.id, input.date)).find(
          (b) => b.appointment.status === 'SCHEDULED',
        )?.appointment.id ?? r.firstId;
      if (!shown) throw conflictError('SERIES_EMPTY');
      return { id: shown };
    });
  }

  // ───────────────────────── cancel (FUTURE / ALL)

  async cancelScoped(
    actor: Actor,
    current: AppointmentBundle,
    version: number,
    scope: Exclude<SeriesScope, 'THIS'>,
  ): Promise<void> {
    const now = this.clock();
    await this.store.transaction(async (tx) => {
      const fresh = await tx.getAppointment(current.appointment.id);
      if (!fresh || fresh.appointment.version !== version) throw conflictError('VERSION_CONFLICT');
      const series = await tx.getSeries(fresh.appointment.seriesId as string);
      if (!series) throw conflictError('SERIES_MISSING');
      const occDate = fresh.appointment.occurrenceDate as string;
      const today = toLocalDateString(now, fresh.appointment.timeZone);
      const whole = scope === 'ALL' || occDate <= series.startDate;
      // Entire series: from today (past occurrences stay as history); FUTURE: from this one.
      const cutoff = scope === 'ALL' ? today : occDate;
      const saved = await tx.updateSeries(
        series.id,
        series.version,
        whole
          ? { status: 'CANCELLED' }
          : {
              status: 'ENDED',
              endType: 'UNTIL',
              untilDate: addDaysToLocalDate(occDate, -1),
              occurrenceCount: null,
            },
        now,
      );
      if (!saved) throw conflictError('VERSION_CONFLICT');
      const range = await tx.listSeriesOccurrences(series.id, cutoff);
      const toCancel = range.filter(
        (b) =>
          b.appointment.status === 'SCHEDULED' &&
          b.appointment.paymentStatus !== 'PAID' &&
          (b.appointment.id === fresh.appointment.id || b.appointment.isException),
      );
      const toRemove = range
        .filter((b) => !isProtected(b) && b.appointment.id !== fresh.appointment.id)
        .map((b) => b.appointment.id);
      await tx.deleteAppointments(toRemove);
      const events: AppointmentEventRow[] = [];
      for (const b of toCancel) {
        const ok = await tx.updateAppointment(b.appointment.id, b.appointment.version, {
          appointment: {
            ...b.appointment,
            status: 'CANCELLED',
            cancelledAt: now,
            cancelledByUserId: actor.user.id,
            updatedAt: now,
          },
          reminderRules: b.reminderRules.map((r) => ({
            ...r,
            status: 'CANCELLED',
            calculatedAt: now,
          })),
        });
        if (!ok) throw conflictError('VERSION_CONFLICT');
        events.push({
          id: newId(),
          appointmentId: b.appointment.id,
          actorUserId: actor.user.id,
          type: 'CANCELLED',
          fields: null,
          createdAt: now,
        });
      }
      await tx.appendAppointmentEvents(events);
      await audit(tx, {
        actorUserId: actor.user.id,
        action: 'series.cancelled',
        resourceType: 'appointment_series',
        resourceId: series.id,
        workspaceId: series.workspaceId,
        meta: { kind: scope, count: toCancel.length + toRemove.length },
        at: now,
      });
    });
  }

  // ───────────────────────── rolling horizon (housekeeping)

  /**
   * Extends ACTIVE series whose materialization falls behind the rolling horizon. A series
   * whose creator can no longer create appointments in its workspace (removed, suspended,
   * revoked, viewer) or whose destinations are no longer permitted is paused, not extended.
   */
  async extendAll(limit = 200): Promise<{ extended: number; created: number; paused: number }> {
    const now = this.clock();
    const today = toLocalDateString(now, 'Asia/Bangkok');
    const candidates = await this.store.listSeriesNeedingExtension(
      horizonEnd({ frequency: 'YEARLY' }, today),
      limit,
    );
    let extended = 0;
    let created = 0;
    let paused = 0;
    for (const s of candidates) {
      const end = horizonEnd({ frequency: s.frequency }, today);
      // Weekly slack: extend only when the horizon is a week or more behind.
      if (s.generatedThrough && addDaysToLocalDate(s.generatedThrough, 7) > end) continue;
      const actor = await this.loadActor(s.createdByUserId);
      if (!actor || !canInWorkspace(actor, 'appointment.create', s.workspaceId)) {
        paused += 1;
        continue;
      }
      try {
        const r = await this.store.transaction(async (tx) => {
          const fresh = await tx.getSeries(s.id);
          if (!fresh || fresh.status !== 'ACTIVE') return null;
          const from = fresh.generatedThrough
            ? addDaysToLocalDate(fresh.generatedThrough, 1)
            : fresh.startDate;
          return this.regenerate(tx, actor, fresh, from, now);
        });
        if (r) {
          extended += 1;
          created += r.created;
        }
      } catch (err) {
        // Another runner materialized the same dates first (unique series + occurrenceDate,
        // or a conflicting snapshot): its work stands, this pass simply skips the series.
        if (err instanceof StoreConflictError || err instanceof StoreTransactionConflictError)
          continue;
        if (err instanceof ApiError) {
          // VERSION_CONFLICT from a concurrent runner is a skip too; anything else pauses.
          if (err.code !== 'VERSION_CONFLICT') paused += 1;
          continue;
        }
        throw err;
      }
    }
    return { extended, created, paused };
  }
}

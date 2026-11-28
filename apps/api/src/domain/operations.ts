/**
 * Platform Administration Center read models (EP02 consolidated): dashboard metrics, the
 * Activity Center, LINE quota, LINE friends, health and notification status.
 *
 * Privacy rules enforced HERE (the projection layer), never by the UI:
 *  - No creator identity anywhere in the Activity Center.
 *  - Appointment titles only when the viewer already has content access (canViewAppointment).
 *  - Restricted rows: no title, category, bill amount, notes, location, recipient identity or
 *    recurrence pattern; the reminder time is truncated to the hour; no appointment id.
 *  - Masked LINE identifiers only ("U1a2b…9f0e"); never the raw id.
 *  - Unavailable or EP03-only metrics are labelled, never reported as zero.
 */
import type {
  ActivityDto,
  ActivityItemDto,
  AdminOverviewDto,
  FriendsDto,
  HealthDto,
  MetricDto,
  NotificationOverviewDto,
  QuotaDto,
  ReminderRuleStatus,
} from '@flow/shared';
import { addDaysToLocalDate, toLocalDateString, zonedLocalToUtc } from '@flow/shared';
import type { Clock } from '../core/context.js';
import { badRequest } from '../core/context.js';
import { LineApiError, type LineMessagingReader } from '../line/messaging.js';
import type { Store, UserRow } from '../store/types.js';
import type { DestinationService } from './destinations.js';
import { type Actor, canGlobal, canViewAppointment, isOwner } from './policy.js';

const TZ = 'Asia/Bangkok';
const MAX_ACTIVITY_RANGE_DAYS = 62;

export function maskLineId(lineUserId: string): string {
  return lineUserId.length > 9 ? `${lineUserId.slice(0, 5)}…${lineUserId.slice(-4)}` : '…';
}

export interface IntegrationFlags {
  login: boolean;
  messagingRead: boolean;
  webhook: boolean;
}

export class OperationsService {
  private lastQuota: {
    at: Date;
    month: string;
    value: Omit<
      QuotaDto,
      'status' | 'checkedAt' | 'errorKind' | 'lastSuccessAt' | 'month' | 'reservations' | 'flowLog'
    >;
  } | null = null;
  private readonly startedAt: Date;

  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
    private readonly destinations: DestinationService,
    private readonly messaging: LineMessagingReader | null,
    private readonly flags: IntegrationFlags,
    private readonly version: string,
  ) {
    this.startedAt = clock();
  }

  // ───────────────────────── dashboard

  async overview(actor: Actor): Promise<AdminOverviewDto> {
    const owner = isOwner(actor);
    const now = this.clock();
    const m: AdminOverviewDto['metrics'] = {};
    const measured = (value: number, to: string, extra: Partial<MetricDto> = {}): MetricDto => ({
      status: 'measured',
      value,
      to,
      ...extra,
    });
    m.usersTotal = measured(await this.store.countUsers({}), '/admin/users');
    m.requestsPending = measured(
      await this.store.countAccessRequests({ statuses: ['PENDING'] }),
      '/admin/requests?status=PENDING',
    );
    m.usersActive = measured(
      await this.store.countUsers({ statuses: ['ACTIVE'] }),
      '/admin/users?status=ACTIVE',
    );
    m.usersRestricted = measured(
      await this.store.countUsers({ statuses: ['SUSPENDED', 'REVOKED'] }),
      '/admin/users?status=RESTRICTED',
    );
    m.workspaces = measured(
      await this.store.countWorkspaces({
        statuses: ['ACTIVE'],
        kinds: ['FAMILY', 'COMPANY', 'CUSTOM'],
      }),
      '/admin/workspaces',
    );
    m.audit24h = measured(
      await this.store.countAudit({ since: new Date(now.getTime() - 86_400_000) }),
      '/admin/audit',
    );
    if (owner) {
      const g = await this.destinations.counts();
      m.groupsPending = measured(g.pendingGroups, '/admin/groups?status=PENDING');
      m.groupsRegistered = measured(g.activeGroups, '/admin/groups?status=ACTIVE');
      const counts = await this.store.countReminderRules({
        statuses: ['SCHEDULED'],
        fireFrom: now,
        fireTo: new Date(now.getTime() + 7 * 86_400_000),
      });
      m.remindersCalculated = measured(counts.SCHEDULED ?? 0, '/admin/activity?status=SCHEDULED', {
        noteTh: 'เวลาแจ้งเตือนที่คำนวณไว้ใน 7 วัน — ยังไม่มีการส่งจริง',
      });
      m.notificationFailures = {
        status: 'not-enabled',
        value: null,
        to: '/admin/notifications',
        noteTh: 'ระบบส่งแจ้งเตือนเปิดใน EP03 — ยังไม่มีข้อมูลการส่ง',
      };
      const q = await this.quota(actor);
      m.quota =
        q.status === 'available' || q.status === 'stale'
          ? {
              status: q.status === 'stale' ? 'unavailable' : 'measured',
              value: q.used,
              total: q.limit,
              to: '/admin/quota',
              ...(q.status === 'stale' ? { noteTh: 'แสดงค่าล่าสุดที่อ่านได้ — ข้อมูลอาจไม่เป็นปัจจุบัน' } : {}),
            }
          : {
              status: 'unavailable',
              value: null,
              to: '/admin/quota',
              noteTh:
                q.status === 'not-configured'
                  ? 'ยังไม่ได้ตั้งค่าการอ่านโควตาจาก LINE'
                  : 'อ่านโควตาจาก LINE ไม่ได้ในขณะนี้',
            };
      m.friends = {
        status: 'not-enabled',
        value: null,
        to: '/admin/friends',
        noteTh: 'สถิติเพื่อนจาก LINE OA จะเชื่อมใน EP03',
      };
      const h = await this.health(actor);
      m.health = {
        status: 'measured',
        value: h.database.status === 'ok' ? 1 : 0,
        to: '/admin/health',
        noteTh: h.database.status === 'ok' ? 'API และฐานข้อมูลทำงานปกติ' : 'ฐานข้อมูลไม่พร้อม',
      };
    }
    return { generatedAt: now.toISOString(), ownerOnly: !owner, metrics: m };
  }

  // ───────────────────────── Activity Center

  async activity(
    actor: Actor,
    q: {
      from: string;
      to: string;
      status?: ReminderRuleStatus;
      workspaceId?: string;
      limit: number;
      offset: number;
    },
  ): Promise<ActivityDto> {
    const span = Math.round(
      (Date.parse(`${q.to}T00:00:00Z`) - Date.parse(`${q.from}T00:00:00Z`)) / 86_400_000,
    );
    if (span < 0 || span > MAX_ACTIVITY_RANGE_DAYS) throw badRequest('RANGE_TOO_LARGE');
    const fireFrom = zonedLocalToUtc(q.from, '00:00', TZ);
    const fireTo = new Date(
      zonedLocalToUtc(addDaysToLocalDate(q.to, 1), '00:00', TZ).getTime() - 1,
    );
    const rows = await this.store.listReminderActivity({
      fireFrom,
      fireTo,
      ...(q.status ? { statuses: [q.status] } : {}),
      ...(q.workspaceId ? { workspaceIds: [q.workspaceId] } : {}),
      limit: q.limit + 1,
      offset: q.offset,
    });
    const wsIds = [...new Set(rows.map((r) => r.bundle.appointment.workspaceId))];
    const workspaces = new Map(
      (await this.store.listWorkspaces({ ids: wsIds, limit: wsIds.length || 1 })).map((w) => [
        w.id,
        w,
      ]),
    );
    const destIds = [
      ...new Set(rows.flatMap((r) => r.bundle.destinations.map((d) => d.destinationId))),
    ];
    const dests = new Map(
      (destIds.length
        ? await this.store.listDestinations({ ids: destIds, limit: destIds.length })
        : []
      ).map((d) => [d.id, d]),
    );
    const items: ActivityItemDto[] = rows.slice(0, q.limit).map(({ rule, bundle }) => {
      const a = bundle.appointment;
      const ws = workspaces.get(a.workspaceId);
      const personal = ws?.kind === 'PERSONAL';
      const content = canViewAppointment(actor, bundle);
      const fire = rule.fireAt as Date;
      const hour = new Date(Math.floor(fire.getTime() / 3_600_000) * 3_600_000);
      return {
        fireAt: (content ? fire : hour).toISOString(),
        precision: content ? 'minute' : 'hour',
        reminderKind: rule.kind,
        status: rule.status,
        // A personal workspace never names its owner here.
        workspace: {
          id: personal ? null : a.workspaceId,
          name: personal ? 'พื้นที่ส่วนตัวของสมาชิก' : (ws?.name ?? ''),
          kind: ws?.kind ?? 'CUSTOM',
        },
        destinations: bundle.destinations.map((d) => {
          const row = dests.get(d.destinationId);
          const kind = row?.kind ?? 'PRIVATE_USER';
          return { kind, label: kind === 'GROUP' && content ? (row?.label ?? null) : null };
        }),
        recurring: content ? a.seriesId !== null : null,
        itemKind: content ? a.kind : null,
        title: content ? a.title : null,
        redacted: !content,
        delivery: 'not-enabled',
      };
    });
    const totals = await this.store.countReminderRules({ fireFrom, fireTo });
    return {
      from: q.from,
      to: q.to,
      items,
      totals,
      hasMore: rows.length > q.limit,
      limit: q.limit,
      offset: q.offset,
    };
  }

  // ───────────────────────── LINE quota (read-only; never sends)

  async quota(_actor: Actor): Promise<QuotaDto> {
    const now = this.clock();
    const base = {
      checkedAt: now.toISOString(),
      reservations: { status: 'not-enabled' as const },
      flowLog: { status: 'not-enabled' as const },
    };
    const empty = { type: null, limit: null, used: null, remaining: null, percent: null };
    if (!this.messaging)
      return {
        ...base,
        ...empty,
        status: 'not-configured',
        month: null,
        lastSuccessAt: null,
        errorKind: null,
      };
    const month = toLocalDateString(now, TZ).slice(0, 7);
    try {
      const [quota, usage] = await Promise.all([
        this.messaging.getQuota(),
        this.messaging.getConsumption(),
      ]);
      const limit = quota.type === 'limited' ? (quota.value ?? null) : null;
      const used = usage.totalUsage;
      const value = {
        type: quota.type === 'limited' ? ('limited' as const) : ('unlimited' as const),
        limit,
        used,
        remaining: limit === null ? null : Math.max(0, limit - used),
        percent: limit ? Math.min(100, Math.round((used / limit) * 1000) / 10) : null,
      };
      this.lastQuota = { at: now, month, value };
      return {
        ...base,
        ...value,
        status: 'available',
        month,
        lastSuccessAt: now.toISOString(),
        errorKind: null,
      };
    } catch (e) {
      const errorKind = e instanceof LineApiError ? e.kind : 'unexpected';
      if (this.lastQuota)
        return {
          ...base,
          ...this.lastQuota.value,
          status: 'stale',
          month: this.lastQuota.month,
          lastSuccessAt: this.lastQuota.at.toISOString(),
          errorKind,
        };
      return {
        ...base,
        ...empty,
        status: 'unavailable',
        month: null,
        lastSuccessAt: null,
        errorKind,
      };
    }
  }

  // ───────────────────────── LINE friends (FLOW-observed accounts; friendship unknown)

  async friends(
    _actor: Actor,
    q: { text?: string; status?: UserRow['status']; limit: number; offset: number },
  ): Promise<FriendsDto> {
    const users = await this.store.listUsers({
      ...(q.status ? { statuses: [q.status] } : {}),
      ...(q.text ? { text: q.text } : {}),
      limit: q.limit + 1,
      offset: q.offset,
    });
    const page = users.slice(0, q.limit);
    const ids = new Map(
      (await this.store.listIdentities(page.map((u) => u.id))).map((i) => [i.userId, i]),
    );
    return {
      aggregate: {
        status: 'not-enabled',
        followers: null,
        noteTh: 'สถิติผู้ติดตาม LINE OA (insight/followers) จะเชื่อมใน EP03 พร้อมวันที่รายงานและนิยามของ LINE',
      },
      registry: {
        status: 'not-enabled',
        coverageTh:
          'FLOW ยังไม่รับเหตุการณ์ follow/unfollow — สถานะเพื่อนจึงเป็น “ไม่ทราบ” และรายการนี้คือบัญชีที่เคยเข้าสู่ระบบ FLOW ด้วย LINE เท่านั้น ไม่ใช่รายชื่อเพื่อนทั้งหมดของ Sally',
      },
      accounts: {
        registered: await this.store.countUsers({}),
        approved: await this.store.countUsers({ statuses: ['ACTIVE'] }),
        pending: await this.store.countUsers({ statuses: ['PENDING'] }),
      },
      items: page.flatMap((u) => {
        const i = ids.get(u.id);
        if (!i) return [];
        return [
          {
            userId: u.id,
            displayName: u.displayName,
            maskedLineId: maskLineId(i.lineUserId),
            firstObservedAt: i.createdAt.toISOString(),
            lastVerifiedAt: i.lastVerifiedAt.toISOString(),
            friendship: 'unknown' as const,
            flowStatus: u.status,
          },
        ];
      }),
      hasMore: users.length > q.limit,
      limit: q.limit,
      offset: q.offset,
    };
  }

  // ───────────────────────── health

  async health(_actor: Actor): Promise<HealthDto> {
    const now = this.clock();
    let database: HealthDto['database'] = { status: 'unavailable', latencyMs: null };
    const t0 = Date.now();
    try {
      await this.store.countWorkspaces({ statuses: ['ACTIVE'] });
      database = { status: 'ok', latencyMs: Date.now() - t0 };
    } catch {
      database = { status: 'unavailable', latencyMs: null };
    }
    return {
      checkedAt: now.toISOString(),
      api: {
        status: 'ok',
        version: this.version,
        uptimeSeconds: Math.max(0, Math.round((now.getTime() - this.startedAt.getTime()) / 1000)),
      },
      database,
      line: {
        login: this.flags.login ? 'configured' : 'not-configured',
        messagingRead: this.flags.messagingRead ? 'configured' : 'not-configured',
        webhook: this.flags.webhook ? 'configured' : 'not-configured',
        outbound: 'disabled',
      },
      worker: 'not-enabled',
      notificationEngine: 'not-enabled',
    };
  }

  async notifications(_actor: Actor): Promise<NotificationOverviewDto> {
    const now = this.clock();
    return {
      engine: 'not-enabled',
      controls: { pause: 'not-enabled', resume: 'not-enabled', emergencyStop: 'not-enabled' },
      calculated: await this.store.countReminderRules({ fireFrom: now }),
      next7Days:
        (
          await this.store.countReminderRules({
            statuses: ['SCHEDULED'],
            fireFrom: now,
            fireTo: new Date(now.getTime() + 7 * 86_400_000),
          })
        ).SCHEDULED ?? 0,
    };
  }
}

/** Who may open which Administration Center area (server-side; the UI mirrors it). */
export function adminAreas(actor: Actor) {
  const owner = isOwner(actor);
  return {
    console: canGlobal(actor, 'console.view'),
    roles: canGlobal(actor, 'users.role'),
    groups: canGlobal(actor, 'destinations.manage'),
    operations: owner,
  };
}

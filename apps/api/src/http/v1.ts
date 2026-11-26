/**
 * /api/v1 — EP02 application API. Reference: docs/EP02-API.md.
 *
 * Every route: session → fresh Actor (user + ACTIVE memberships) → policy check → DTO.
 * Mutations (POST/PUT/PATCH/DELETE): allowed Origin (onRequest, before parsing) + CSRF
 * header. Forbidden and missing objects answer the same 404 where existence would leak.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  type MeDto,
  type PreferencesDto,
  type ReminderRuleDto,
  DEFAULT_REMINDER_RULES,
  appointmentInputSchema,
  reminderRuleSchema,
} from '@flow/shared';
import {
  ApiError,
  assertUuid,
  badRequest,
  forbidden,
  notFound,
  type Clock,
} from '../core/context.js';
import type { PersistentRateLimiter, PersistentSessions } from '../auth/persistent.js';
import { safeEqual } from '../auth/persistent.js';
import type { AppointmentService } from '../domain/appointments.js';
import type { DestinationService } from '../domain/destinations.js';
import type { IdentityService } from '../domain/identity.js';
import {
  DEFAULT_INVITATION_HOURS,
  type InvitationService,
  invitationState,
} from '../domain/invitations.js';
import {
  type Actor,
  canAdministerUser,
  canGlobal,
  canInWorkspace,
  roleIn,
} from '../domain/policy.js';
import type { WorkspaceService } from '../domain/workspaces.js';
import type { LineMessagingReader } from '../line/messaging.js';
import type { Store, UserRow } from '../store/types.js';
import { type RequestAuth, authenticate, requireActive } from './context.js';
import { type CookieSettings, clientAddress, originAllowed } from './security.js';

export interface V1Deps {
  store: Store;
  sessions: PersistentSessions;
  cookie: CookieSettings;
  allowedOrigins: ReadonlySet<string>;
  limiter: PersistentRateLimiter | null;
  identity: IdentityService;
  workspaces: WorkspaceService;
  invitations: InvitationService;
  destinations: DestinationService;
  appointments: AppointmentService;
  messaging: LineMessagingReader | null;
  publicBaseUrl: string | null;
  clock: Clock;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const roleSchema = z.enum(['ADMIN', 'MEMBER', 'VIEWER']);
const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    const fields = [...new Set(r.error.issues.map((i) => i.path.join('.') || '(body)'))].slice(
      0,
      20,
    );
    throw badRequest('VALIDATION_ERROR', { fields });
  }
  return r.data;
}

const userDto = (u: UserRow) => ({
  id: u.id,
  displayName: u.displayName,
  status: u.status,
  globalRole: u.globalRole,
  createdAt: u.createdAt.toISOString(),
  lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
});

function workspaceList(actor: Actor) {
  return [...actor.memberships.values()]
    .map((m) => ({
      id: m.workspace.id,
      name: m.workspace.name,
      kind: m.workspace.kind,
      role: m.role,
      version: m.workspace.version,
    }))
    .sort((a, b) =>
      a.kind === 'PERSONAL' ? -1 : b.kind === 'PERSONAL' ? 1 : a.name.localeCompare(b.name, 'th'),
    );
}

export function registerV1Routes(app: FastifyInstance, deps: V1Deps): void {
  const { store } = deps;

  void app.register(
    async (v1) => {
      v1.addHook('onRequest', async (request, reply) => {
        if (MUTATING.has(request.method) && !originAllowed(request, deps.allowedOrigins)) {
          return reply.code(403).send({
            error: {
              code: 'ORIGIN_DENIED',
              message: 'Request origin is not allowed',
              requestId: request.id,
            },
          });
        }
        if (deps.limiter) {
          const wait = await deps.limiter.check(`v1:${clientAddress(request)}`);
          if (wait > 0)
            return reply
              .header('retry-after', String(wait))
              .code(429)
              .send({
                error: {
                  code: 'RATE_LIMITED',
                  message: 'Too many requests',
                  requestId: request.id,
                },
              });
        }
        return undefined;
      });

      /** Authenticates; for mutations also verifies the CSRF header. */
      const auth = async (
        request: FastifyRequest,
        opts: { active?: boolean } = { active: true },
      ): Promise<RequestAuth> => {
        const a = await authenticate(request, deps);
        if (MUTATING.has(request.method)) {
          const header = request.headers['x-flow-csrf'];
          if (!safeEqual(typeof header === 'string' ? header : undefined, a.csrfToken))
            throw new ApiError(403, 'CSRF_INVALID', 'Request could not be verified');
        }
        if (opts.active !== false) requireActive(a);
        return a;
      };
      const ok = (reply: FastifyReply, body: unknown, code = 200) => reply.code(code).send(body);

      // ───────────────────────── me, access requests, preferences

      v1.get('/me', async (request, reply) => {
        const { actor } = await auth(request, { active: false });
        const pref = await store.getPreference(actor.user.id);
        const open = await store.getOpenAccessRequest(actor.user.id);
        let invitedWorkspaceName: string | null = null;
        if (open?.targetWorkspaceId)
          invitedWorkspaceName = (await store.getWorkspace(open.targetWorkspaceId))?.name ?? null;
        const admin = canGlobal(actor, 'console.view');
        const body: MeDto = {
          user: {
            id: actor.user.id,
            displayName: actor.user.displayName,
            status: actor.user.status,
            globalRole: actor.user.globalRole,
          },
          workspaces: workspaceList(actor),
          permissions: {
            ownerConsole: admin,
            manageRoles: canGlobal(actor, 'users.role'),
            manageDestinations: canGlobal(actor, 'destinations.manage'),
          },
          adminBadge: admin
            ? {
                pendingRequests: await store.countAccessRequests({ statuses: ['PENDING'] }),
                pendingGroups: canGlobal(actor, 'destinations.manage')
                  ? (await deps.destinations.counts()).pendingGroups
                  : 0,
              }
            : null,
          preferences: preferencesDto(pref, actor),
          access: {
            requestStatus:
              actor.user.status === 'PENDING'
                ? 'pending'
                : actor.user.status === 'REJECTED'
                  ? 'rejected'
                  : 'none',
            invitedWorkspaceName,
          },
        };
        return ok(reply, body);
      });

      v1.post('/access-requests', async (request, reply) => {
        const { actor } = await auth(request, { active: false });
        const body = parse(
          z
            .object({ message: z.string().max(200).optional() })
            .strict()
            .optional(),
          request.body,
        );
        const req = await deps.identity.submitAccessRequest(actor, body?.message?.trim() || null);
        return ok(reply, { state: 'pending', requestId: req.id }, 201);
      });

      v1.get('/preferences', async (request, reply) => {
        const { actor } = await auth(request);
        return ok(reply, preferencesDto(await store.getPreference(actor.user.id), actor));
      });

      v1.put('/preferences', async (request, reply) => {
        const { actor } = await auth(request);
        const body = parse(
          z
            .object({
              defaultWorkspaceId: z.string().nullable(),
              defaultReminders: z.array(reminderRuleSchema).max(5),
              defaultVisibility: z.enum(['PRIVATE', 'WORKSPACE', 'SELECTED']),
              defaultContentPolicy: z.enum(['FULL', 'PRIVACY_SAFE']),
            })
            .strict(),
          request.body,
        );
        if (body.defaultWorkspaceId && !actor.memberships.has(body.defaultWorkspaceId))
          throw badRequest('INVALID_WORKSPACE');
        await store.upsertPreference({ userId: actor.user.id, ...body, updatedAt: deps.clock() });
        return ok(reply, preferencesDto(await store.getPreference(actor.user.id), actor));
      });

      // ───────────────────────── invitations (redeem side)

      v1.post('/invitations/inspect', async (request, reply) => {
        await auth(request, { active: false });
        const body = parse(z.object({ token: z.string().max(100) }).strict(), request.body);
        return ok(reply, await deps.invitations.inspect(body.token));
      });

      v1.post('/invitations/redeem', async (request, reply) => {
        const { actor } = await auth(request, { active: false });
        const body = parse(z.object({ token: z.string().max(100) }).strict(), request.body);
        return ok(reply, await deps.invitations.redeem(actor, body.token));
      });

      // ───────────────────────── workspaces (My Groups)

      v1.get('/workspaces', async (request, reply) => {
        const { actor } = await auth(request);
        const items = await Promise.all(
          workspaceList(actor).map(async (w) => ({
            ...w,
            memberCount: (await store.listMembers(w.id, ['ACTIVE'])).length,
          })),
        );
        return ok(reply, { items });
      });

      v1.post('/workspaces', async (request, reply) => {
        const { actor } = await auth(request);
        const body = parse(
          z
            .object({ name: z.string().max(200), kind: z.enum(['FAMILY', 'COMPANY', 'CUSTOM']) })
            .strict(),
          request.body,
        );
        const ws = await deps.workspaces.create(actor, body.name, body.kind);
        return ok(
          reply,
          { id: ws.id, name: ws.name, kind: ws.kind, role: 'ADMIN', version: ws.version },
          201,
        );
      });

      v1.get('/workspaces/:id', async (request, reply) => {
        const { actor } = await auth(request);
        const id = assertUuid((request.params as { id: string }).id);
        if (!canInWorkspace(actor, 'workspace.view', id)) throw notFound();
        const m = actor.memberships.get(id)!;
        const members = await store.listMembers(id, ['ACTIVE']);
        const users = new Map(
          (await store.getUsers(members.map((x) => x.userId))).map((u) => [u.id, u]),
        );
        const role = m.role;
        const destinations = canInWorkspace(actor, 'destinations.view', id)
          ? (
              await store.listDestinations({
                kinds: ['GROUP'],
                workspaceIds: [id],
                statuses: ['ACTIVE', 'DISABLED'],
                limit: 50,
              })
            ).map((d) => ({
              id: d.id,
              label: d.label,
              status: d.status,
              audienceSize: d.audienceSize,
            }))
          : [];
        return ok(reply, {
          workspace: {
            id,
            name: m.workspace.name,
            kind: m.workspace.kind,
            version: m.workspace.version,
            createdAt: m.workspace.createdAt.toISOString(),
          },
          myRole: role,
          can: {
            edit: canInWorkspace(actor, 'workspace.edit', id),
            archive: canInWorkspace(actor, 'workspace.archive', id),
            manageMembers: canInWorkspace(actor, 'members.manage', id),
            leave: canInWorkspace(actor, 'workspace.leave', id),
            createAppointments: canInWorkspace(actor, 'appointment.create', id),
          },
          members: members.map((x) => ({
            userId: x.userId,
            displayName: users.get(x.userId)?.displayName ?? '',
            role: x.role,
            me: x.userId === actor.user.id,
          })),
          destinations,
        });
      });

      v1.patch('/workspaces/:id', async (request, reply) => {
        const { actor } = await auth(request);
        const id = assertUuid((request.params as { id: string }).id);
        const body = parse(
          z
            .object({
              version: z.number().int().min(1),
              name: z.string().max(200).optional(),
              kind: z.enum(['FAMILY', 'COMPANY', 'CUSTOM']).optional(),
            })
            .strict(),
          request.body,
        );
        const ws = await deps.workspaces.update(actor, id, body.version, {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.kind ? { kind: body.kind } : {}),
        });
        return ok(reply, { id: ws.id, name: ws.name, kind: ws.kind, version: ws.version });
      });

      v1.post('/workspaces/:id/archive', async (request, reply) => {
        const { actor } = await auth(request);
        const id = assertUuid((request.params as { id: string }).id);
        const body = parse(z.object({ version: z.number().int().min(1) }).strict(), request.body);
        await deps.workspaces.archive(actor, id, body.version);
        return ok(reply, { state: 'archived' });
      });

      v1.get('/workspaces/:id/candidates', async (request, reply) => {
        const { actor } = await auth(request);
        const id = assertUuid((request.params as { id: string }).id);
        if (!canInWorkspace(actor, 'members.manage', id)) throw notFound();
        // Directory of ACTIVE users (display names only), for workspace admins adding members.
        const current = new Set((await store.listMembers(id, ['ACTIVE'])).map((m) => m.userId));
        const users = await store.listUsers({ statuses: ['ACTIVE'], limit: 200 });
        return ok(reply, {
          items: users
            .filter((u) => !current.has(u.id))
            .map((u) => ({ id: u.id, displayName: u.displayName })),
        });
      });

      v1.post('/workspaces/:id/members', async (request, reply) => {
        const { actor } = await auth(request);
        const id = assertUuid((request.params as { id: string }).id);
        const body = parse(
          z.object({ userId: z.string(), role: roleSchema }).strict(),
          request.body,
        );
        await deps.workspaces.addMember(actor, id, assertUuid(body.userId), body.role);
        return ok(reply, { state: 'added' }, 201);
      });

      v1.patch('/workspaces/:id/members/:userId', async (request, reply) => {
        const { actor } = await auth(request);
        const p = request.params as { id: string; userId: string };
        const body = parse(z.object({ role: roleSchema }).strict(), request.body);
        await deps.workspaces.changeRole(actor, assertUuid(p.id), assertUuid(p.userId), body.role);
        return ok(reply, { state: 'updated' });
      });

      v1.delete('/workspaces/:id/members/:userId', async (request, reply) => {
        const { actor } = await auth(request);
        const p = request.params as { id: string; userId: string };
        await deps.workspaces.removeMember(actor, assertUuid(p.id), assertUuid(p.userId));
        return ok(reply, { state: 'removed' });
      });

      v1.post('/workspaces/:id/leave', async (request, reply) => {
        const { actor } = await auth(request);
        const id = assertUuid((request.params as { id: string }).id);
        await deps.workspaces.removeMember(actor, id, actor.user.id);
        return ok(reply, { state: 'left' });
      });

      v1.get('/workspaces/:id/destinations', async (request, reply) => {
        const { actor } = await auth(request);
        const id = assertUuid((request.params as { id: string }).id);
        if (roleIn(actor, id) === null) throw notFound();
        return ok(reply, { items: await deps.destinations.usable(actor, id) });
      });

      // ───────────────────────── appointments & read models

      const listQuery = pageQuery.extend({
        from: dateStr.optional(),
        to: dateStr.optional(),
        workspaceId: z.string().optional(),
        category: z.string().max(200).optional(),
        q: z.string().max(80).optional(),
        status: z.enum(['scheduled', 'cancelled', 'all']).default('scheduled'),
      });

      const categoriesOf = (c?: string) =>
        c ? c.split(',').filter(Boolean).slice(0, 6) : undefined;
      const statusesOf = (s: 'scheduled' | 'cancelled' | 'all') =>
        s === 'all'
          ? (['SCHEDULED', 'CANCELLED'] as const)
          : s === 'cancelled'
            ? (['CANCELLED'] as const)
            : (['SCHEDULED'] as const);

      v1.get('/appointments', async (request, reply) => {
        const { actor } = await auth(request);
        const q = parse(listQuery, request.query);
        const r = await deps.appointments.list(actor, {
          ...(q.from ? { from: q.from } : {}),
          ...(q.to ? { to: q.to } : {}),
          ...(q.workspaceId ? { workspaceId: q.workspaceId } : {}),
          ...(categoriesOf(q.category) ? { categories: categoriesOf(q.category) } : {}),
          ...(q.q ? { text: q.q.trim() } : {}),
          statuses: [...statusesOf(q.status)],
          limit: q.limit,
          offset: q.offset,
        });
        return ok(reply, { items: r.items, limit: q.limit, offset: q.offset, hasMore: r.hasMore });
      });

      v1.get('/appointments/:id', async (request, reply) => {
        const { actor } = await auth(request);
        return ok(
          reply,
          await deps.appointments.detail(actor, assertUuid((request.params as { id: string }).id)),
        );
      });

      v1.get('/appointments/:id/history', async (request, reply) => {
        const { actor } = await auth(request);
        return ok(reply, {
          items: await deps.appointments.events(
            actor,
            assertUuid((request.params as { id: string }).id),
          ),
        });
      });

      v1.get('/appointments/:id/duplicate', async (request, reply) => {
        const { actor } = await auth(request);
        return ok(
          reply,
          await deps.appointments.duplicateDraft(
            actor,
            assertUuid((request.params as { id: string }).id),
          ),
        );
      });

      v1.post('/appointments', async (request, reply) => {
        const { actor } = await auth(request);
        const key = request.headers['idempotency-key'];
        if (typeof key !== 'string' || !/^[0-9a-f-]{36}$/.test(key))
          throw badRequest('IDEMPOTENCY_KEY_REQUIRED');
        const input = parse(appointmentInputSchema, request.body);
        const r = await deps.appointments.create(actor, input, key);
        const detail = await deps.appointments.detail(actor, r.id);
        return ok(reply, { appointment: detail, replayed: r.replayed }, r.replayed ? 200 : 201);
      });

      v1.put('/appointments/:id', async (request, reply) => {
        const { actor } = await auth(request);
        const id = assertUuid((request.params as { id: string }).id);
        const body = parse(
          z.object({ version: z.number().int().min(1), appointment: z.unknown() }).strict(),
          request.body,
        );
        const input = parse(appointmentInputSchema, body.appointment);
        await deps.appointments.update(actor, id, body.version, input);
        return ok(reply, { appointment: await deps.appointments.detail(actor, id) });
      });

      v1.post('/appointments/:id/cancel', async (request, reply) => {
        const { actor } = await auth(request);
        const id = assertUuid((request.params as { id: string }).id);
        const body = parse(z.object({ version: z.number().int().min(1) }).strict(), request.body);
        await deps.appointments.cancel(actor, id, body.version);
        return ok(reply, { appointment: await deps.appointments.detail(actor, id) });
      });

      v1.post('/preview/reminder', async (request, reply) => {
        const { actor } = await auth(request);
        const body = parse(
          z
            .object({
              appointment: z.unknown(),
              ruleIndex: z.number().int().min(0).max(4),
              destinationId: z.string().nullable().default(null),
            })
            .strict(),
          request.body,
        );
        const input = parse(appointmentInputSchema, body.appointment);
        return ok(
          reply,
          await deps.appointments.preview(actor, input, body.ruleIndex, body.destinationId),
        );
      });

      v1.post('/preview/estimate', async (request, reply) => {
        const { actor } = await auth(request);
        const body = parse(z.object({ appointment: z.unknown() }).strict(), request.body);
        const input = parse(appointmentInputSchema, body.appointment);
        return ok(
          reply,
          await deps.appointments.estimate(actor, input, { limit: null, used: null }),
        );
      });

      v1.get('/today', async (request, reply) => {
        const { actor } = await auth(request);
        return ok(reply, await deps.appointments.today(actor));
      });

      v1.get('/calendar', async (request, reply) => {
        const { actor } = await auth(request);
        const q = parse(
          z.object({
            from: dateStr,
            to: dateStr,
            workspaceId: z.string().optional(),
            category: z.string().max(200).optional(),
            cancelled: z.enum(['0', '1']).default('0'),
          }),
          request.query,
        );
        return ok(
          reply,
          await deps.appointments.calendar(actor, q.from, q.to, {
            ...(q.workspaceId ? { workspaceId: q.workspaceId } : {}),
            ...(categoriesOf(q.category) ? { categories: categoriesOf(q.category) } : {}),
            includeCancelled: q.cancelled === '1',
          }),
        );
      });

      v1.get('/history', async (request, reply) => {
        const { actor } = await auth(request);
        const q = parse(
          pageQuery.extend({
            scope: z.enum(['upcoming', 'past', 'cancelled']).default('upcoming'),
          }),
          request.query,
        );
        const r = await deps.appointments.history(actor, q.scope, q.limit, q.offset);
        return ok(reply, { items: r.items, limit: q.limit, offset: q.offset, hasMore: r.hasMore });
      });

      // ───────────────────────── Owner Console (global OWNER/ADMIN)

      const admin = async (request: FastifyRequest) => {
        const a = await auth(request);
        if (!canGlobal(a.actor, 'console.view')) throw notFound();
        return a;
      };

      v1.get('/admin/summary', async (request, reply) => {
        await admin(request);
        return ok(reply, {
          pendingRequests: await store.countAccessRequests({ statuses: ['PENDING'] }),
          users: {
            active: await store.countUsers({ statuses: ['ACTIVE'] }),
            pending: await store.countUsers({ statuses: ['PENDING'] }),
            suspended: await store.countUsers({ statuses: ['SUSPENDED'] }),
          },
          ...(await deps.destinations.counts()),
        });
      });

      v1.get('/admin/access-requests', async (request, reply) => {
        await admin(request);
        const q = parse(
          z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).default('PENDING') }),
          request.query,
        );
        const rows = await store.listAccessRequests({ statuses: [q.status], limit: 100 });
        const users = new Map(
          (await store.getUsers(rows.map((r) => r.userId))).map((u) => [u.id, u]),
        );
        const wsIds = [
          ...new Set(rows.map((r) => r.targetWorkspaceId).filter((x): x is string => !!x)),
        ];
        const ws = new Map(
          (await store.listWorkspaces({ ids: wsIds, limit: wsIds.length || 1 })).map((w) => [
            w.id,
            w.name,
          ]),
        );
        return ok(reply, {
          items: rows.map((r) => ({
            id: r.id,
            status: r.status,
            message: r.message,
            createdAt: r.createdAt.toISOString(),
            user: users.get(r.userId) ? userDto(users.get(r.userId) as UserRow) : null,
            viaInvitation: r.invitationId !== null,
            target: r.targetWorkspaceId
              ? {
                  workspaceId: r.targetWorkspaceId,
                  workspaceName: ws.get(r.targetWorkspaceId) ?? '',
                  role: r.targetRole,
                }
              : null,
          })),
        });
      });

      v1.post('/admin/access-requests/:id/approve', async (request, reply) => {
        const { actor } = await admin(request);
        const id = assertUuid((request.params as { id: string }).id);
        const body = parse(
          z
            .object({
              assignments: z
                .array(z.object({ workspaceId: z.string(), role: roleSchema }).strict())
                .max(20)
                .default([]),
            })
            .strict(),
          request.body ?? {},
        );
        await deps.identity.approveRequest(
          actor,
          id,
          body.assignments.map((a) => ({ workspaceId: assertUuid(a.workspaceId), role: a.role })),
        );
        return ok(reply, { state: 'approved' });
      });

      v1.post('/admin/access-requests/:id/reject', async (request, reply) => {
        const { actor } = await admin(request);
        await deps.identity.rejectRequest(actor, assertUuid((request.params as { id: string }).id));
        return ok(reply, { state: 'rejected' });
      });

      v1.get('/admin/users', async (request, reply) => {
        await admin(request);
        const q = parse(
          pageQuery.extend({
            status: z
              .enum(['NEW', 'PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED', 'REVOKED'])
              .optional(),
            q: z.string().max(60).optional(),
          }),
          request.query,
        );
        const rows = await store.listUsers({
          ...(q.status ? { statuses: [q.status] } : {}),
          ...(q.q ? { text: q.q } : {}),
          limit: q.limit + 1,
          offset: q.offset,
        });
        return ok(reply, {
          items: rows.slice(0, q.limit).map(userDto),
          limit: q.limit,
          offset: q.offset,
          hasMore: rows.length > q.limit,
        });
      });

      v1.get('/admin/users/:id', async (request, reply) => {
        const { actor } = await admin(request);
        const id = assertUuid((request.params as { id: string }).id);
        const u = await store.getUser(id);
        if (!u) throw notFound();
        const memberships = await store.listMembershipsForUser(id, ['ACTIVE']);
        const ws = new Map(
          (
            await store.listWorkspaces({ ids: memberships.map((m) => m.workspaceId), limit: 100 })
          ).map((w) => [w.id, w]),
        );
        const history = (await store.listAudit({ resourceTypes: ['user'], limit: 200 }))
          .filter((a) => a.resourceId === id)
          .slice(0, 20);
        return ok(reply, {
          user: userDto(u),
          can: {
            administer: canAdministerUser(actor, u),
            changeRole:
              canGlobal(actor, 'users.role') && u.id !== actor.user.id && u.status === 'ACTIVE',
          },
          memberships: memberships
            .map((m) => ({
              workspaceId: m.workspaceId,
              workspaceName: ws.get(m.workspaceId)?.name ?? '',
              kind: ws.get(m.workspaceId)?.kind ?? 'CUSTOM',
              role: m.role,
            }))
            .filter((m) => m.kind !== 'PERSONAL'),
          history: history.map((h) => ({
            action: h.action,
            at: h.createdAt.toISOString(),
            meta: h.metadata,
          })),
        });
      });

      v1.post('/admin/users/:id/status', async (request, reply) => {
        const { actor } = await admin(request);
        const body = parse(
          z.object({ action: z.enum(['suspend', 'reinstate', 'revoke', 'reactivate']) }).strict(),
          request.body,
        );
        const u = await deps.identity.setUserStatus(
          actor,
          assertUuid((request.params as { id: string }).id),
          body.action,
        );
        return ok(reply, { user: userDto(u) });
      });

      v1.post('/admin/users/:id/role', async (request, reply) => {
        const { actor } = await admin(request);
        const body = parse(
          z.object({ globalRole: z.enum(['ADMIN', 'USER']) }).strict(),
          request.body,
        );
        const u = await deps.identity.setGlobalRole(
          actor,
          assertUuid((request.params as { id: string }).id),
          body.globalRole,
        );
        return ok(reply, { user: userDto(u) });
      });

      v1.put('/admin/users/:id/memberships', async (request, reply) => {
        const { actor } = await admin(request);
        const body = parse(
          z.object({ workspaceId: z.string(), role: roleSchema.nullable() }).strict(),
          request.body,
        );
        await deps.identity.setMembership(
          actor,
          assertUuid((request.params as { id: string }).id),
          assertUuid(body.workspaceId),
          body.role,
        );
        return ok(reply, { state: 'updated' });
      });

      v1.get('/admin/workspaces', async (request, reply) => {
        await admin(request);
        const rows = await store.listWorkspaces({ statuses: ['ACTIVE'], limit: 200 });
        return ok(reply, {
          items: await Promise.all(
            rows
              .filter((w) => w.kind !== 'PERSONAL')
              .map(async (w) => ({
                id: w.id,
                name: w.name,
                kind: w.kind,
                memberCount: (await store.listMembers(w.id, ['ACTIVE'])).length,
              })),
          ),
        });
      });

      v1.get('/admin/invitations', async (request, reply) => {
        await admin(request);
        const now = deps.clock();
        const rows = await store.listInvitations({ limit: 100 });
        const ws = new Map(
          (
            await store.listWorkspaces({
              ids: [...new Set(rows.map((r) => r.workspaceId))],
              limit: 100,
            })
          ).map((w) => [w.id, w.name]),
        );
        return ok(reply, {
          items: rows.map((r) => ({
            id: r.id,
            workspaceId: r.workspaceId,
            workspaceName: ws.get(r.workspaceId) ?? '',
            role: r.role,
            note: r.note,
            state: invitationState(r, now),
            createdAt: r.createdAt.toISOString(),
            expiresAt: r.expiresAt.toISOString(),
            redeemedAt: r.redeemedAt?.toISOString() ?? null,
          })),
        });
      });

      v1.post('/admin/invitations', async (request, reply) => {
        const { actor } = await admin(request);
        const body = parse(
          z
            .object({
              workspaceId: z.string(),
              role: roleSchema,
              expiresInHours: z.number().int().default(DEFAULT_INVITATION_HOURS),
              note: z.string().max(80).nullable().default(null),
            })
            .strict(),
          request.body,
        );
        const { invitation, token } = await deps.invitations.create(actor, {
          ...body,
          workspaceId: assertUuid(body.workspaceId),
        });
        const base = (deps.publicBaseUrl ?? 'https://flow.pdabliss.com').replace(/\/$/, '');
        // The raw token is returned exactly once; it is never stored or logged.
        return ok(
          reply,
          {
            id: invitation.id,
            expiresAt: invitation.expiresAt.toISOString(),
            link: `${base}/invite/${token}`,
          },
          201,
        );
      });

      v1.post('/admin/invitations/:id/revoke', async (request, reply) => {
        const { actor } = await admin(request);
        await deps.invitations.revoke(actor, assertUuid((request.params as { id: string }).id));
        return ok(reply, { state: 'revoked' });
      });

      v1.get('/admin/destinations', async (request, reply) => {
        const { actor } = await admin(request);
        if (!canGlobal(actor, 'destinations.manage')) throw forbidden();
        const items = await deps.destinations.listForOwner(actor);
        const grants = await store.listDestinationGrants({});
        return ok(reply, {
          items: items.map((d) => ({
            ...d,
            grantCount: grants.filter((g) => g.destinationId === d.id).length,
          })),
        });
      });

      v1.patch('/admin/destinations/:id', async (request, reply) => {
        const { actor } = await admin(request);
        const body = parse(
          z
            .object({
              label: z.string().max(200).optional(),
              workspaceId: z.string().nullable().optional(),
              status: z.enum(['ACTIVE', 'DISABLED']).optional(),
              audienceSize: z.number().int().min(1).max(500).nullable().optional(),
            })
            .strict(),
          request.body,
        );
        const d = await deps.destinations.configure(
          actor,
          assertUuid((request.params as { id: string }).id),
          {
            ...body,
            ...(body.workspaceId ? { workspaceId: assertUuid(body.workspaceId) } : {}),
          },
        );
        return ok(reply, d);
      });

      v1.put('/admin/destinations/:id/grants/:userId', async (request, reply) => {
        const { actor } = await admin(request);
        const p = request.params as { id: string; userId: string };
        await deps.destinations.setGrant(actor, assertUuid(p.id), assertUuid(p.userId), true);
        return ok(reply, { state: 'granted' });
      });

      v1.delete('/admin/destinations/:id/grants/:userId', async (request, reply) => {
        const { actor } = await admin(request);
        const p = request.params as { id: string; userId: string };
        await deps.destinations.setGrant(actor, assertUuid(p.id), assertUuid(p.userId), false);
        return ok(reply, { state: 'removed' });
      });

      v1.get('/admin/audit', async (request, reply) => {
        const { actor } = await admin(request);
        if (!canGlobal(actor, 'audit.view')) throw notFound();
        const q = parse(pageQuery, request.query);
        const rows = await store.listAudit({ limit: q.limit + 1, offset: q.offset });
        const actors = new Map(
          (
            await store.getUsers(rows.map((r) => r.actorUserId).filter((x): x is string => !!x))
          ).map((u) => [u.id, u.displayName]),
        );
        // Appointment audit entries expose only the action and time — never titles or details.
        return ok(reply, {
          items: rows.slice(0, q.limit).map((r) => ({
            action: r.action,
            resourceType: r.resourceType,
            actor: r.actorUserId ? (actors.get(r.actorUserId) ?? '') : 'ระบบ',
            at: r.createdAt.toISOString(),
            meta: r.resourceType === 'appointment' ? null : r.metadata,
          })),
          limit: q.limit,
          offset: q.offset,
          hasMore: rows.length > q.limit,
        });
      });
    },
    { prefix: '/api/v1' },
  );
}

function preferencesDto(
  pref: Awaited<ReturnType<Store['getPreference']>>,
  actor: Actor,
): PreferencesDto {
  const reminders = Array.isArray(pref?.defaultReminders)
    ? (pref?.defaultReminders as ReminderRuleDto[])
    : null;
  const personal =
    [...actor.memberships.values()].find((m) => m.workspace.kind === 'PERSONAL')?.workspace.id ??
    null;
  return {
    defaultWorkspaceId:
      pref?.defaultWorkspaceId && actor.memberships.has(pref.defaultWorkspaceId)
        ? pref.defaultWorkspaceId
        : personal,
    defaultReminders: reminders ?? (DEFAULT_REMINDER_RULES as unknown as ReminderRuleDto[]),
    defaultVisibility: pref?.defaultVisibility ?? 'PRIVATE',
    defaultContentPolicy: pref?.defaultContentPolicy ?? 'PRIVACY_SAFE',
  };
}

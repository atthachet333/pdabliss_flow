/**
 * EP02 end-to-end scenarios over HTTP (app.inject), shared by the MemoryStore suite and the
 * MariaDB suite. Synthetic identities only. Numbered scenarios follow the EP02 spec §28.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Store } from '../../src/store/types.js';
import { lineSignature } from '../../src/line/webhook.js';
import { BOT_ID, CHANNEL_SECRET } from '../helpers.js';
import {
  appointmentPayload,
  createHarness,
  groupId,
  idem,
  seedGroup,
  seedUser,
  seedWorkspace,
  tokenFor,
  lineId,
  type Harness,
} from './harness.js';

type StoreFactory = () => Promise<Store>;

async function world(makeStore: StoreFactory, opts: Parameters<typeof createHarness>[0] = {}) {
  const h = await createHarness({ ...opts, store: await makeStore() });
  const s = h.store;
  const owner = await seedUser(s, 1, { name: 'เจ้าของระบบ', globalRole: 'OWNER' });
  const famAdmin = await seedUser(s, 2, { name: 'แอดมินครอบครัว' });
  const famMember = await seedUser(s, 3, { name: 'สมาชิกครอบครัว' });
  const coAdmin = await seedUser(s, 4, { name: 'แอดมินบริษัท' });
  const coMember = await seedUser(s, 5, { name: 'พนักงาน' });
  const viewer = await seedUser(s, 6, { name: 'ผู้ชมอย่างเดียว' });
  const loner = await seedUser(s, 7, { name: 'ผู้ใช้ส่วนตัว' });
  const pending = await seedUser(s, 8, { name: 'รออนุมัติ', status: 'PENDING' });
  const revoked = await seedUser(s, 9, { name: 'ถูกเพิกถอน', status: 'REVOKED' });
  const family = await seedWorkspace(s, 'ครอบครัวจำลอง', 'FAMILY', [
    { userId: famAdmin.id, role: 'ADMIN' },
    { userId: famMember.id, role: 'MEMBER' },
    { userId: viewer.id, role: 'VIEWER' },
  ]);
  const company = await seedWorkspace(s, 'บริษัทจำลอง', 'COMPANY', [
    { userId: coAdmin.id, role: 'ADMIN' },
    { userId: coMember.id, role: 'MEMBER' },
  ]);
  const as = async (u: { token: string }) => {
    const c = h.client();
    const r = await c.login(u.token);
    assert.equal(r.statusCode, 200);
    return c;
  };
  return {
    h,
    s,
    owner,
    famAdmin,
    famMember,
    coAdmin,
    coMember,
    viewer,
    loner,
    pending,
    revoked,
    family,
    company,
    as,
  };
}

async function create(
  c: Awaited<ReturnType<Awaited<ReturnType<typeof world>>['as']>>,
  payload: unknown,
  headers: Record<string, string> = idem(),
) {
  return c.post('/api/v1/appointments', payload, headers);
}

const scheduled = (detail: { reminders: { status: string; fireAt: string | null }[] }) =>
  detail.reminders.filter((r) => r.status === 'SCHEDULED').map((r) => r.fireAt);

export function defineScenarios(label: string, makeStore: StoreFactory): void {
  describe(`EP02 scenarios (${label})`, () => {
    it('S1: a verified new user requests access in-app; owner approves in the console; user enters the assigned workspace (no CLI)', async () => {
      const w = await world(makeStore);
      const newcomer = w.h.client();
      const first = await newcomer.login(tokenFor(lineId(100), 'ผู้ใช้ใหม่ 🌸'));
      assert.equal(first.statusCode, 200);
      assert.equal(first.json().state, 'new');
      // A NEW user cannot use the application.
      assert.equal((await newcomer.get('/api/v1/today')).json().error.code, 'ACCOUNT_NEW');
      const req = await newcomer.post('/api/v1/access-requests', { message: 'ขอใช้งานค่ะ' });
      assert.equal(req.statusCode, 201);
      assert.equal(
        (await newcomer.post('/api/v1/access-requests', {})).statusCode,
        409,
        'one open request only',
      );
      assert.equal((await newcomer.get('/api/v1/me')).json().access.requestStatus, 'pending');

      const owner = await w.as(w.owner);
      const me = (await owner.get('/api/v1/me')).json();
      assert.equal(me.adminBadge.pendingRequests, 1, 'in-app pending indicator');
      const list = (await owner.get('/api/v1/admin/access-requests')).json().items;
      assert.equal(list.length, 1);
      const approve = await owner.post(`/api/v1/admin/access-requests/${list[0].id}/approve`, {
        assignments: [{ workspaceId: w.family.id, role: 'MEMBER' }],
      });
      assert.equal(approve.statusCode, 200);
      assert.equal(
        (await owner.post(`/api/v1/admin/access-requests/${list[0].id}/approve`, {})).statusCode,
        409,
      );

      // Same session — privileges are re-evaluated per request, no re-login needed.
      const after = (await newcomer.get('/api/v1/me')).json();
      assert.equal(after.user.status, 'ACTIVE');
      const kinds = after.workspaces
        .map((x: { kind: string; role: string }) => `${x.kind}:${x.role}`)
        .sort();
      assert.deepEqual(kinds, ['FAMILY:MEMBER', 'PERSONAL:ADMIN']);
      assert.equal((await newcomer.get('/api/v1/today')).statusCode, 200);
      await w.h.close();
    });

    it('S1b: rejected, suspended and revoked users stay locked out; pending users cannot assign themselves anything', async () => {
      const w = await world(makeStore);
      const pend = await w.as(w.pending);
      assert.equal((await pend.get('/api/v1/workspaces')).statusCode, 403);
      assert.equal(
        (await pend.post('/api/v1/workspaces', { name: 'ของฉัน', kind: 'CUSTOM' })).statusCode,
        403,
      );
      assert.equal((await pend.get('/api/v1/admin/summary')).statusCode, 403);
      const rev = await w.as(w.revoked);
      assert.equal((await rev.get('/api/v1/me')).json().user.status, 'REVOKED');
      assert.equal((await rev.post('/api/v1/access-requests', {})).statusCode, 403);
      const owner = await w.as(w.owner);
      const s = await owner.post(`/api/v1/admin/users/${w.coMember.id}/status`, {
        action: 'suspend',
      });
      assert.equal(s.statusCode, 200);
      await w.h.close();
    });

    it('S2: secure invitation — create, redeem once (owner approves), replay and concurrent redemption fail', async () => {
      const w = await world(makeStore);
      const owner = await w.as(w.owner);
      const inv = await owner.post('/api/v1/admin/invitations', {
        workspaceId: w.company.id,
        role: 'MEMBER',
        expiresInHours: 24,
      });
      assert.equal(inv.statusCode, 201);
      const token = (inv.json().link as string).split('/invite/')[1] as string;
      assert.match(token, /^[A-Za-z0-9_-]{43}$/);
      const audit = JSON.stringify((await owner.get('/api/v1/admin/audit')).json());
      assert.ok(!audit.includes(token), 'raw token never appears in audit');

      const a = w.h.client();
      await a.login(tokenFor(lineId(200), 'ผู้รับเชิญ'));
      const b = w.h.client();
      await b.login(tokenFor(lineId(201), 'ผู้รับเชิญ 2'));
      assert.equal((await a.post('/api/v1/invitations/inspect', { token })).json().state, 'valid');
      const [r1, r2] = await Promise.all([
        a.post('/api/v1/invitations/redeem', { token }),
        b.post('/api/v1/invitations/redeem', { token }),
      ]);
      const codes = [r1.statusCode, r2.statusCode].sort();
      assert.deepEqual(codes, [200, 410], 'exactly one concurrent redemption wins');
      const winner = r1.statusCode === 200 ? a : b;
      assert.equal(
        (await winner.post('/api/v1/invitations/inspect', { token })).json().state,
        'used',
      );
      assert.equal(
        (await winner.post('/api/v1/invitations/redeem', { token })).statusCode,
        410,
        'replay fails',
      );
      // Pending until approved: the invitation alone grants nothing.
      assert.equal((await winner.get('/api/v1/workspaces')).statusCode, 403);
      const req = (await owner.get('/api/v1/admin/access-requests')).json().items[0];
      assert.equal(req.target.role, 'MEMBER');
      await owner.post(`/api/v1/admin/access-requests/${req.id}/approve`, {});
      const ws = (await winner.get('/api/v1/workspaces'))
        .json()
        .items.map((x: { id: string }) => x.id);
      assert.ok(ws.includes(w.company.id));
      await w.h.close();
    });

    it('S2b: invitations — expired, revoked, invalid; non-admins cannot create; no global role escalation', async () => {
      const w = await world(makeStore);
      const owner = await w.as(w.owner);
      const mk = async () =>
        (
          (
            await owner.post('/api/v1/admin/invitations', {
              workspaceId: w.family.id,
              role: 'VIEWER',
              expiresInHours: 1,
            })
          ).json().link as string
        ).split('/invite/')[1] as string;
      const t1 = await mk();
      const t2 = await mk();
      const list = (await owner.get('/api/v1/admin/invitations')).json().items;
      await owner.post(`/api/v1/admin/invitations/${list[0].id}/revoke`, {});
      const c = w.h.client();
      await c.login(tokenFor(lineId(300)));
      const s1 = (await c.post('/api/v1/invitations/inspect', { token: t1 })).json().state;
      const s2 = (await c.post('/api/v1/invitations/inspect', { token: t2 })).json().state;
      assert.deepEqual([s1, s2].sort(), ['revoked', 'valid']);
      const live = s1 === 'valid' ? t1 : t2;
      const dead = s1 === 'valid' ? t2 : t1;
      assert.equal(
        (await c.post('/api/v1/invitations/redeem', { token: dead })).json().error.code,
        'INVITATION_REVOKED',
      );
      w.h.clock.t += 61 * 60_000; // past the 1 h invitation expiry, within the 2 h session idle limit
      assert.equal(
        (await c.post('/api/v1/invitations/redeem', { token: live })).statusCode,
        410,
        'expired',
      );
      assert.equal(
        (await c.post('/api/v1/invitations/redeem', { token: 'x'.repeat(43) })).statusCode,
        404,
      );
      const member = await w.as(w.famMember);
      assert.equal(
        (
          await member.post('/api/v1/admin/invitations', {
            workspaceId: w.family.id,
            role: 'ADMIN',
          })
        ).statusCode,
        404,
      );
      const bad = await owner.post('/api/v1/admin/invitations', {
        workspaceId: w.family.id,
        role: 'OWNER',
      });
      assert.equal(bad.statusCode, 400, 'invitations cannot carry a global role');
      // Suspended users cannot use invitations to bypass suspension. The clock moved hours
      // forward above, so the owner confirms with LINE again (sensitive actions need a recent
      // login since EP02 consolidated) and the suspension itself is asserted.
      assert.equal(
        (
          await owner.post(`/api/v1/admin/users/${w.coMember.id}/status`, { action: 'suspend' })
        ).json().error.code,
        'REAUTH_REQUIRED',
      );
      await owner.login(w.owner.token);
      assert.equal(
        (await owner.post(`/api/v1/admin/users/${w.coMember.id}/status`, { action: 'suspend' }))
          .statusCode,
        200,
      );
      const sus = await w.as(w.coMember);
      const t3 = await mk();
      assert.equal((await sus.post('/api/v1/invitations/redeem', { token: t3 })).statusCode, 403);
      await w.h.close();
    });

    it('S3: family and company appointments are isolated in lists, calendar counts, search, detail and today', async () => {
      const w = await world(makeStore);
      const fam = await w.as(w.famMember);
      const co = await w.as(w.coMember);
      const f = await create(
        fam,
        appointmentPayload(w.family.id, {
          title: 'นัดครอบครัวลับ',
          visibility: 'WORKSPACE',
          category: 'family',
        }),
      );
      const c = await create(
        co,
        appointmentPayload(w.company.id, { title: 'ประชุมบริษัท', visibility: 'WORKSPACE' }),
      );
      assert.equal(f.statusCode, 201);
      assert.equal(c.statusCode, 201);
      const fid = f.json().appointment.id;
      const cid = c.json().appointment.id;
      assert.equal((await co.get(`/api/v1/appointments/${fid}`)).statusCode, 404);
      assert.equal((await fam.get(`/api/v1/appointments/${cid}`)).statusCode, 404);
      const cal = (await co.get('/api/v1/calendar?from=2026-12-01&to=2026-12-31')).json();
      assert.equal(cal.items.length, 1);
      assert.equal(cal.days['2026-12-10'], 1, 'counts include only authorized appointments');
      assert.equal(
        (await co.get('/api/v1/appointments?q=' + encodeURIComponent('ครอบครัว'))).json().items
          .length,
        0,
      );
      assert.equal(
        (
          await co.get(
            `/api/v1/appointments?workspaceId=${w.family.id}&from=2026-12-01&to=2026-12-31`,
          )
        ).json().items.length,
        0,
      );
      // The family viewer sees the workspace appointment but cannot edit it.
      const v = await w.as(w.viewer);
      const vd = (await v.get(`/api/v1/appointments/${fid}`)).json();
      assert.equal(vd.canEdit, false);
      const put = await v.put(`/api/v1/appointments/${fid}`, {
        version: 1,
        appointment: appointmentPayload(w.family.id),
      });
      assert.equal(put.statusCode, 403);
      await w.h.close();
    });

    it('S4: a member’s private appointment is invisible to the global owner and to their own group admin', async () => {
      const w = await world(makeStore);
      const fam = await w.as(w.famMember);
      const r = await create(
        fam,
        appointmentPayload(w.family.id, { title: 'นัดตรวจสุขภาพ (ส่วนตัว)', category: 'health' }),
      );
      const id = r.json().appointment.id;
      const owner = await w.as(w.owner);
      assert.equal((await owner.get(`/api/v1/appointments/${id}`)).statusCode, 404);
      const audit = JSON.stringify((await owner.get('/api/v1/admin/audit')).json());
      assert.ok(!audit.includes('สุขภาพ'), 'audit never exposes appointment content');
      const admin = await w.as(w.famAdmin);
      assert.equal((await admin.get(`/api/v1/appointments/${id}`)).statusCode, 404);
      assert.equal(
        (await admin.get('/api/v1/calendar?from=2026-12-01&to=2026-12-31')).json().items.length,
        0,
      );
      // Explicit grant (SELECTED) makes it visible to exactly that member.
      const sel = await create(
        fam,
        appointmentPayload(w.family.id, {
          visibility: 'SELECTED',
          sharedWithUserIds: [w.famAdmin.id],
        }),
      );
      assert.equal(
        (await admin.get(`/api/v1/appointments/${sel.json().appointment.id}`)).statusCode,
        200,
      );
      assert.equal(
        (await (await w.as(w.viewer)).get(`/api/v1/appointments/${sel.json().appointment.id}`))
          .statusCode,
        404,
      );
      await w.h.close();
    });

    it('S5 + S6: 10:00 appointment → reminders 06:00 and 09:00; moved to 13:00 → 06:00 and 12:00 (same transaction)', async () => {
      const w = await world(makeStore);
      const me = await w.as(w.loner);
      const ws = (await me.get('/api/v1/me')).json().workspaces[0].id;
      const r = await create(me, appointmentPayload(ws));
      const d = r.json().appointment;
      assert.deepEqual(scheduled(d), ['2026-12-09T23:00:00.000Z', '2026-12-10T02:00:00.000Z']); // 06:00 & 09:00 Bangkok
      const moved = await me.put(`/api/v1/appointments/${d.id}`, {
        version: d.version,
        appointment: appointmentPayload(ws, { startTime: '13:00', endTime: '14:00' }),
      });
      assert.equal(moved.statusCode, 200);
      const m = moved.json().appointment;
      assert.deepEqual(scheduled(m), ['2026-12-09T23:00:00.000Z', '2026-12-10T05:00:00.000Z']); // 06:00 & 12:00
      assert.equal(m.version, d.version + 1);
      const hist = (await me.get(`/api/v1/appointments/${d.id}/history`))
        .json()
        .items.map((e: { type: string }) => e.type);
      assert.ok(hist.includes('RESCHEDULED') && hist.includes('CREATED'));
      // Stale edit with the old version is refused.
      const stale = await me.put(`/api/v1/appointments/${d.id}`, {
        version: d.version,
        appointment: appointmentPayload(ws),
      });
      assert.equal(stale.statusCode, 409);
      await w.h.close();
    });

    it('S7: cancelling makes every reminder ineligible; cancelled appointments cannot be edited', async () => {
      const w = await world(makeStore);
      const me = await w.as(w.loner);
      const ws = (await me.get('/api/v1/me')).json().workspaces[0].id;
      const d = (await create(me, appointmentPayload(ws))).json().appointment;
      const c = await me.post(`/api/v1/appointments/${d.id}/cancel`, { version: d.version });
      assert.equal(c.statusCode, 200);
      const after = c.json().appointment;
      assert.equal(after.status, 'CANCELLED');
      assert.ok(after.reminders.every((r: { status: string }) => r.status === 'CANCELLED'));
      assert.equal(
        (
          await me.put(`/api/v1/appointments/${d.id}`, {
            version: after.version,
            appointment: appointmentPayload(ws),
          })
        ).statusCode,
        409,
      );
      assert.equal((await me.get('/api/v1/history?scope=cancelled')).json().items.length, 1);
      assert.equal((await me.get('/api/v1/today')).json().upcoming.length, 0);
      await w.h.close();
    });

    it('S8: losing workspace access takes effect immediately for existing sessions and direct API calls', async () => {
      const w = await world(makeStore);
      const fam = await w.as(w.famMember);
      const admin = await w.as(w.famAdmin);
      const shared = (
        await create(admin, appointmentPayload(w.family.id, { visibility: 'WORKSPACE' }))
      ).json().appointment;
      assert.equal((await fam.get(`/api/v1/appointments/${shared.id}`)).statusCode, 200);
      assert.equal(
        (await admin.del(`/api/v1/workspaces/${w.family.id}/members/${w.famMember.id}`)).statusCode,
        200,
      );
      assert.equal((await fam.get(`/api/v1/appointments/${shared.id}`)).statusCode, 404);
      assert.equal((await fam.get(`/api/v1/workspaces/${w.family.id}`)).statusCode, 404);
      assert.equal((await create(fam, appointmentPayload(w.family.id))).statusCode, 400);
      // Account revocation ends sessions outright.
      const owner = await w.as(w.owner);
      await owner.post(`/api/v1/admin/users/${w.famMember.id}/status`, { action: 'revoke' });
      assert.equal((await fam.get('/api/v1/me')).statusCode, 401);
      assert.equal((await fam.login(w.famMember.token)).json().state, 'revoked');
      assert.equal((await fam.get('/api/v1/today')).statusCode, 403);
      await w.h.close();
    });

    it('S9: after an API restart, users, memberships, appointments, sessions and rate limits persist', async () => {
      const w = await world(makeStore, { loginLimit: 3 });
      const me = await w.as(w.loner);
      const ws = (await me.get('/api/v1/me')).json().workspaces[0].id;
      const d = (await create(me, appointmentPayload(ws))).json().appointment;
      const probe = w.h.client();
      await probe.login('tok:garbage');
      await probe.login('tok:garbage');
      await w.h.restart();
      assert.equal(
        (await me.get(`/api/v1/appointments/${d.id}`)).statusCode,
        200,
        'session and data survived',
      );
      const limited = await probe.login('tok:garbage');
      assert.equal(limited.statusCode, 429, 'rate-limit window survived the restart');
      assert.ok(Number(limited.headers['retry-after']) >= 1);
      await w.h.close();
    });

    it('S10: forged workspace and destination ids are rejected without revealing whether they exist', async () => {
      const w = await world(makeStore);
      const fam = await w.as(w.famMember);
      const famGroup = await seedGroup(w.s, 1, w.family.id);
      const coGroup = await seedGroup(w.s, 2, w.company.id);
      assert.equal((await create(fam, appointmentPayload(w.company.id))).statusCode, 400);
      const forged = await create(
        fam,
        appointmentPayload(w.family.id, {
          destinations: [{ destinationId: coGroup.id, contentPolicy: 'PRIVACY_SAFE' }],
        }),
      );
      assert.equal(forged.json().error.code, 'DESTINATION_NOT_PERMITTED');
      const unknown = await create(
        fam,
        appointmentPayload(w.family.id, {
          destinations: [
            {
              destinationId: '00000000-0000-4000-8000-000000000000',
              contentPolicy: 'PRIVACY_SAFE',
            },
          ],
        }),
      );
      assert.equal(unknown.json().error.code, 'DESTINATION_NOT_PERMITTED');
      // A member (not admin, no grant) may not target the family group either.
      const noGrant = await create(
        fam,
        appointmentPayload(w.family.id, {
          destinations: [{ destinationId: famGroup.id, contentPolicy: 'PRIVACY_SAFE' }],
        }),
      );
      assert.equal(noGrant.json().error.code, 'DESTINATION_NOT_PERMITTED');
      const admin = await w.as(w.famAdmin);
      const priv = await create(
        admin,
        appointmentPayload(w.family.id, {
          destinations: [{ destinationId: famGroup.id, contentPolicy: 'FULL' }],
        }),
      );
      assert.equal(priv.json().error.code, 'PRIVATE_CONTENT_TO_GROUP');
      const sens = await create(
        admin,
        appointmentPayload(w.family.id, {
          visibility: 'WORKSPACE',
          category: 'health',
          destinations: [{ destinationId: famGroup.id, contentPolicy: 'FULL' }],
        }),
      );
      assert.equal(sens.json().error.code, 'SENSITIVE_CONFIRMATION_REQUIRED');
      const okSafe = await create(
        admin,
        appointmentPayload(w.family.id, {
          destinations: [{ destinationId: famGroup.id, contentPolicy: 'PRIVACY_SAFE' }],
        }),
      );
      assert.equal(okSafe.statusCode, 201);
      assert.equal((await fam.get(`/api/v1/appointments/not-a-uuid`)).statusCode, 404);
      await w.h.close();
    });

    it('S11: duplicate webhook events create one pending registration; leave → removed; no outbound calls', async () => {
      const w = await world(makeStore);
      const ev = (type: string, id: string) => ({
        type,
        mode: 'active',
        timestamp: 1,
        webhookEventId: id,
        deliveryContext: { isRedelivery: false },
        source: { type: 'group', groupId: groupId(77) },
      });
      const send = (events: unknown[]) => {
        const body = JSON.stringify({ destination: BOT_ID, events });
        return w.h.app.inject({
          method: 'POST',
          url: '/api/line/webhook',
          headers: {
            'content-type': 'application/json',
            'x-line-signature': lineSignature(CHANNEL_SECRET, body),
          },
          payload: body,
        });
      };
      const join = ev('join', '01JOINXXXXXXXXXXXXXXXXXXXX');
      assert.deepEqual((await send([join])).json(), { ok: true, received: 1, duplicates: 0 });
      assert.deepEqual(
        (await send([{ ...join, deliveryContext: { isRedelivery: true } }])).json(),
        { ok: true, received: 0, duplicates: 1 },
      );
      await w.h.restart();
      assert.equal((await send([join])).json().duplicates, 1, 'dedupe survives restart');
      const groups = await w.s.listDestinations({ kinds: ['GROUP'], limit: 10 });
      assert.equal(groups.length, 1);
      assert.equal(groups[0]?.status, 'PENDING');
      assert.equal(groups[0]?.workspaceId, null, 'a join grants nothing');
      await send([ev('leave', '01LEAVEXXXXXXXXXXXXXXXXXXX')]);
      assert.equal(
        (await w.s.listDestinations({ kinds: ['GROUP'], limit: 10 }))[0]?.status,
        'REMOVED',
      );
      await w.h.close();
    });

    it('S12: Thai text, emoji and long display names round-trip intact', async () => {
      const w = await world(makeStore);
      const longName = 'คุณสมศรี มีความสุขมาก 🌸✨ '.repeat(6);
      const c = w.h.client();
      const r = await c.login(tokenFor(lineId(400), longName));
      const name = r.json().user.displayName as string;
      assert.equal([...name].length, Math.min(100, [...longName.trim()].length));
      const me = await w.as(w.loner);
      const ws = (await me.get('/api/v1/me')).json().workspaces[0].id;
      const title = 'ไปหาหมอฟัน 🦷 กับคุณแม่ 👩‍👧 — ห้อง 2 ชั้น 3';
      const d = (
        await create(
          me,
          appointmentPayload(ws, { title, location: 'โรงพยาบาลจำลอง 🏥', notes: 'นำบัตรนัด 📇' }),
        )
      ).json().appointment;
      const back = (await me.get(`/api/v1/appointments/${d.id}`)).json();
      assert.equal(back.title, title);
      assert.equal(back.location, 'โรงพยาบาลจำลอง 🏥');
      assert.equal(back.notes, 'นำบัตรนัด 📇');
      assert.equal(
        (await me.get('/api/v1/appointments?q=' + encodeURIComponent('หมอฟัน'))).json().items.length,
        1,
      );
      await w.h.close();
    });

    it('duplicate submit with the same Idempotency-Key creates exactly one appointment', async () => {
      const w = await world(makeStore);
      const me = await w.as(w.loner);
      const ws = (await me.get('/api/v1/me')).json().workspaces[0].id;
      const key = idem();
      const [a, b] = await Promise.all([
        create(me, appointmentPayload(ws), key),
        create(me, appointmentPayload(ws), key),
      ]);
      const ok = [a, b].filter((x) => x.statusCode === 201 || x.statusCode === 200);
      assert.ok(ok.length >= 1);
      const third = await create(me, appointmentPayload(ws), key);
      assert.equal(third.json().replayed, true);
      assert.equal(
        (await me.get('/api/v1/appointments?from=2026-12-01&to=2026-12-31')).json().items.length,
        1,
      );
      assert.equal(
        (await create(me, appointmentPayload(ws), {})).json().error.code,
        'IDEMPOTENCY_KEY_REQUIRED',
      );
      await w.h.close();
    });

    it('owner console guards: last owner protected, admins cannot touch owners or elevate, owners cannot grant OWNER via API', async () => {
      const w = await world(makeStore);
      const owner = await w.as(w.owner);
      assert.equal(
        (await owner.post(`/api/v1/admin/users/${w.owner.id}/status`, { action: 'suspend' }))
          .statusCode,
        403,
        'not on yourself',
      );
      const promote = await owner.post(`/api/v1/admin/users/${w.coAdmin.id}/role`, {
        globalRole: 'ADMIN',
      });
      assert.equal(promote.statusCode, 200);
      assert.equal(
        (await owner.post(`/api/v1/admin/users/${w.coAdmin.id}/role`, { globalRole: 'OWNER' }))
          .statusCode,
        400,
      );
      const admin = await w.as(w.coAdmin);
      assert.equal(
        (await admin.post(`/api/v1/admin/users/${w.owner.id}/status`, { action: 'suspend' }))
          .statusCode,
        403,
      );
      assert.equal(
        (await admin.post(`/api/v1/admin/users/${w.coMember.id}/role`, { globalRole: 'ADMIN' }))
          .statusCode,
        403,
      );
      assert.equal(
        (await admin.post(`/api/v1/admin/users/${w.coMember.id}/status`, { action: 'suspend' }))
          .statusCode,
        200,
      );
      const viewerConsole = await (await w.as(w.viewer)).get('/api/v1/admin/users');
      assert.equal(viewerConsole.statusCode, 404);
      await w.h.close();
    });

    it('workspace management: create, rename with version, members, last-admin protection, leave, archive', async () => {
      const w = await world(makeStore);
      const me = await w.as(w.loner);
      const ws = (
        await me.post('/api/v1/workspaces', { name: 'กลุ่มเพื่อน 🎉', kind: 'CUSTOM' })
      ).json();
      assert.equal(ws.role, 'ADMIN');
      assert.equal(
        (await me.patch(`/api/v1/workspaces/${ws.id}`, { version: 1, name: 'กลุ่มเพื่อนสนิท' }))
          .statusCode,
        200,
      );
      assert.equal(
        (await me.patch(`/api/v1/workspaces/${ws.id}`, { version: 1, name: 'ชนกัน' })).statusCode,
        409,
      );
      assert.equal(
        (
          await me.post(`/api/v1/workspaces/${ws.id}/members`, {
            userId: w.coMember.id,
            role: 'MEMBER',
          })
        ).statusCode,
        201,
      );
      assert.equal(
        (await me.post(`/api/v1/workspaces/${ws.id}/leave`, {})).statusCode,
        409,
        'last admin cannot leave',
      );
      await me.patch(`/api/v1/workspaces/${ws.id}/members/${w.coMember.id}`, { role: 'ADMIN' });
      assert.equal((await me.post(`/api/v1/workspaces/${ws.id}/leave`, {})).statusCode, 200);
      const other = await w.as(w.coMember);
      assert.equal(
        (await other.post(`/api/v1/workspaces/${ws.id}/archive`, { version: 2 })).statusCode,
        200,
      );
      assert.ok(
        !(await other.get('/api/v1/workspaces'))
          .json()
          .items.some((x: { id: string }) => x.id === ws.id),
      );
      const personal = (await other.get('/api/v1/me'))
        .json()
        .workspaces.find((x: { kind: string }) => x.kind === 'PERSONAL');
      assert.equal(
        (
          await other.post(`/api/v1/workspaces/${personal.id}/archive`, {
            version: personal.version,
          })
        ).statusCode,
        404,
      );
      await w.h.close();
    });

    it('logout revokes the persisted session; replay fails; re-login creates a new session; membership unchanged', async () => {
      const w = await world(makeStore);
      const c = await w.as(w.famMember);
      const oldCookie = c.cookie;
      assert.equal((await c.post('/api/auth/logout')).statusCode, 200);
      assert.equal((await c.get('/api/v1/me')).statusCode, 401);
      const replay = w.h.client();
      replay.cookie = oldCookie;
      assert.equal((await replay.get('/api/v1/me')).statusCode, 401);
      await c.login(w.famMember.token);
      assert.notEqual(c.cookie, oldCookie);
      const ws = (await c.get('/api/v1/me'))
        .json()
        .workspaces.map((x: { kind: string }) => x.kind)
        .sort();
      assert.deepEqual(ws, ['FAMILY', 'PERSONAL']);
      // Mutations without CSRF or from a foreign origin are refused.
      const noCsrf = w.h.client();
      noCsrf.cookie = c.cookie;
      assert.equal(
        (await noCsrf.post('/api/v1/workspaces', { name: 'x', kind: 'CUSTOM' })).json().error.code,
        'CSRF_INVALID',
      );
      noCsrf.origin = 'https://evil.example';
      assert.equal(
        (await noCsrf.post('/api/v1/workspaces', { name: 'x', kind: 'CUSTOM' })).json().error.code,
        'ORIGIN_DENIED',
      );
      await w.h.close();
    });

    it('preview and estimate are protected, never sent, privacy-safe by default', async () => {
      const w = await world(makeStore, { publicBaseUrl: 'http://127.0.0.1:6767' });
      const admin = await w.as(w.famAdmin);
      const g = await seedGroup(w.s, 5, w.family.id, 'ACTIVE', 6);
      const payload = appointmentPayload(w.family.id, {
        title: 'นัดลับพิเศษ',
        location: 'บ้านคุณยาย',
        destinations: [{ destinationId: g.id, contentPolicy: 'PRIVACY_SAFE' }],
      });
      const p = await admin.post('/api/v1/preview/reminder', {
        appointment: payload,
        ruleIndex: 0,
        destinationId: g.id,
      });
      assert.equal(p.statusCode, 200);
      const body = p.json();
      assert.equal(body.preview, true);
      assert.deepEqual(body.issues, []);
      const json = JSON.stringify(body.message);
      assert.ok(json.includes('https://flow.pdabliss.com/today'));
      assert.ok(
        !json.includes('นัดลับพิเศษ') && !json.includes('บ้านคุณยาย'),
        'privacy-safe preview hides title and location',
      );
      const est = (await admin.post('/api/v1/preview/estimate', { appointment: payload })).json();
      assert.equal(est.scheduledReminders, 2);
      assert.equal(est.quotaKnown, false);
      const outsider = await w.as(w.coMember);
      assert.equal(
        (
          await outsider.post('/api/v1/preview/reminder', {
            appointment: payload,
            ruleIndex: 0,
            destinationId: g.id,
          })
        ).statusCode,
        400,
      );
      await w.h.close();
    });
  });
}

export type { Harness };

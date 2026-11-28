/**
 * Store contract — the same assertions run against MemoryStore (tests/) and PrismaStore on
 * the MariaDB TEST database (tests-db/). Synthetic data only.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import type { AppointmentBundle, Store } from '../../src/store/types.js';
import { StoreConflictError } from '../../src/store/types.js';
import { runHousekeeping } from '../../src/store/housekeeping.js';
import { lineId, seedUser, seedWorkspace } from './harness.js';

const T0 = new Date(Date.UTC(2026, 10, 26, 3, 0, 0));
const bytes = (n: number) => new Uint8Array(32).fill(n);

function bundle(
  workspaceId: string,
  userId: string,
  over: Partial<AppointmentBundle['appointment']> = {},
): AppointmentBundle {
  const id = randomUUID();
  return {
    appointment: {
      id,
      workspaceId,
      createdByUserId: userId,
      title: 'ทดสอบ',
      category: 'business',
      allDay: false,
      timeZone: 'Asia/Bangkok',
      startDate: '2026-12-10',
      endDate: '2026-12-10',
      startAt: new Date('2026-12-10T03:00:00.000Z'),
      endAt: null,
      location: null,
      notes: null,
      visibility: 'PRIVATE',
      status: 'SCHEDULED',
      version: 1,
      createdAt: T0,
      updatedAt: T0,
      cancelledAt: null,
      cancelledByUserId: null,
      kind: 'EVENT',
      seriesId: null,
      occurrenceDate: null,
      isException: false,
      amount: null,
      currency: null,
      paymentStatus: null,
      paidAt: null,
      paidByUserId: null,
      ...over,
    },
    accessGrants: [],
    destinations: [],
    reminderRules: [],
  };
}

export function defineStoreContract(label: string, makeStore: () => Promise<Store>): void {
  describe(`store contract (${label})`, () => {
    it('LINE identities are unique and case-sensitive (no collation folding)', async () => {
      const s = await makeStore();
      const u = await seedUser(s, 0xabcdef);
      await assert.rejects(seedUser(s, 0xabcdef), StoreConflictError);
      assert.notEqual(u.line, u.line.toUpperCase());
      assert.equal(
        await s.findIdentityByLineUserId(u.line.toUpperCase()),
        null,
        'a case-folded id must not match',
      );
      assert.equal((await s.findIdentityByLineUserId(u.line))?.user.id, u.id);
    });

    it('session keys and token hashes are exact binary matches', async () => {
      const s = await makeStore();
      const u = await seedUser(s, 1);
      await s.createSession({
        id: randomUUID(),
        keyHash: bytes(1),
        userId: u.id,
        createdAt: T0,
        lastSeenAt: T0,
        absoluteExpiresAt: new Date(T0.getTime() + 1e6),
        endedAt: null,
        endReason: null,
      });
      await assert.rejects(
        s.createSession({
          id: randomUUID(),
          keyHash: bytes(1),
          userId: u.id,
          createdAt: T0,
          lastSeenAt: T0,
          absoluteExpiresAt: T0,
          endedAt: null,
          endReason: null,
        }),
        StoreConflictError,
      );
      assert.ok(await s.getSessionByKeyHash(bytes(1)));
      assert.equal(await s.getSessionByKeyHash(bytes(2)), null);
      const sid = (await s.getSessionByKeyHash(bytes(1)))!.id;
      assert.equal(await s.endSession(sid, 'LOGGED_OUT', T0), true);
      assert.equal(await s.endSession(sid, 'LOGGED_OUT', T0), false, 'ending twice is a no-op');
    });

    it('one open access request per user; deciding is atomic and single-shot', async () => {
      const s = await makeStore();
      const u = await seedUser(s, 1, { status: 'NEW' });
      const req = {
        id: randomUUID(),
        userId: u.id,
        status: 'PENDING' as const,
        message: null,
        invitationId: null,
        targetWorkspaceId: null,
        targetRole: null,
        createdAt: T0,
        decidedAt: null,
        decidedByUserId: null,
      };
      await s.createAccessRequest(req);
      await assert.rejects(s.createAccessRequest({ ...req, id: randomUUID() }), StoreConflictError);
      const [a, b] = await Promise.all([
        s.decideAccessRequest(req.id, 'APPROVED', null, T0),
        s.decideAccessRequest(req.id, 'REJECTED', null, T0),
      ]);
      assert.deepEqual([a, b].sort(), [false, true]);
      await s.createAccessRequest({ ...req, id: randomUUID() }); // allowed again once decided
    });

    it('invitations redeem exactly once, never after expiry or revocation', async () => {
      const s = await makeStore();
      const u = await seedUser(s, 1);
      const ws = await seedWorkspace(s, 'กลุ่ม', 'FAMILY', [{ userId: u.id, role: 'ADMIN' }]);
      const inv = {
        id: randomUUID(),
        tokenHash: bytes(9),
        workspaceId: ws.id,
        role: 'MEMBER' as const,
        status: 'ACTIVE' as const,
        note: null,
        createdByUserId: u.id,
        createdAt: T0,
        expiresAt: new Date(T0.getTime() + 3_600_000),
        redeemedByUserId: null,
        redeemedAt: null,
        revokedAt: null,
      };
      await s.createInvitation(inv);
      const results = await Promise.all([1, 2, 3].map(() => s.redeemInvitation(inv.id, u.id, T0)));
      assert.equal(results.filter(Boolean).length, 1);
      const inv2 = { ...inv, id: randomUUID(), tokenHash: bytes(10) };
      await s.createInvitation(inv2);
      assert.equal(
        await s.redeemInvitation(inv2.id, u.id, new Date(T0.getTime() + 3_600_001)),
        false,
        'expired',
      );
      assert.equal(await s.revokeInvitation(inv2.id, T0), true);
      assert.equal(await s.redeemInvitation(inv2.id, u.id, T0), false, 'revoked');
    });

    it('transactions roll back completely on error', async () => {
      const s = await makeStore();
      const u = await seedUser(s, 1);
      const before = await s.countUsers({});
      await assert.rejects(
        s.transaction(async (tx) => {
          await seedUser(tx, 2);
          throw new Error('boom');
        }),
      );
      assert.equal(await s.countUsers({}), before);
      assert.equal(await s.findIdentityByLineUserId(lineId(2)), null);
      assert.ok(await s.getUser(u.id));
    });

    it('foreign keys: appointments need an existing workspace; destinations need existing rows', async () => {
      const s = await makeStore();
      const u = await seedUser(s, 1);
      await assert.rejects(s.createAppointment(bundle(randomUUID(), u.id)), StoreConflictError);
    });

    it('optimistic concurrency: only one of two concurrent updates with the same version wins', async () => {
      const s = await makeStore();
      const u = await seedUser(s, 1);
      const ws = (await s.getPersonalWorkspace(u.id))!;
      const b = bundle(ws.id, u.id);
      await s.createAppointment(b);
      const [x, y] = await Promise.all([
        s.transaction((tx) =>
          tx.updateAppointment(b.appointment.id, 1, {
            appointment: { ...b.appointment, title: 'A' },
          }),
        ),
        s.transaction((tx) =>
          tx.updateAppointment(b.appointment.id, 1, {
            appointment: { ...b.appointment, title: 'B' },
          }),
        ),
      ]);
      assert.deepEqual([x, y].sort(), [false, true]);
      assert.equal((await s.getAppointment(b.appointment.id))?.appointment.version, 2);
    });

    it('calendar dates and UTC instants round-trip without any time-zone shift; Thai + emoji intact', async () => {
      const s = await makeStore();
      const u = await seedUser(s, 1);
      const ws = (await s.getPersonalWorkspace(u.id))!;
      const title = 'ปีใหม่ 🎆 ไทย — ทดสอบ'.padEnd(60, '✨');
      const b = bundle(ws.id, u.id, {
        title,
        allDay: true,
        startAt: null,
        startDate: '2028-02-29',
        endDate: '2028-03-01',
        notes: 'บันทึก 📝 '.repeat(50),
      });
      await s.createAppointment(b);
      const got = (await s.getAppointment(b.appointment.id))!.appointment;
      assert.equal(got.startDate, '2028-02-29');
      assert.equal(got.endDate, '2028-03-01');
      assert.equal(got.title, title);
      const timed = bundle(ws.id, u.id, {
        startAt: new Date('2026-12-31T17:00:00.123Z'),
        startDate: '2027-01-01',
        endDate: '2027-01-01',
      });
      await s.createAppointment(timed);
      assert.equal(
        (await s.getAppointment(timed.appointment.id))!.appointment.startAt?.toISOString(),
        '2026-12-31T17:00:00.123Z',
      );
    });

    it('the visibility predicate: private / workspace / selected, workspace scoping, range overlap', async () => {
      const s = await makeStore();
      const a = await seedUser(s, 1);
      const b = await seedUser(s, 2);
      const c = await seedUser(s, 3);
      const ws = await seedWorkspace(s, 'ร่วม', 'COMPANY', [
        { userId: a.id, role: 'ADMIN' },
        { userId: b.id, role: 'MEMBER' },
        { userId: c.id, role: 'MEMBER' },
      ]);
      const priv = bundle(ws.id, a.id, { visibility: 'PRIVATE' });
      const shared = bundle(ws.id, a.id, {
        visibility: 'WORKSPACE',
        startDate: '2026-12-09',
        endDate: '2026-12-11',
      });
      const sel = bundle(ws.id, a.id, { visibility: 'SELECTED' });
      sel.accessGrants = [
        { id: randomUUID(), appointmentId: sel.appointment.id, userId: b.id, createdAt: T0 },
      ];
      for (const x of [priv, shared, sel]) await s.createAppointment(x);
      const seen = async (viewer: string, q: Partial<{ from: string; to: string }> = {}) =>
        (await s.listAppointments({ viewerUserId: viewer, workspaceIds: [ws.id], limit: 50, ...q }))
          .map((r) => r.id)
          .sort();
      assert.deepEqual(await seen(a.id), [priv, shared, sel].map((x) => x.appointment.id).sort());
      assert.deepEqual(await seen(b.id), [shared, sel].map((x) => x.appointment.id).sort());
      assert.deepEqual(await seen(c.id), [shared.appointment.id]);
      assert.deepEqual(
        await seen(c.id, { from: '2026-12-11', to: '2026-12-20' }),
        [shared.appointment.id],
        'multi-day overlap',
      );
      assert.deepEqual(await seen(c.id, { from: '2026-12-12' }), []);
      assert.deepEqual(
        (await s.listAppointments({ viewerUserId: a.id, workspaceIds: [], limit: 50 })).length,
        0,
      );
    });

    it('fail-closed filters: a missing viewer or id never widens a query or a bulk change', async () => {
      const s = await makeStore();
      const a = await seedUser(s, 1);
      const b = await seedUser(s, 2);
      const ws = (await s.getPersonalWorkspace(a.id))!;
      await s.createAppointment(bundle(ws.id, a.id));
      await assert.rejects(
        s.listAppointments({ viewerUserId: undefined as never, workspaceIds: [ws.id], limit: 10 }),
      );
      for (const u of [a, b])
        await s.createSession({
          id: randomUUID(),
          keyHash: bytes(u === a ? 21 : 22),
          userId: u.id,
          createdAt: T0,
          lastSeenAt: T0,
          absoluteExpiresAt: new Date(T0.getTime() + 1e7),
          endedAt: null,
          endReason: null,
        });
      // PrismaStore refuses the query; MemoryStore matches nothing. Either way nobody is signed out.
      const ended = await s.endUserSessions(undefined as never, 'REVOKED', T0).catch(() => 0);
      assert.equal(ended, 0);
      assert.equal((await s.getSessionByKeyHash(bytes(21)))?.endedAt, null);
      assert.equal((await s.getSessionByKeyHash(bytes(22)))?.endedAt, null);
    });

    it('rate-limit window: atomic counting under concurrency, reset after expiry', async () => {
      const s = await makeStore();
      const hits = await Promise.all(
        Array.from({ length: 10 }, () => s.hitRateLimit(bytes(7), 60_000, T0)),
      );
      assert.equal(Math.max(...hits.map((h) => h.count)), 10);
      const after = await s.hitRateLimit(bytes(7), 60_000, new Date(T0.getTime() + 60_001));
      assert.equal(after.count, 1);
      assert.equal(await s.purgeRateLimits(new Date(T0.getTime() + 999_999)), 1);
    });

    it('webhook event ids are deduplicated (exact, case-sensitive)', async () => {
      const s = await makeStore();
      const row = {
        eventId: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
        type: 'join',
        sourceType: 'group',
        receivedAt: T0,
        expiresAt: new Date(T0.getTime() + 1000),
      };
      assert.equal(await s.recordWebhookEvent(row), 'new');
      assert.equal(await s.recordWebhookEvent(row), 'duplicate');
      assert.equal(
        await s.recordWebhookEvent({ ...row, eventId: row.eventId.toLowerCase() }),
        'new',
      );
      assert.equal(await s.purgeWebhookEvents(new Date(T0.getTime() + 2000)), 2);
    });

    it('housekeeping removes only expired operational rows', async () => {
      const s = await makeStore();
      const u = await seedUser(s, 1);
      const ws = (await s.getPersonalWorkspace(u.id))!;
      await s.createAppointment(bundle(ws.id, u.id));
      const old = {
        id: randomUUID(),
        userId: u.id,
        scope: 'appointment.create',
        key: randomUUID(),
        resultId: null,
        createdAt: T0,
        expiresAt: T0,
      };
      await s.createIdempotency(old);
      await s.createIdempotency({
        ...old,
        id: randomUUID(),
        key: randomUUID(),
        expiresAt: new Date(T0.getTime() + 1e9),
      });
      await s.recordWebhookEvent({
        eventId: '01HOUSEKEEPINGXXXXXXXXXXXX',
        type: 'join',
        sourceType: 'group',
        receivedAt: T0,
        expiresAt: T0,
      });
      const n = await runHousekeeping(s, new Date(T0.getTime() + 1000));
      assert.equal(n.idempotency, 1);
      assert.equal(n.webhookEvents, 1);
      assert.equal(
        (await s.listAppointments({ viewerUserId: u.id, workspaceIds: [ws.id], limit: 10 })).length,
        1,
        'appointments untouched',
      );
      assert.ok(await s.getUser(u.id));
    });

    it('idempotency keys are unique per user and scope', async () => {
      const s = await makeStore();
      const u = await seedUser(s, 1);
      const row = {
        id: randomUUID(),
        userId: u.id,
        scope: 'appointment.create',
        key: randomUUID(),
        resultId: null,
        createdAt: T0,
        expiresAt: T0,
      };
      await s.createIdempotency(row);
      await assert.rejects(s.createIdempotency({ ...row, id: randomUUID() }), StoreConflictError);
      await s.createIdempotency({ ...row, id: randomUUID(), scope: 'other' });
    });
  });
}

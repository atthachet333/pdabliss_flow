/**
 * EP02 consolidated scenarios (member colours, recurrence, bills, Administration Center,
 * Activity Center redaction, offboarding). Shared by the MemoryStore suite (tests/) and the
 * real MariaDB suite (tests-db/). Synthetic identities and data only.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Store } from '../../src/store/types.js';
import {
  appointmentPayload,
  createHarness,
  idem,
  seedGroup,
  seedUser,
  seedWorkspace,
  type Client,
} from './harness.js';

type StoreFactory = () => Promise<Store>;
const BKK = (d: string, t: string) => new Date(`${d}T${t}:00+07:00`).toISOString();

async function world(makeStore: StoreFactory) {
  const h = await createHarness({ store: await makeStore() });
  const s = h.store;
  const owner = await seedUser(s, 11, { name: 'เจ้าของระบบ', globalRole: 'OWNER' });
  const gAdmin = await seedUser(s, 12, { name: 'ผู้ดูแลระบบ', globalRole: 'ADMIN' });
  const lead = await seedUser(s, 13, { name: 'หัวหน้าทีม' });
  const staff = await seedUser(s, 14, { name: 'พนักงาน' });
  const viewer = await seedUser(s, 15, { name: 'ผู้ชม' });
  const outsider = await seedUser(s, 16, { name: 'คนนอก' });
  const company = await seedWorkspace(s, 'บริษัทจำลอง', 'COMPANY', [
    { userId: lead.id, role: 'ADMIN' },
    { userId: staff.id, role: 'MEMBER' },
    { userId: viewer.id, role: 'VIEWER' },
  ]);
  const family = await seedWorkspace(s, 'ครอบครัวจำลอง', 'FAMILY', [
    { userId: staff.id, role: 'ADMIN' },
  ]);
  const as = async (u: { token: string }): Promise<Client> => {
    const c = h.client();
    assert.equal((await c.login(u.token)).statusCode, 200);
    return c;
  };
  const personal = async (c: Client) =>
    (await c.get('/api/v1/me'))
      .json()
      .workspaces.find((w: { kind: string }) => w.kind === 'PERSONAL').id as string;
  return { h, s, owner, gAdmin, lead, staff, viewer, outsider, company, family, as, personal };
}

async function create(c: Client, payload: unknown) {
  const r = await c.post('/api/v1/appointments', payload, idem());
  assert.ok(r.statusCode === 201, `create ${r.statusCode} ${r.body}`);
  return r.json().appointment;
}

async function occurrences(c: Client, from: string, to: string, title: string) {
  const r = (await c.get(`/api/v1/calendar?from=${from}&to=${to}`)).json();
  return (r.items as { title: string; startDate: string; id: string; series: unknown }[])
    .filter((i) => i.title === title)
    .map((i) => i.startDate);
}

const fireTimes = (d: { reminders: { status: string; fireAt: string | null }[] }) =>
  d.reminders.map((r) => `${r.status}:${r.fireAt}`);

export function defineConsolidated(label: string, makeStore: StoreFactory): void {
  describe(`EP02 consolidated (${label})`, () => {
    it('C1: members choose their own identity colour per workspace; validated, persistent, shown only where already visible', async () => {
      const w = await world(makeStore);
      const staff = await w.as(w.staff);
      const detail = (await staff.get(`/api/v1/workspaces/${w.company.id}`)).json();
      const mine = detail.members.find((m: { me: boolean }) => m.me);
      assert.equal(mine.customColor, false, 'default colour first');
      assert.match(mine.color, /^[a-z]+$/);
      assert.equal(
        (await staff.put(`/api/v1/workspaces/${w.company.id}/my-color`, { color: 'plum' }))
          .statusCode,
        200,
      );
      assert.equal(
        (await staff.put(`/api/v1/workspaces/${w.family.id}/my-color`, { color: 'ocean' }))
          .statusCode,
        200,
      );
      for (const bad of ['red', '#ff0000', 'plum;background:url(x)', 'PLUM'])
        assert.equal(
          (await staff.put(`/api/v1/workspaces/${w.company.id}/my-color`, { color: bad }))
            .statusCode,
          400,
          bad,
        );
      // Not a member → 404; there is no API to change someone else's colour.
      const out = await w.as(w.outsider);
      assert.equal(
        (await out.put(`/api/v1/workspaces/${w.company.id}/my-color`, { color: 'jade' }))
          .statusCode,
        404,
      );
      // Persists across logout, a new session and workspace switching; per workspace.
      await w.h.restart();
      const again = await w.as(w.staff);
      const colorIn = async (ws: string, who: string) =>
        (await again.get(`/api/v1/workspaces/${ws}`))
          .json()
          .members.find((m: { userId: string }) => m.userId === who).color;
      assert.equal(await colorIn(w.company.id, w.staff.id), 'plum');
      assert.equal(await colorIn(w.family.id, w.staff.id), 'ocean');
      // Other members see it in the member list and on appointments they can already see.
      const lead = await w.as(w.lead);
      const shared = await create(
        again,
        appointmentPayload(w.company.id, { title: 'ประชุมทีม', visibility: 'WORKSPACE' }),
      );
      const seen = (await lead.get(`/api/v1/appointments/${shared.id}`)).json();
      assert.deepEqual(seen.creator, { displayName: 'พนักงาน', color: 'plum' });
      // A private appointment never surfaces through colour metadata.
      const priv = await create(again, appointmentPayload(w.company.id, { title: 'ลับเฉพาะ' }));
      assert.equal((await lead.get(`/api/v1/appointments/${priv.id}`)).statusCode, 404);
      const cal = (await lead.get('/api/v1/calendar?from=2026-12-01&to=2026-12-31')).json();
      assert.ok(!JSON.stringify(cal).includes('ลับเฉพาะ'));
      // Reset to default.
      await again.put(`/api/v1/workspaces/${w.company.id}/my-color`, { color: null });
      assert.equal(
        (await again.get(`/api/v1/workspaces/${w.company.id}`))
          .json()
          .members.find((m: { me: boolean }) => m.me).customColor,
        false,
      );
      // Personal appointments carry no creator decoration.
      const own = await create(again, appointmentPayload(await w.personal(again)));
      assert.equal(own.creator, null);
      await w.h.close();
    });

    it('C2: monthly on the 31st materializes a bounded, duplicate-free series with month-end and leap-year handling', async () => {
      const w = await world(makeStore);
      const c = await w.as(w.staff);
      const ws = await w.personal(c);
      const payload = appointmentPayload(ws, {
        title: 'ทบทวนสิ้นเดือน',
        date: '2026-12-31',
        recurrence: { frequency: 'MONTHLY', monthDay: 31, missingDay: 'LAST_DAY' },
      });
      const key = idem();
      const first = await c.post('/api/v1/appointments', payload, key);
      assert.equal(first.statusCode, 201);
      const replay = await c.post('/api/v1/appointments', payload, key);
      assert.equal(replay.statusCode, 200, 'idempotent replay');
      assert.equal(replay.json().appointment.id, first.json().appointment.id);
      const a = first.json().appointment;
      assert.equal(a.series.frequency, 'MONTHLY');
      assert.equal(a.recurrence.rule.monthDay, 31);
      assert.match(a.recurrence.descriptionTh, /วันสุดท้ายของเดือน/);
      assert.deepEqual(await occurrences(c, '2027-01-01', '2027-03-02', 'ทบทวนสิ้นเดือน'), [
        '2027-01-31',
        '2027-02-28',
      ]);
      assert.deepEqual(await occurrences(c, '2028-02-01', '2028-03-01', 'ทบทวนสิ้นเดือน'), [
        '2028-02-29',
      ]);
      // Bounded horizon: 24 months for monthly (Dec 2026 … Nov 2028), never unbounded.
      assert.deepEqual(await occurrences(c, '2028-12-01', '2029-01-31', 'ทบทวนสิ้นเดือน'), []);
      // Re-running the rolling extension never duplicates an occurrence.
      const ext = await w.h.app.flowExtendSeries?.();
      assert.equal(ext?.created, 0);
      const search = (await c.get('/api/v1/appointments?q=ทบทวน&limit=100')).json();
      const dates = search.items.map((i: { startDate: string }) => i.startDate);
      assert.equal(new Set(dates).size, dates.length, 'no duplicate occurrences');
      // Dec 2026 … Oct 2028: the 30 Nov 2028 occurrence lies past the 26 Nov 2028 horizon.
      assert.equal(dates.length, 23);
      await w.h.close();
    });

    it('C3: previous-day, same-day and relative reminders on every occurrence; THIS / FUTURE / ALL edits keep exceptions intact', async () => {
      const w = await world(makeStore);
      const c = await w.as(w.staff);
      const ws = await w.personal(c);
      const first = await create(
        c,
        appointmentPayload(ws, {
          title: 'ประชุมประจำสัปดาห์',
          date: '2026-12-07',
          recurrence: { frequency: 'WEEKLY', end: { type: 'COUNT', count: 6 } },
          reminders: [
            { kind: 'CALENDAR', dayOffset: -1, localTime: '06:00', enabled: true },
            { kind: 'CALENDAR', dayOffset: 0, localTime: '06:00', enabled: true },
            { kind: 'RELATIVE', offsetMinutes: 60, enabled: true },
          ],
        }),
      );
      assert.deepEqual(fireTimes(first), [
        `SCHEDULED:${BKK('2026-12-06', '06:00')}`,
        `SCHEDULED:${BKK('2026-12-07', '06:00')}`,
        `SCHEDULED:${BKK('2026-12-07', '09:00')}`,
      ]);
      const list = () => occurrences(c, '2026-12-01', '2027-01-31', 'ประชุมประจำสัปดาห์');
      assert.deepEqual(await list(), [
        '2026-12-07',
        '2026-12-14',
        '2026-12-21',
        '2026-12-28',
        '2027-01-04',
        '2027-01-11',
      ]);
      const ids = async () =>
        Object.fromEntries(
          (await c.get('/api/v1/calendar?from=2026-12-01&to=2027-01-31'))
            .json()
            .items.map((i: { startDate: string; id: string }) => [i.startDate, i.id]),
        ) as Record<string, string>;
      const byDate = await ids();
      // THIS: move only 14 Dec to 15:00 → an exception.
      const d14 = (await c.get(`/api/v1/appointments/${byDate['2026-12-14']}`)).json();
      const moved = await c.put(`/api/v1/appointments/${d14.id}`, {
        version: d14.version,
        scope: 'THIS',
        appointment: appointmentPayload(ws, {
          title: 'ประชุมประจำสัปดาห์',
          date: '2026-12-14',
          startTime: '15:00',
          endTime: '16:00',
          reminders: [{ kind: 'RELATIVE', offsetMinutes: 60, enabled: true }],
        }),
      });
      assert.equal(moved.statusCode, 200);
      assert.equal(moved.json().appointment.series.isException, true);
      // ALL: everything from today on moves to 13:00 — except the 14 Dec exception.
      const d21 = (await c.get(`/api/v1/appointments/${byDate['2026-12-21']}`)).json();
      const all = await c.put(`/api/v1/appointments/${d21.id}`, {
        version: d21.version,
        scope: 'ALL',
        appointment: appointmentPayload(ws, {
          title: 'ประชุมประจำสัปดาห์',
          date: '2026-12-21',
          startTime: '13:00',
          endTime: '14:00',
          reminders: [
            { kind: 'CALENDAR', dayOffset: -1, localTime: '06:00', enabled: true },
            { kind: 'CALENDAR', dayOffset: 0, localTime: '06:00', enabled: true },
            { kind: 'RELATIVE', offsetMinutes: 60, enabled: true },
          ],
        }),
      });
      assert.equal(all.statusCode, 200, all.body);
      const after = await ids();
      assert.equal(after['2026-12-21'], byDate['2026-12-21'], 'stable occurrence identity');
      const d28 = (await c.get(`/api/v1/appointments/${after['2026-12-28']}`)).json();
      // Calendar reminders keep their local clock times; the relative one follows the move.
      assert.deepEqual(fireTimes(d28), [
        `SCHEDULED:${BKK('2026-12-27', '06:00')}`,
        `SCHEDULED:${BKK('2026-12-28', '06:00')}`,
        `SCHEDULED:${BKK('2026-12-28', '12:00')}`,
      ]);
      const ex = (await c.get(`/api/v1/appointments/${after['2026-12-14']}`)).json();
      assert.equal(ex.startAt, BKK('2026-12-14', '15:00'), 'exception untouched by ALL');
      // FUTURE from 4 Jan: rename; earlier occurrences keep the old title.
      const j4 = (await c.get(`/api/v1/appointments/${after['2027-01-04']}`)).json();
      const fut = await c.put(`/api/v1/appointments/${j4.id}`, {
        version: j4.version,
        scope: 'FUTURE',
        appointment: appointmentPayload(ws, {
          title: 'ประชุมปีใหม่',
          date: '2027-01-04',
          startTime: '13:00',
          endTime: '14:00',
        }),
      });
      assert.equal(fut.statusCode, 200, fut.body);
      assert.deepEqual(await occurrences(c, '2027-01-01', '2027-01-31', 'ประชุมปีใหม่'), [
        '2027-01-04',
        '2027-01-11',
      ]);
      assert.deepEqual(await list(), ['2026-12-07', '2026-12-14', '2026-12-21', '2026-12-28']);
      assert.notEqual(fut.json().appointment.series.id, first.series.id, 'series split');
      await w.h.close();
    });

    it('C4: cancelling one occurrence, this-and-future and the entire series affects only that scope', async () => {
      const w = await world(makeStore);
      const c = await w.as(w.staff);
      const ws = await w.personal(c);
      await create(
        c,
        appointmentPayload(ws, {
          title: 'ออกกำลังกาย',
          allDay: true,
          startTime: null,
          endTime: null,
          date: '2026-12-01',
          recurrence: { frequency: 'DAILY', end: { type: 'UNTIL', until: '2026-12-10' } },
          reminders: [],
        }),
      );
      const ids = async () =>
        Object.fromEntries(
          (await c.get('/api/v1/calendar?from=2026-12-01&to=2026-12-31&cancelled=1'))
            .json()
            .items.filter((i: { title: string }) => i.title === 'ออกกำลังกาย')
            .map((i: { startDate: string; id: string; status: string }) => [i.startDate, i]),
        ) as Record<string, { id: string; status: string }>;
      const d = await ids();
      assert.equal(Object.keys(d).length, 10);
      const get = async (id: string) => (await c.get(`/api/v1/appointments/${id}`)).json();
      const d3 = await get((d['2026-12-03'] as { id: string }).id);
      assert.equal(
        (
          await c.post(`/api/v1/appointments/${d3.id}/cancel`, {
            version: d3.version,
            scope: 'THIS',
          })
        ).statusCode,
        200,
      );
      const d7 = await get((d['2026-12-07'] as { id: string }).id);
      assert.equal(
        (
          await c.post(`/api/v1/appointments/${d7.id}/cancel`, {
            version: d7.version,
            scope: 'FUTURE',
          })
        ).statusCode,
        200,
      );
      const after = await ids();
      const scheduled = Object.entries(after)
        .filter(([, v]) => v.status === 'SCHEDULED')
        .map(([k]) => k);
      assert.deepEqual(scheduled, [
        '2026-12-01',
        '2026-12-02',
        '2026-12-04',
        '2026-12-05',
        '2026-12-06',
      ]);
      assert.equal(after['2026-12-03']?.status, 'CANCELLED');
      assert.equal(
        after['2026-12-07']?.status,
        'CANCELLED',
        'the acted-on occurrence stays as a record',
      );
      // The cancelled occurrence is never resurrected by the rolling extension.
      await w.h.app.flowExtendSeries?.();
      assert.equal((await ids())['2026-12-03']?.status, 'CANCELLED');
      const d1 = await get((after['2026-12-01'] as { id: string }).id);
      await c.post(`/api/v1/appointments/${d1.id}/cancel`, { version: d1.version, scope: 'ALL' });
      const left = Object.values(await ids()).filter((v) => v.status === 'SCHEDULED');
      assert.equal(left.length, 0);
      assert.equal((await get(d1.id)).recurrence.status, 'CANCELLED');
      await w.h.close();
    });

    it('C5: monthly bills — per-occurrence paid state suppresses only that occurrence; amounts are exact and overridable; corrections are audited', async () => {
      const w = await world(makeStore);
      const c = await w.as(w.staff);
      const ws = await w.personal(c);
      const bill = await create(
        c,
        appointmentPayload(ws, {
          title: 'ค่าไฟฟ้า',
          kind: 'BILL',
          bill: { amount: '1,250.5' },
          allDay: true,
          startTime: null,
          endTime: null,
          date: '2026-12-25',
          recurrence: { frequency: 'MONTHLY', monthDay: 25 },
          reminders: [
            { kind: 'CALENDAR', dayOffset: -1, localTime: '09:00', enabled: true },
            { kind: 'CALENDAR', dayOffset: 0, localTime: '08:00', enabled: true },
          ],
        }),
      );
      assert.deepEqual(bill.bill, {
        amount: '1250.50',
        currency: 'THB',
        paymentStatus: 'UNPAID',
        paidAt: null,
      });
      const cal = (await c.get('/api/v1/calendar?from=2027-01-01&to=2027-01-31')).json();
      const jan = cal.items.find((i: { title: string }) => i.title === 'ค่าไฟฟ้า');
      assert.equal(jan.bill.paymentStatus, 'UNPAID');
      // Mark December paid.
      const paid = await c.post(`/api/v1/appointments/${bill.id}/payment`, {
        version: bill.version,
        status: 'PAID',
      });
      assert.equal(paid.statusCode, 200);
      const dec = paid.json().appointment;
      assert.equal(dec.bill.paymentStatus, 'PAID');
      assert.equal(dec.paidBy, 'พนักงาน');
      assert.ok(dec.reminders.every((r: { status: string }) => r.status === 'SUPPRESSED'));
      const janDetail = (await c.get(`/api/v1/appointments/${jan.id}`)).json();
      assert.equal(janDetail.bill.paymentStatus, 'UNPAID', 'January is not affected');
      assert.ok(janDetail.reminders.every((r: { status: string }) => r.status === 'SCHEDULED'));
      // A variable bill: override January's amount only.
      const over = await c.put(`/api/v1/appointments/${jan.id}`, {
        version: janDetail.version,
        scope: 'THIS',
        appointment: appointmentPayload(ws, {
          title: 'ค่าไฟฟ้า',
          kind: 'BILL',
          bill: { amount: '980' },
          allDay: true,
          startTime: null,
          endTime: null,
          date: '2027-01-25',
          reminders: janDetail.reminders.map(
            (r: { kind: string; dayOffset: number; localTime: string }) => ({
              kind: r.kind,
              dayOffset: r.dayOffset,
              localTime: r.localTime,
              enabled: true,
            }),
          ),
        }),
      });
      assert.equal(over.statusCode, 200, over.body);
      assert.equal(over.json().appointment.bill.amount, '980.00');
      const feb = (await c.get('/api/v1/calendar?from=2027-02-01&to=2027-02-28'))
        .json()
        .items.find((i: { title: string }) => i.title === 'ค่าไฟฟ้า');
      assert.equal(feb.bill.amount, '1250.50', 'default amount continues');
      // Correction: December back to unpaid. Its time has passed by then → PAST, never replayed.
      w.h.clock.t = Date.parse('2026-12-26T03:00:00Z');
      const relog = await w.as(w.staff);
      const decNow = (await relog.get(`/api/v1/appointments/${bill.id}`)).json();
      const undo = await relog.post(`/api/v1/appointments/${bill.id}/payment`, {
        version: decNow.version,
        status: 'UNPAID',
      });
      assert.equal(undo.statusCode, 200);
      assert.ok(
        undo.json().appointment.reminders.every((r: { status: string }) => r.status === 'PAST'),
      );
      // Authorization: a viewer cannot mark paid; others get 404.
      const out = await w.as(w.outsider);
      assert.equal(
        (await out.post(`/api/v1/appointments/${bill.id}/payment`, { version: 1, status: 'PAID' }))
          .statusCode,
        404,
      );
      const history = (await relog.get(`/api/v1/appointments/${bill.id}/history`)).json().items;
      assert.equal(history.filter((e: { type: string }) => e.type === 'PAYMENT_CHANGED').length, 2);
      // Audit keeps actions, never the amount.
      const owner = await w.as(w.owner);
      const audit = JSON.stringify((await owner.get('/api/v1/admin/audit?limit=100')).json());
      assert.ok(audit.includes('bill.marked_paid') && audit.includes('bill.marked_unpaid'));
      assert.ok(!audit.includes('1250') && !audit.includes('ค่าไฟฟ้า'));
      await w.h.close();
    });

    it('C6: viewers cannot change bills; members cannot read others’ private bills; non-bills reject payment', async () => {
      const w = await world(makeStore);
      const staff = await w.as(w.staff);
      const shared = await create(
        staff,
        appointmentPayload(w.company.id, {
          title: 'ค่าเช่าสำนักงาน',
          kind: 'BILL',
          bill: { amount: '25000' },
          visibility: 'WORKSPACE',
          allDay: true,
          startTime: null,
          endTime: null,
          date: '2026-12-28',
          reminders: [],
        }),
      );
      const viewer = await w.as(w.viewer);
      assert.equal((await viewer.get(`/api/v1/appointments/${shared.id}`)).statusCode, 200);
      assert.equal(
        (
          await viewer.post(`/api/v1/appointments/${shared.id}/payment`, {
            version: 1,
            status: 'PAID',
          })
        ).statusCode,
        403,
      );
      const priv = await create(
        staff,
        appointmentPayload(w.company.id, {
          title: 'ค่าผ่อนรถส่วนตัว',
          kind: 'BILL',
          bill: { amount: '12000' },
          allDay: true,
          startTime: null,
          endTime: null,
          date: '2026-12-28',
          reminders: [],
        }),
      );
      const lead = await w.as(w.lead);
      assert.equal((await lead.get(`/api/v1/appointments/${priv.id}`)).statusCode, 404);
      const leadCal = JSON.stringify(
        (await lead.get('/api/v1/calendar?from=2026-12-01&to=2026-12-31')).json(),
      );
      assert.ok(!leadCal.includes('12000') && !leadCal.includes('ค่าผ่อนรถ'));
      const event = await create(
        staff,
        appointmentPayload(w.company.id, { visibility: 'WORKSPACE' }),
      );
      assert.equal(
        (
          await staff.post(`/api/v1/appointments/${event.id}/payment`, {
            version: 1,
            status: 'PAID',
          })
        ).json().error.code,
        'NOT_A_BILL',
      );
      await w.h.close();
    });

    it('C7: Activity Center shows operational data, titles only with content access, never creators, amounts or private recipients', async () => {
      const w = await world(makeStore);
      const owner = await w.as(w.owner);
      const staff = await w.as(w.staff);
      await create(
        staff,
        appointmentPayload(await w.personal(staff), {
          title: 'นัดหมอส่วนตัวลับ',
          category: 'health',
          location: 'คลินิกลับ',
          kind: 'BILL',
          bill: { amount: '777' },
          date: '2026-12-10',
          startTime: '10:17',
          endTime: null,
          recurrence: { frequency: 'MONTHLY' },
        }),
      );
      await create(
        staff,
        appointmentPayload(w.company.id, { title: 'ประชุมใหญ่', visibility: 'WORKSPACE' }),
      );
      await create(owner, appointmentPayload(await w.personal(owner), { title: 'นัดของเจ้าของ' }));
      const r = await owner.get('/api/v1/admin/activity?from=2026-12-01&to=2026-12-31&limit=100');
      assert.equal(r.statusCode, 200);
      const body = r.json();
      const raw = r.body;
      for (const secret of [
        'นัดหมอส่วนตัวลับ',
        'คลินิกลับ',
        '777',
        'พนักงาน',
        w.staff.id,
        w.staff.line,
        'health',
      ])
        assert.ok(!raw.includes(secret), `leaked ${secret}`);
      const redacted = body.items.filter((i: { redacted: boolean }) => i.redacted);
      assert.ok(redacted.length >= 2);
      for (const i of redacted) {
        assert.equal(i.title, null);
        assert.equal(i.recurring, null);
        assert.equal(i.itemKind, null);
        assert.equal(i.precision, 'hour');
        assert.match(i.fireAt, /:00:00\.000Z$/);
        assert.equal(i.delivery, 'not-enabled');
      }
      // The owner is not a company member → the shared title is redacted too; own title visible.
      assert.ok(!raw.includes('ประชุมใหญ่'));
      assert.ok(body.items.some((i: { title: string | null }) => i.title === 'นัดของเจ้าของ'));
      assert.ok((body.totals.SCHEDULED ?? 0) >= 4);
      // An ordinary user and a global admin both get 404 (owner-only area, no existence oracle).
      assert.equal(
        (await staff.get('/api/v1/admin/activity?from=2026-12-01&to=2026-12-31')).statusCode,
        404,
      );
      const gAdmin = await w.as(w.gAdmin);
      assert.equal(
        (await gAdmin.get('/api/v1/admin/activity?from=2026-12-01&to=2026-12-31')).statusCode,
        404,
      );
      assert.equal(
        (await owner.get('/api/v1/admin/activity?from=2026-01-01&to=2026-12-31')).json().error.code,
        'RANGE_TOO_LARGE',
      );
      await w.h.close();
    });

    it('C8: admin routes are server-authorized; dashboard cards are actionable and never fake unavailable metrics', async () => {
      const w = await world(makeStore);
      const owner = await w.as(w.owner);
      const gAdmin = await w.as(w.gAdmin);
      const lead = await w.as(w.lead);
      await seedGroup(w.s, 31, null, 'PENDING');
      const ov = (await owner.get('/api/v1/admin/overview')).json();
      assert.equal(ov.ownerOnly, false);
      for (const [k, m] of Object.entries(ov.metrics) as [
        string,
        { status: string; value: number | null; to: string },
      ][]) {
        assert.match(m.to, /^\/admin(\/|$)/, `${k} links into /admin`);
        if (m.status !== 'measured') assert.equal(m.value, null, `${k}: unknown is not zero`);
      }
      assert.equal(ov.metrics.usersTotal.value, 6);
      assert.equal(ov.metrics.groupsPending.value, 1);
      assert.equal(
        ov.metrics.quota.status,
        'unavailable',
        'no LINE token in tests → unavailable, not 0',
      );
      assert.equal(ov.metrics.notificationFailures.status, 'not-enabled');
      assert.equal(ov.metrics.friends.status, 'not-enabled');
      const adminOv = (await gAdmin.get('/api/v1/admin/overview')).json();
      assert.equal(adminOv.ownerOnly, true);
      assert.equal(adminOv.metrics.quota, undefined, 'owner-only cards are not served to admins');
      for (const path of ['quota', 'friends', 'health', 'notifications'])
        assert.equal((await gAdmin.get(`/api/v1/admin/${path}`)).statusCode, 404, path);
      for (const path of ['overview', 'users', 'workspaces', 'access-requests', 'audit', 'quota'])
        assert.equal(
          (await lead.get(`/api/v1/admin/${path}`)).statusCode,
          404,
          `workspace admin: ${path}`,
        );
      const quota = (await owner.get('/api/v1/admin/quota')).json();
      assert.equal(quota.status, 'not-configured');
      assert.equal(quota.limit, null);
      assert.equal(quota.reservations.status, 'not-enabled');
      const health = (await owner.get('/api/v1/admin/health')).json();
      assert.equal(health.database.status, 'ok');
      assert.equal(health.line.outbound, 'disabled');
      assert.equal(health.worker, 'not-enabled');
      const notif = (await owner.get('/api/v1/admin/notifications')).json();
      assert.equal(notif.controls.emergencyStop, 'not-enabled', 'no fake emergency stop');
      const friends = await owner.get('/api/v1/admin/friends');
      assert.equal(friends.json().registry.status, 'not-enabled');
      assert.ok(
        friends
          .json()
          .items.every(
            (f: { friendship: string; maskedLineId: string }) =>
              f.friendship === 'unknown' && /^U[0-9a-f]{4}…[0-9a-f]{4}$/.test(f.maskedLineId),
          ),
      );
      assert.ok(!friends.body.includes(w.staff.line), 'raw LINE ids never leave the server');
      // Personal workspaces cannot be opened from administration.
      const personal = await w.personal(lead);
      assert.equal((await owner.get(`/api/v1/admin/workspaces/${personal}`)).statusCode, 404);
      assert.equal(
        (await owner.get(`/api/v1/admin/users?workspaceId=${personal}`)).json().items.length,
        0,
      );
      const ws = (await owner.get(`/api/v1/admin/workspaces/${w.company.id}`)).json();
      assert.equal(ws.members.length, 3);
      assert.ok(!JSON.stringify(ws).includes('appointment'));
      const listed = (await owner.get('/api/v1/admin/workspaces')).json();
      assert.ok(listed.personalCount >= 6);
      assert.ok(listed.items.every((x: { kind: string }) => x.kind !== 'PERSONAL'));
      await w.h.close();
    });

    it('C9: access requests show a masked, server-verified LINE id; user filters work by status, role and workspace', async () => {
      const w = await world(makeStore);
      const newcomer = w.h.client();
      await newcomer.login(`tok:U${'ab'.repeat(16)}:ผู้ขอใช้งาน`);
      await newcomer.post('/api/v1/access-requests', { message: 'ขอเข้าบริษัทค่ะ' });
      const owner = await w.as(w.owner);
      const r = await owner.get('/api/v1/admin/access-requests');
      const item = r.json().items[0];
      assert.equal(item.maskedLineId, 'Uabab…abab');
      assert.ok(!r.body.includes('ab'.repeat(16)));
      const users = async (q: string) =>
        (await owner.get(`/api/v1/admin/users?${q}`))
          .json()
          .items.map((u: { id: string }) => u.id)
          .sort();
      assert.deepEqual(
        await users(`workspaceId=${w.company.id}`),
        [w.lead.id, w.staff.id, w.viewer.id].sort(),
      );
      assert.deepEqual(await users('role=ADMIN'), [w.gAdmin.id]);
      await owner.post(`/api/v1/admin/users/${w.viewer.id}/status`, { action: 'suspend' });
      assert.deepEqual(await users('status=RESTRICTED'), [w.viewer.id]);
      const detail = (await owner.get(`/api/v1/admin/users/${w.viewer.id}`)).json();
      assert.match(detail.maskedLineId, /^U[0-9a-f]{4}…[0-9a-f]{4}$/);
      assert.equal(detail.openSessions, 0, 'suspension ended every session');
      await w.h.close();
    });

    it('C10: offboarding — remove from company only, suspend, or revoke; sessions end; shared work stays; reactivation needs explicit review', async () => {
      const w = await world(makeStore);
      const owner = await w.as(w.owner);
      const staff = await w.as(w.staff);
      const group = await seedGroup(w.s, 41, w.company.id, 'ACTIVE');
      await w.s.createDestinationGrant({
        id: '7a1c5a0e-1111-4111-8111-111111111111',
        destinationId: group.id,
        userId: w.staff.id,
        grantedByUserId: w.owner.id,
        createdAt: new Date(),
      });
      const shared = await create(
        staff,
        appointmentPayload(w.company.id, { title: 'ประชุมบริษัท', visibility: 'WORKSPACE' }),
      );
      // A: remove from the company workspace only (account stays active).
      assert.equal(
        (
          await owner.put(`/api/v1/admin/users/${w.staff.id}/memberships`, {
            workspaceId: w.company.id,
            role: null,
          })
        ).statusCode,
        200,
      );
      assert.equal((await staff.get(`/api/v1/appointments/${shared.id}`)).statusCode, 404);
      assert.equal((await staff.get('/api/v1/today')).statusCode, 200, 'still active elsewhere');
      const lead = await w.as(w.lead);
      assert.equal(
        (await lead.get(`/api/v1/appointments/${shared.id}`)).statusCode,
        200,
        'shared work stays',
      );
      // B: suspend → sessions end, private chat disabled; reinstate restores memberships.
      await owner.post(`/api/v1/admin/users/${w.staff.id}/status`, { action: 'suspend' });
      assert.equal((await staff.get('/api/v1/me')).statusCode, 401);
      assert.equal((await w.s.getPrivateDestination(w.staff.id))?.status, 'DISABLED');
      await owner.post(`/api/v1/admin/users/${w.staff.id}/status`, { action: 'reinstate' });
      assert.equal((await w.s.getPrivateDestination(w.staff.id))?.status, 'ACTIVE');
      assert.equal((await w.s.getMember(w.family.id, w.staff.id))?.status, 'ACTIVE');
      // C: revoke → memberships and group grants removed, admin role dropped, shared work kept.
      await owner.post(`/api/v1/admin/users/${w.gAdmin.id}/status`, { action: 'revoke' });
      assert.equal((await w.s.getUser(w.gAdmin.id))?.globalRole, 'USER');
      await owner.post(`/api/v1/admin/users/${w.staff.id}/status`, { action: 'revoke' });
      assert.equal((await w.s.getMember(w.family.id, w.staff.id))?.status, 'REMOVED');
      assert.equal((await w.s.listDestinationGrants({ userId: w.staff.id })).length, 0);
      assert.equal((await w.s.getPrivateDestination(w.staff.id))?.status, 'DISABLED');
      const back = await w.as(w.staff);
      assert.equal((await back.get('/api/v1/today')).statusCode, 403, 'stale credentials refused');
      assert.equal((await lead.get(`/api/v1/appointments/${shared.id}`)).statusCode, 200);
      // Reactivation with an explicit review: only the reviewed membership returns.
      assert.equal(
        (
          await owner.post(`/api/v1/admin/users/${w.staff.id}/status`, {
            action: 'reactivate',
            assignments: [{ workspaceId: w.company.id, role: 'VIEWER' }],
          })
        ).statusCode,
        200,
      );
      const me = (await (await w.as(w.staff)).get('/api/v1/me')).json();
      assert.deepEqual(
        me.workspaces.map((x: { kind: string; role: string }) => `${x.kind}:${x.role}`).sort(),
        ['COMPANY:VIEWER', 'PERSONAL:ADMIN'],
      );
      assert.equal(
        (
          await owner.post(`/api/v1/admin/users/${w.lead.id}/status`, {
            action: 'suspend',
            assignments: [{ workspaceId: w.company.id, role: 'ADMIN' }],
          })
        ).statusCode,
        400,
        'assignments only on reactivation',
      );
      // Owner protection.
      assert.equal(
        (await owner.post(`/api/v1/admin/users/${w.owner.id}/status`, { action: 'suspend' }))
          .statusCode,
        403,
      );
      await w.h.close();
    });

    it('C11: sensitive privileged writes need a recent LINE login; a fresh login (no password) unlocks them', async () => {
      const w = await world(makeStore);
      const owner = await w.as(w.owner);
      w.h.clock.t += 20 * 60_000;
      const stale = await owner.post(`/api/v1/admin/users/${w.staff.id}/status`, {
        action: 'suspend',
      });
      assert.equal(stale.statusCode, 403);
      assert.equal(stale.json().error.code, 'REAUTH_REQUIRED');
      assert.equal(
        (await owner.post(`/api/v1/admin/users/${w.staff.id}/role`, { globalRole: 'ADMIN' })).json()
          .error.code,
        'REAUTH_REQUIRED',
      );
      assert.equal(
        (
          await owner.put(`/api/v1/admin/users/${w.staff.id}/memberships`, {
            workspaceId: w.company.id,
            role: null,
          })
        ).json().error.code,
        'REAUTH_REQUIRED',
      );
      // Read access is unaffected.
      assert.equal((await owner.get('/api/v1/admin/users')).statusCode, 200);
      await owner.login(w.owner.token);
      assert.equal(
        (await owner.post(`/api/v1/admin/users/${w.staff.id}/status`, { action: 'suspend' }))
          .statusCode,
        200,
      );
      await w.h.close();
    });

    it('C12: the rolling horizon extends daily series without duplicates and pauses when the creator loses access', async () => {
      const w = await world(makeStore);
      const c = await w.as(w.staff);
      await create(
        c,
        appointmentPayload(w.family.id, {
          title: 'ให้อาหารแมว',
          date: '2026-11-26',
          startTime: '18:00',
          endTime: null,
          visibility: 'WORKSPACE',
          recurrence: { frequency: 'DAILY' },
          reminders: [],
        }),
      );
      const count = async () =>
        (await c.get('/api/v1/appointments?q=ให้อาหาร&limit=100&status=all')).json().items.length;
      assert.equal(await count(), 91, 'today + 90-day horizon');
      w.h.clock.t += 30 * 86_400_000;
      const r = await w.h.app.flowExtendSeries?.();
      assert.equal(r?.extended, 1);
      assert.equal(r?.created, 30);
      assert.equal((await w.h.app.flowExtendSeries?.())?.created, 0, 'idempotent');
      // Creator removed from the workspace → the series pauses instead of extending.
      await w.s.updateMember(w.family.id, w.staff.id, { status: 'REMOVED' }, new Date(w.h.clock.t));
      w.h.clock.t += 30 * 86_400_000;
      const paused = await w.h.app.flowExtendSeries?.();
      assert.equal(paused?.created, 0);
      assert.equal(paused?.paused, 1);
      await w.h.close();
    });
  });
}

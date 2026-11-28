import assert from 'node:assert/strict';
import { it } from 'node:test';
import { appointmentPayload, createHarness, idem, seedUser } from '../tests/support/harness.js';
import { openTestStore, testStore } from './support/db.js';

it('MariaDB: concurrent horizon extensions on two pools never duplicate an occurrence; amounts stay exact', async (t) => {
  const store = await testStore();
  const one = await createHarness({ store });
  t.after(() => one.close());
  const otherStore = await openTestStore();
  t.after(() => otherStore.close());
  const two = await createHarness({ store: otherStore });
  t.after(() => two.close());
  const user = await seedUser(store, 501, { name: 'ผู้ใช้ซีรีส์' });
  const c = one.client();
  assert.equal((await c.login(user.token)).statusCode, 200);
  const ws = (await c.get('/api/v1/me')).json().workspaces[0].id as string;
  for (const [i, amount] of ['0.10', '999999999999.99', '1250.05'].entries()) {
    const r = await c.post(
      '/api/v1/appointments',
      appointmentPayload(ws, {
        title: `ซีรีส์ ${i}`,
        kind: 'BILL',
        bill: { amount },
        date: '2026-11-26',
        startTime: '20:00',
        endTime: null,
        recurrence: { frequency: 'DAILY' },
        reminders: [],
      }),
      idem(),
    );
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json().appointment.bill.amount, amount, 'DECIMAL round-trips exactly');
  }
  for (let round = 0; round < 5; round += 1) {
    one.clock.t += 9 * 86_400_000;
    two.clock.t = one.clock.t;
    const [a, b] = await Promise.all([one.app.flowExtendSeries?.(), two.app.flowExtendSeries?.()]);
    assert.ok((a?.created ?? 0) + (b?.created ?? 0) <= 27, 'never more than the missing days');
  }
  // 91 initial + 45 extended days per series; no date appears twice in any series.
  assert.equal((await c.login(user.token)).statusCode, 200, 'the old session expired meanwhile');
  for (let i = 0; i < 3; i += 1) {
    const all = [];
    for (let offset = 0; offset < 400; offset += 100) {
      const res = await c.get(
        `/api/v1/appointments?q=${encodeURIComponent(`ซีรีส์ ${i}`)}&status=all&limit=100&offset=${offset}`,
      );
      assert.equal(res.statusCode, 200, res.body);
      const page = res.json();
      all.push(...page.items);
      if (!page.hasMore) break;
    }
    const dates = all.map((x: { startDate: string }) => x.startDate);
    assert.equal(new Set(dates).size, dates.length, `series ${i} duplicates`);
    assert.equal(dates.length, 136);
  }
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { HealthDto, QuotaDto } from '@flow/shared';
import { RefreshController } from '../src/app/admin/refresh.js';
import { HEALTH_REFRESH, preciseText, QUOTA_REFRESH } from '../src/app/admin/refresh-options.js';

const quota = (over: Partial<QuotaDto> = {}): QuotaDto => ({
  status: 'available',
  type: 'limited',
  limit: 300,
  used: 7,
  remaining: 293,
  percent: 2.3,
  month: '2026-11',
  lastSuccessAt: '2026-11-28T06:00:00.000Z',
  checkedAt: '2026-11-28T06:00:00.000Z',
  errorKind: null,
  reservations: { status: 'not-enabled' },
  flowLog: { status: 'not-enabled' },
  ...over,
});
const health = (db: 'ok' | 'unavailable', at: string): HealthDto => ({
  checkedAt: at,
  api: { status: 'ok', version: 't', uptimeSeconds: 1 },
  database: { status: db, latencyMs: db === 'ok' ? 3 : null },
  line: {
    login: 'configured',
    messagingRead: 'configured',
    webhook: 'configured',
    outbound: 'disabled',
  },
  worker: 'not-enabled',
  notificationEngine: 'not-enabled',
});

/** A fetcher whose responses are released manually, counting real requests. */
function scripted<T>() {
  const pending: { resolve: (v: T) => void; reject: (e: unknown) => void }[] = [];
  let calls = 0;
  const fetcher = () =>
    new Promise<T>((resolve, reject) => {
      calls += 1;
      pending.push({ resolve, reject });
    });
  return { fetcher, pending, calls: () => calls };
}

describe('ADM08 quota refresh', () => {
  it('a refresh is a real request; clicks while it runs join it (no duplicate LINE read)', async () => {
    const s = scripted<QuotaDto>();
    const c = new RefreshController(s.fetcher, QUOTA_REFRESH);
    const first = c.load();
    s.pending[0]!.resolve(quota());
    await first;
    assert.equal(c.getState().feedback, null, 'the first read does not announce success');
    const a = c.refresh();
    assert.equal(c.getState().phase, 'refreshing', 'loading indicator state while the data stays');
    assert.equal(c.getState().data?.used, 7);
    const b = c.refresh();
    const d = c.refresh();
    assert.equal(s.calls(), 2, 'three clicks while busy → one request');
    assert.ok(c.isBusy());
    s.pending[1]!.resolve(
      quota({ checkedAt: '2026-11-28T06:05:07.000Z', lastSuccessAt: '2026-11-28T06:05:07.000Z' }),
    );
    await Promise.all([a, b, d]);
    const st = c.getState();
    assert.equal(st.phase, 'idle');
    assert.deepEqual(
      st.feedback,
      { tone: 'success', text: 'อัปเดตข้อมูลโควตาเรียบร้อยแล้ว' },
      'unchanged values still confirm',
    );
    assert.equal(st.checkedAt, '2026-11-28T06:05:07.000Z');
    assert.equal(st.data?.lastSuccessAt, '2026-11-28T06:05:07.000Z');
    assert.equal(st.stale, false);
  });

  it('a failed LINE read keeps the previous valid values, marks them stale and keeps the last success time', async () => {
    const s = scripted<QuotaDto>();
    const c = new RefreshController(s.fetcher, QUOTA_REFRESH);
    const l = c.load();
    s.pending[0]!.resolve(quota());
    await l;
    // Server restarted meanwhile and LINE fails: no values in the response.
    const r = c.refresh();
    s.pending[1]!.resolve(
      quota({
        status: 'unavailable',
        used: null,
        limit: null,
        remaining: null,
        percent: null,
        type: null,
        lastSuccessAt: null,
        errorKind: 'upstream',
        checkedAt: '2026-11-28T06:09:00.000Z',
      }),
    );
    await r;
    const st = c.getState();
    assert.equal(st.feedback?.tone, 'error');
    assert.equal(st.feedback?.text, 'ไม่สามารถอ่านข้อมูลล่าสุดได้ กรุณาลองใหม่อีกครั้ง');
    assert.equal(st.data?.used, 7, 'previous valid data preserved');
    assert.equal(st.data?.status, 'stale');
    assert.equal(st.data?.lastSuccessAt, '2026-11-28T06:00:00.000Z', 'not advanced on failure');
    assert.equal(st.stale, true);
  });

  it('a server-side stale fallback is reported as a failure, never as success', async () => {
    const s = scripted<QuotaDto>();
    const c = new RefreshController(s.fetcher, QUOTA_REFRESH);
    const r = c.refresh();
    s.pending[0]!.resolve(quota({ status: 'stale', errorKind: 'timeout' }));
    await r;
    assert.equal(c.getState().feedback?.tone, 'error');
  });

  it('a network failure keeps data, reports the error and releases the busy state', async () => {
    const s = scripted<QuotaDto>();
    const c = new RefreshController(s.fetcher, QUOTA_REFRESH);
    const l = c.load();
    s.pending[0]!.resolve(quota());
    await l;
    const r = c.refresh();
    s.pending[1]!.reject(new Error('offline'));
    await r;
    assert.equal(c.getState().data?.used, 7);
    assert.equal(c.getState().stale, true);
    assert.equal(c.getState().phase, 'idle');
    assert.equal(c.isBusy(), false);
    const again = c.refresh();
    assert.equal(s.calls(), 3, 'a new click after failure sends a new request');
    s.pending[2]!.resolve(quota());
    await again;
    assert.equal(c.getState().stale, false);
  });
});

describe('ADM09 health refresh', () => {
  it('runs a fresh check per click, confirms success and reports a degraded database honestly', async () => {
    const s = scripted<HealthDto>();
    const c = new RefreshController(s.fetcher, HEALTH_REFRESH);
    const l = c.load();
    assert.equal(c.getState().phase, 'loading');
    s.pending[0]!.resolve(health('ok', '2026-11-28T06:00:00.000Z'));
    await l;
    const a = c.refresh();
    void c.refresh();
    assert.equal(s.calls(), 2);
    s.pending[1]!.resolve(health('ok', '2026-11-28T06:00:41.000Z'));
    await a;
    assert.deepEqual(c.getState().feedback, {
      tone: 'success',
      text: 'ตรวจสอบสถานะระบบเรียบร้อยแล้ว',
    });
    assert.equal(c.getState().checkedAt, '2026-11-28T06:00:41.000Z');
    const b = c.refresh();
    s.pending[2]!.resolve(health('unavailable', '2026-11-28T06:01:00.000Z'));
    await b;
    assert.equal(c.getState().feedback?.tone, 'caution', 'a degraded service is never “เรียบร้อย”');
    const f = c.refresh();
    s.pending[3]!.reject(new Error('503'));
    await f;
    assert.deepEqual(c.getState().feedback, { tone: 'error', text: 'ไม่สามารถตรวจสอบสถานะระบบได้' });
    assert.equal(c.getState().stale, true);
    assert.equal(
      c.getState().checkedAt,
      '2026-11-28T06:01:00.000Z',
      'last-checked only from completed checks',
    );
  });

  it('shows timestamps to the second in Bangkok time', () => {
    assert.match(preciseText('2026-11-28T06:25:54.000Z'), / 28 พ\.ย\. 2569 · 13:25:54 น\.$/);
  });
});

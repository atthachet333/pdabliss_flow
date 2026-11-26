import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { appointmentInputSchema, reminderRuleSchema } from '../src/api-v1.js';
import { buildReminderPreview, toFlexMessage, validateFlexMessage } from '../src/flex-message.js';

const NOW = new Date('2026-11-26T02:00:00Z');
const START = new Date('2026-12-10T03:00:00Z'); // 10:00 Bangkok
const base = {
  title: 'ตรวจฟัน 🦷',
  category: 'health' as const,
  allDay: false,
  localDate: '2026-12-10',
  start: START,
  timeZone: 'Asia/Bangkok',
  location: 'คลินิกจำลอง',
  now: NOW,
};
const DETAIL = 'https://flow.example.test/appointments/0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b';

describe('Flex reminder preview (never sent in EP02)', () => {
  it('CALENDAR morning reminder uses morning wording; RELATIVE uses the lead time', () => {
    const morning = buildReminderPreview({ ...base, minimalDisclosure: false, reminder: { kind: 'CALENDAR', fireAt: new Date('2026-12-09T23:00:00Z') } });
    assert.match(morning.sallyLine, /^อรุณสวัสดิ์ค่ะ/);
    const before = buildReminderPreview({ ...base, minimalDisclosure: false, reminder: { kind: 'RELATIVE', offsetMinutes: 60, fireAt: new Date('2026-12-10T02:00:00Z') } });
    assert.notEqual(before.sallyLine, morning.sallyLine);
  });

  it('privacy-safe content hides title, location and notes; full content shows title but never notes', () => {
    const safe = toFlexMessage(buildReminderPreview({ ...base, minimalDisclosure: true, reminder: { kind: 'RELATIVE', offsetMinutes: 60, fireAt: START } }), DETAIL);
    const s = JSON.stringify(safe);
    assert.ok(!s.includes('ตรวจฟัน') && !s.includes('คลินิกจำลอง'));
    const full = JSON.stringify(toFlexMessage(buildReminderPreview({ ...base, minimalDisclosure: false, reminder: { kind: 'RELATIVE', offsetMinutes: 60, fireAt: START } }), DETAIL));
    assert.ok(full.includes('ตรวจฟัน'));
  });

  it('generated messages satisfy the template contract', () => {
    for (const minimalDisclosure of [true, false]) {
      const msg = toFlexMessage(buildReminderPreview({ ...base, minimalDisclosure, reminder: { kind: 'CALENDAR', fireAt: new Date('2026-12-09T23:00:00Z') } }), DETAIL);
      assert.deepEqual(validateFlexMessage(msg), []);
      assert.equal(msg.type, 'flex');
      assert.ok(msg.altText.length > 0 && msg.altText.length <= 400);
    }
  });

  it('the validator rejects malformed messages', () => {
    assert.ok(validateFlexMessage(null).length > 0);
    assert.ok(validateFlexMessage({ type: 'flex', altText: '', contents: { type: 'bubble' } }).includes('altText required'));
    const good = toFlexMessage(buildReminderPreview({ ...base, minimalDisclosure: true, reminder: { kind: 'RELATIVE', offsetMinutes: 0, fireAt: START } }), DETAIL);
    const bad = JSON.parse(JSON.stringify(good));
    bad.contents.footer = { type: 'box', layout: 'vertical', contents: [{ type: 'button', style: 'link', action: { type: 'uri', label: 'เปิด', uri: 'http://insecure.test' } }] };
    assert.ok(validateFlexMessage(bad).some((i) => i.includes('https')));
    bad.contents.footer = { type: 'video' };
    assert.ok(validateFlexMessage(bad).some((i) => i.includes('unsupported')));
  });
});

describe('API v1 appointment input schema', () => {
  const ok = {
    workspaceId: '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b',
    title: '  นัด 🎉  ',
    category: 'family',
    allDay: false,
    date: '2026-12-10',
    startTime: '10:00',
  };

  it('accepts a minimal timed appointment and applies safe defaults', () => {
    const v = appointmentInputSchema.parse(ok);
    assert.equal(v.title, 'นัด 🎉');
    assert.equal(v.visibility, 'PRIVATE');
    assert.equal(v.timeZone, 'Asia/Bangkok');
    assert.deepEqual(v.destinations, []);
    assert.equal(v.confirmSensitive, false);
  });

  it('rejects unknown fields (no mass assignment of ids, owners or status)', () => {
    for (const extra of [{ createdByUserId: 'x' }, { status: 'CANCELLED' }, { id: 'x' }, { version: 3 }])
      assert.equal(appointmentInputSchema.safeParse({ ...ok, ...extra }).success, false, JSON.stringify(extra));
  });

  it('requires a start time for timed events; validates dates, times and lengths', () => {
    assert.equal(appointmentInputSchema.safeParse({ ...ok, startTime: null }).success, false);
    assert.equal(appointmentInputSchema.safeParse({ ...ok, allDay: true, startTime: null }).success, true);
    assert.equal(appointmentInputSchema.safeParse({ ...ok, date: '2026-02-30' }).success, false);
    assert.equal(appointmentInputSchema.safeParse({ ...ok, startTime: '9:00' }).success, false);
    assert.equal(appointmentInputSchema.safeParse({ ...ok, title: '   ' }).success, false);
    assert.equal(appointmentInputSchema.safeParse({ ...ok, title: 'ก'.repeat(121) }).success, false);
    assert.equal(appointmentInputSchema.safeParse({ ...ok, title: '😀'.repeat(120) }).success, true, 'emoji count as one character');
  });

  it('shared users only with SELECTED visibility; no duplicates; destination policy defaults to privacy-safe', () => {
    const u = '1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b';
    assert.equal(appointmentInputSchema.safeParse({ ...ok, sharedWithUserIds: [u] }).success, false);
    assert.equal(appointmentInputSchema.safeParse({ ...ok, visibility: 'SELECTED', sharedWithUserIds: [u, u] }).success, false);
    const d = appointmentInputSchema.parse({ ...ok, destinations: [{ destinationId: u }] });
    assert.equal(d.destinations[0]!.contentPolicy, 'PRIVACY_SAFE');
    assert.equal(appointmentInputSchema.safeParse({ ...ok, destinations: [{ destinationId: u }, { destinationId: u }] }).success, false);
  });

  it('reminder rule schema accepts the two kinds and rejects out-of-range values', () => {
    assert.equal(reminderRuleSchema.safeParse({ kind: 'CALENDAR', dayOffset: 0, localTime: '06:00' }).success, true);
    assert.equal(reminderRuleSchema.safeParse({ kind: 'RELATIVE', offsetMinutes: 60 }).success, true);
    assert.equal(reminderRuleSchema.safeParse({ kind: 'CALENDAR', dayOffset: 1, localTime: '06:00' }).success, false);
    assert.equal(reminderRuleSchema.safeParse({ kind: 'RELATIVE', offsetMinutes: -1 }).success, false);
    assert.equal(reminderRuleSchema.safeParse({ kind: 'DAILY' }).success, false);
    assert.equal(appointmentInputSchema.safeParse({ ...ok, reminders: Array.from({ length: 6 }, () => ({ kind: 'RELATIVE', offsetMinutes: 5 })) }).success, false);
  });
});

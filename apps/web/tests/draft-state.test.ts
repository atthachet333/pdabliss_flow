import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MOCK_DESTINATIONS, MOCK_QUOTA, MOCK_TIMEZONE } from '../src/fixtures/mock.js';
import {
  deriveDraft,
  draftReducer,
  initialDraft,
  type DraftState,
} from '../src/prototype/draft-state.js';

const now = new Date('2026-11-26T02:00:00Z'); // 09:00 Bangkok
const ctx = { now, timeZone: MOCK_TIMEZONE, options: MOCK_DESTINATIONS, quota: MOCK_QUOTA };
const opts = MOCK_DESTINATIONS;

function apply(state: DraftState, ...actions: Parameters<typeof draftReducer>[1][]) {
  return actions.reduce(draftReducer, state);
}

describe('appointment prototype state', () => {
  it('starts private-only, tomorrow 09:00, one 30-minute reminder', () => {
    const s = initialDraft(now, MOCK_TIMEZONE, opts);
    assert.deepEqual(s.destinationIds, ['dest-self']);
    assert.equal(s.localDate, '2026-11-27');
    assert.equal(s.localTime, '09:00');
    assert.deepEqual(s.reminderOffsets, [30]);
    assert.equal(s.step, 'edit');
  });

  it('cannot review until a title exists', () => {
    const s = initialDraft(now, MOCK_TIMEZONE, opts);
    assert.equal(deriveDraft(s, ctx).canReview, false);
    const titled = apply(s, { type: 'set-title', value: 'ประชุมพนักงาน' });
    assert.equal(deriveDraft(titled, ctx).canReview, true);
  });

  it('live preview reflects title, category, time and destination immediately', () => {
    const s = apply(
      initialDraft(now, MOCK_TIMEZONE, opts),
      { type: 'set-title', value: 'ประชุมพนักงาน' },
      { type: 'set-category', value: 'business' },
      { type: 'set-time', value: '14:30' },
      { type: 'toggle-destination', id: 'dest-team', options: opts },
    );
    const d = deriveDraft(s, ctx);
    assert.equal(d.previews.length, 2);
    assert.equal(d.activePreview?.destination.id, 'dest-team');
    assert.equal(d.activePreview?.model.title, 'ประชุมพนักงาน');
    assert.equal(d.activePreview?.model.timeText, '14:30 น.');
    assert.equal(d.activePreview?.model.theme, 'business');
    assert.match(d.activePreview?.model.destinationText ?? '', /ทีมงานบริษัท/);
  });

  it('builds one separate preview per destination with no cross-group information', () => {
    const s = apply(
      initialDraft(now, MOCK_TIMEZONE, opts),
      { type: 'set-title', value: 'กิจกรรมร่วม' },
      { type: 'toggle-destination', id: 'dest-family', options: opts },
      { type: 'toggle-destination', id: 'dest-team', options: opts },
    );
    const d = deriveDraft(s, ctx);
    const family = d.previews.find((p) => p.destination.id === 'dest-family');
    assert.ok(family);
    assert.ok(!JSON.stringify(family.model).includes('ทีมงานบริษัท'));
  });

  it('refuses to select viewer-only or pending destinations', () => {
    const s = apply(
      initialDraft(now, MOCK_TIMEZONE, opts),
      { type: 'toggle-destination', id: 'dest-all-staff', options: opts },
      { type: 'toggle-destination', id: 'dest-pending', options: opts },
    );
    assert.deepEqual(s.destinationIds, ['dest-self']);
  });

  it('estimates quota from mock member counts × reminders', () => {
    const s = apply(
      initialDraft(now, MOCK_TIMEZONE, opts),
      { type: 'set-title', value: 'x' },
      { type: 'toggle-destination', id: 'dest-team', options: opts },
      { type: 'toggle-reminder', offset: 1440 },
    );
    const d = deriveDraft(s, ctx);
    // self(1) + team(18) = 19 per send; reminders 30 min + 1 day (1 day = exactly now → past)
    assert.equal(d.quota.perReminderKnown, 19);
    assert.equal(d.plan?.scheduled.length, 1);
    assert.equal(d.quota.totalKnown, 19);
  });

  it('applies minimal disclosure to group previews only', () => {
    const s = apply(
      initialDraft(now, MOCK_TIMEZONE, opts),
      { type: 'set-title', value: 'นัดหาหมอ' },
      { type: 'set-category', value: 'health' },
      { type: 'toggle-destination', id: 'dest-family', options: opts },
      { type: 'set-minimal-disclosure', value: true },
    );
    const d = deriveDraft(s, ctx);
    assert.equal(d.evaluation.suggestMinimalDisclosure, true);
    const group = d.previews.find((p) => p.destination.id === 'dest-family');
    const self = d.previews.find((p) => p.destination.id === 'dest-self');
    assert.equal(group?.model.title, 'นัดหมายสำคัญ');
    assert.equal(self?.model.title, 'นัดหาหมอ');
  });

  it('removing all destinations blocks review', () => {
    const s = apply(
      initialDraft(now, MOCK_TIMEZONE, opts),
      { type: 'set-title', value: 'x' },
      { type: 'toggle-destination', id: 'dest-self', options: opts },
    );
    const d = deriveDraft(s, ctx);
    assert.equal(d.canReview, false);
    assert.equal(d.evaluation.canConfirm, false);
  });

  it('simulated confirmation is only reachable from review', () => {
    const s = initialDraft(now, MOCK_TIMEZONE, opts);
    assert.equal(draftReducer(s, { type: 'simulate-confirm' }).step, 'edit');
    const reviewed = apply(s, { type: 'go-review' }, { type: 'simulate-confirm' });
    assert.equal(reviewed.step, 'simulated');
  });
});

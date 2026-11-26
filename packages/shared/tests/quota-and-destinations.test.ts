import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DestinationOption } from '../src/domain.js';
import {
  defaultDestinationIds,
  destinationAvailability,
  evaluateDestinations,
} from '../src/destinations.js';
import { costPerSend, estimateQuota, type QuotaSnapshot } from '../src/quota.js';

const self: DestinationOption = {
  id: 'self',
  kind: 'private-self',
  displayName: 'แชทส่วนตัวกับ Sally',
  workspaceLabel: 'ส่วนตัว',
  workspaceKind: 'personal',
  memberCount: 1,
  lifecycle: 'active',
  viewerRole: 'system-owner',
};
const family: DestinationOption = {
  ...self,
  id: 'family',
  kind: 'line-group',
  displayName: 'กลุ่มครอบครัว (ตัวอย่าง)',
  workspaceLabel: 'ครอบครัว',
  workspaceKind: 'family',
  memberCount: 4,
};
const company: DestinationOption = {
  ...family,
  id: 'company',
  displayName: 'กลุ่มทีมบริษัท (ตัวอย่าง)',
  workspaceLabel: 'บริษัท',
  workspaceKind: 'company',
  memberCount: 24,
};
const unknown: DestinationOption = { ...family, id: 'unknown', memberCount: null };

const snapshot: QuotaSnapshot = {
  monthlyLimit: 300,
  consumedThisMonth: 100,
  reservedThisMonth: 40,
  safetyReserve: 30,
};

describe('quota estimation', () => {
  it('counts group pushes per recipient and private pushes as one', () => {
    assert.equal(costPerSend(self), 1);
    assert.equal(costPerSend(family), 4);
    assert.equal(costPerSend(unknown), null);
  });

  it('multiplies per-send cost by reminder count across destinations', () => {
    const e = estimateQuota([self, family, company], 2, snapshot);
    assert.equal(e.perReminderKnown, 1 + 4 + 24);
    assert.equal(e.totalKnown, 58);
    assert.equal(e.availableBefore, 130);
    assert.equal(e.availableAfter, 72);
    assert.equal(e.status, 'ok');
  });

  it('flags near-limit when less than 20% of the monthly limit would remain', () => {
    const e = estimateQuota([company], 3, snapshot); // 72 → 58 left (< 60)
    assert.equal(e.status, 'near-limit');
  });

  it('flags exceeds when the safe remaining quota is insufficient', () => {
    const e = estimateQuota([company], 6, snapshot); // 144 > 130
    assert.equal(e.status, 'exceeds');
    assert.ok(e.availableAfter < 0);
  });

  it('never treats an unknown member count as free', () => {
    const e = estimateQuota([self, unknown], 1, snapshot);
    assert.equal(e.status, 'unknown-recipients');
    assert.equal(e.hasUnknownRecipients, true);
  });

  it('does not report negative availability before sending', () => {
    const e = estimateQuota([self], 1, { ...snapshot, consumedThisMonth: 400 });
    assert.equal(e.availableBefore, 0);
    assert.equal(e.status, 'exceeds');
  });
});

describe('destination evaluation', () => {
  it('defaults to the private chat only', () => {
    assert.deepEqual(defaultDestinationIds([company, family, self]), ['self']);
  });

  it('blocks confirmation when nothing is selected', () => {
    const r = evaluateDestinations('business', []);
    assert.equal(r.canConfirm, false);
    assert.ok(r.warnings.some((w) => w.code === 'no-destination'));
  });

  it('warns that group messages are visible to all members and cannot be revoked', () => {
    const r = evaluateDestinations('business', [company]);
    const codes = r.warnings.map((w) => w.code);
    assert.ok(codes.includes('group-visible-to-all'));
    assert.ok(codes.includes('broad-group'));
    assert.ok(codes.includes('cannot-revoke'));
    assert.equal(r.canConfirm, true);
    assert.equal(r.suggestMinimalDisclosure, false);
  });

  it('suggests minimal disclosure for sensitive categories in groups', () => {
    const r = evaluateDestinations('health', [family]);
    assert.equal(r.suggestMinimalDisclosure, true);
  });

  it('cautions when a sensitive appointment targets a company group', () => {
    const r = evaluateDestinations('family', [company]);
    assert.ok(r.warnings.some((w) => w.code === 'sensitive-in-company-group'));
  });

  it('explains separate delivery when mixing family and company groups', () => {
    const r = evaluateDestinations('special', [family, company]);
    assert.ok(r.warnings.some((w) => w.code === 'mixed-workspaces'));
  });

  it('blocks inactive destinations (e.g. Sally removed from the group)', () => {
    const removed: DestinationOption = { ...family, lifecycle: 'bot-removed' };
    const r = evaluateDestinations('family', [removed]);
    assert.equal(r.canConfirm, false);
  });

  it('viewers and inactive destinations are not selectable', () => {
    assert.equal(destinationAvailability(company), 'available');
    assert.equal(destinationAvailability({ ...company, viewerRole: 'viewer' }), 'no-permission');
    assert.equal(
      destinationAvailability({ ...company, lifecycle: 'pending-registration' }),
      'not-active',
    );
  });

  it('private-only appointments raise no group warnings', () => {
    const r = evaluateDestinations('personal', [self]);
    assert.deepEqual(r.warnings, []);
    assert.equal(r.canConfirm, true);
  });
});

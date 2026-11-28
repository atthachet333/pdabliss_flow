import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  appointmentInputSchema,
  defaultAppointmentStart,
  defaultMemberColor,
  effectiveMemberColor,
  formatAmount,
  formatMoneyThai,
  formatThaiDateTime,
  isMemberColorId,
  isPastLocalStart,
  MEMBER_COLORS,
  normalizeAmount,
  reminderEligibility,
  type EligibilityInput,
} from '../src/index.js';

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe('member identity colours', () => {
  it('every swatch carries white text at WCAG AA (4.5:1)', () => {
    for (const c of MEMBER_COLORS) {
      const ratio = 1.05 / (luminance(c.hex) + 0.05);
      assert.ok(ratio >= 4.5, `${c.id} ${ratio.toFixed(2)}`);
    }
    assert.equal(new Set(MEMBER_COLORS.map((c) => c.hex)).size, MEMBER_COLORS.length);
  });

  it('defaults are deterministic per workspace and fall back for unknown stored values', () => {
    const a = defaultMemberColor('w1', 'u1');
    assert.equal(defaultMemberColor('w1', 'u1'), a);
    assert.ok(isMemberColorId(a));
    assert.equal(effectiveMemberColor('plum', 'w1', 'u1'), 'plum');
    assert.equal(effectiveMemberColor('red;background:url(x)', 'w1', 'u1'), a);
    assert.equal(effectiveMemberColor(null, 'w1', 'u1'), a);
    const spread = new Set(Array.from({ length: 40 }, (_, i) => defaultMemberColor('w', `u${i}`)));
    assert.ok(spread.size >= 6, 'defaults spread across the palette');
  });
});

describe('bill amounts', () => {
  it('normalizes exact decimals without floating point and rejects invalid input', () => {
    assert.equal(normalizeAmount('1250'), '1250.00');
    assert.equal(normalizeAmount('1,250.5'), '1250.50');
    assert.equal(normalizeAmount('0.1'), '0.10');
    assert.equal(normalizeAmount('999999999999.99'), '999999999999.99');
    for (const bad of ['-1', '1.234', '1e3', '0012', '', 'abc', '1000000000000'])
      assert.equal(normalizeAmount(bad), null, bad);
    assert.equal(formatAmount('1234567.5'), '1,234,567.50');
    assert.equal(formatMoneyThai(null), 'ไม่ระบุจำนวนเงิน');
    assert.equal(formatMoneyThai('0.1'), '0.10 บาท');
  });

  it('the appointment schema accepts bills only with kind BILL', () => {
    const base = {
      workspaceId: '11111111-1111-4111-8111-111111111111',
      title: 'ค่าไฟ',
      category: 'personal',
      allDay: true,
      date: '2026-12-25',
    };
    const bill = appointmentInputSchema.parse({
      ...base,
      kind: 'BILL',
      bill: { amount: '1,200.5' },
    });
    assert.deepEqual(bill.bill, { amount: '1200.50', currency: 'THB' });
    assert.equal(
      appointmentInputSchema.safeParse({ ...base, bill: { amount: '1' } }).success,
      false,
    );
    assert.equal(
      appointmentInputSchema.safeParse({ ...base, kind: 'BILL', bill: { amount: '1.999' } })
        .success,
      false,
    );
    assert.equal(
      appointmentInputSchema.safeParse({
        ...base,
        recurrence: { frequency: 'MONTHLY', monthDay: 25 },
      }).success,
      true,
    );
  });
});

describe('reminder eligibility contract (EP03)', () => {
  const now = new Date('2026-12-10T03:00:00Z');
  const ok: EligibilityInput = {
    now,
    rule: { status: 'SCHEDULED', fireAt: new Date('2026-12-10T03:00:00Z') },
    appointment: { status: 'SCHEDULED', paymentStatus: null },
    creator: { status: 'ACTIVE', isActiveMember: true },
    workspace: { status: 'ACTIVE' },
    destination: {
      status: 'ACTIVE',
      kind: 'PRIVATE_USER',
      recipient: { status: 'ACTIVE', canView: true },
    },
    deliveryPaused: false,
  };
  const reason = (patch: Partial<EligibilityInput>) => {
    const r = reminderEligibility({ ...ok, ...patch });
    return r.eligible ? 'eligible' : r.reason;
  };
  it('is eligible only when every fresh check passes', () => {
    assert.equal(reason({}), 'eligible');
    assert.equal(reason({ deliveryPaused: true }), 'delivery-paused');
    assert.equal(
      reason({ rule: { status: 'SUPPRESSED', fireAt: ok.rule.fireAt } }),
      'rule-not-scheduled',
    );
    assert.equal(
      reason({ appointment: { status: 'SCHEDULED', paymentStatus: 'PAID' } }),
      'bill-paid',
    );
    assert.equal(
      reason({ appointment: { status: 'CANCELLED', paymentStatus: null } }),
      'appointment-cancelled',
    );
    assert.equal(reason({ now: new Date('2026-12-10T02:50:00Z') }), 'not-due');
    assert.equal(reason({ now: new Date('2026-12-10T03:30:00Z') }), 'stale', 'no stale replay');
    assert.equal(
      reason({ creator: { status: 'REVOKED', isActiveMember: true } }),
      'creator-inactive',
    );
    assert.equal(
      reason({ creator: { status: 'ACTIVE', isActiveMember: false } }),
      'creator-not-member',
    );
    assert.equal(reason({ workspace: { status: 'ARCHIVED' } }), 'workspace-inactive');
    assert.equal(
      reason({ destination: { status: 'DISABLED', kind: 'GROUP' } }),
      'destination-inactive',
    );
    assert.equal(
      reason({
        destination: {
          status: 'ACTIVE',
          kind: 'PRIVATE_USER',
          recipient: { status: 'SUSPENDED', canView: true },
        },
      }),
      'recipient-inactive',
    );
    assert.equal(
      reason({
        destination: {
          status: 'ACTIVE',
          kind: 'PRIVATE_USER',
          recipient: { status: 'ACTIVE', canView: false },
        },
      }),
      'recipient-cannot-view',
    );
  });
});

describe('RD03 default start and RD08 Thai date-time', () => {
  const at = (iso: string) => new Date(iso);
  it('picks the next full hour at least 30 minutes ahead in Bangkok', () => {
    // 16:20 Bangkok = 09:20 UTC
    assert.deepEqual(defaultAppointmentStart(at('2026-11-28T09:20:00Z'), 'Asia/Bangkok'), {
      date: '2026-11-28',
      startTime: '17:00',
      movedToNextDay: false,
    });
    // 16:40 → 18:00
    assert.equal(
      defaultAppointmentStart(at('2026-11-28T09:40:00Z'), 'Asia/Bangkok').startTime,
      '18:00',
    );
    // 06:00 → 07:00
    assert.equal(
      defaultAppointmentStart(at('2026-11-27T23:00:00Z'), 'Asia/Bangkok').startTime,
      '07:00',
    );
  });

  it('rolls over midnight to 09:00 tomorrow and keeps 09:00 for chosen dates', () => {
    // 23:40 Bangkok on 28 Nov = 16:40 UTC
    assert.deepEqual(defaultAppointmentStart(at('2026-11-28T16:40:00Z'), 'Asia/Bangkok'), {
      date: '2026-11-29',
      startTime: '09:00',
      movedToNextDay: true,
    });
    // 23:10 Bangkok still today 23:59? next full hour ≥ 23:40 is 24 → tomorrow
    assert.equal(
      defaultAppointmentStart(at('2026-11-28T16:10:00Z'), 'Asia/Bangkok').movedToNextDay,
      true,
    );
    // 22:20 → 23:00 today
    assert.equal(
      defaultAppointmentStart(at('2026-11-28T15:20:00Z'), 'Asia/Bangkok').startTime,
      '23:00',
    );
    assert.deepEqual(
      defaultAppointmentStart(at('2026-11-28T16:40:00Z'), 'Asia/Bangkok', '2026-12-24'),
      { date: '2026-12-24', startTime: '09:00', movedToNextDay: false },
    );
    assert.equal(
      isPastLocalStart(at('2026-11-28T09:20:00Z'), 'Asia/Bangkok', '2026-11-28', '09:00'),
      true,
    );
    assert.equal(
      isPastLocalStart(at('2026-11-28T09:20:00Z'), 'Asia/Bangkok', '2026-11-28', '17:00'),
      false,
    );
    assert.equal(
      isPastLocalStart(at('2026-11-28T09:20:00Z'), 'Asia/Bangkok', '2026-11-27', '23:00'),
      true,
    );
  });

  it('formats instants in Thai with the Buddhist Era year in Bangkok time', () => {
    assert.match(
      formatThaiDateTime(at('2026-11-26T02:00:00Z'), 'Asia/Bangkok'),
      / 26 พ\.ย\. 2569 · 09:00 น\.$/,
    );
    // 23:30 UTC on 31 Dec 2026 is already 1 Jan 2027 06:30 in Bangkok
    assert.match(
      formatThaiDateTime(at('2026-12-31T23:30:00Z'), 'Asia/Bangkok'),
      / 1 ม\.ค\. 2570 · 06:30 น\.$/,
    );
  });
});

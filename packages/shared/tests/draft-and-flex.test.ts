import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateDraft } from '../src/appointment-draft.js';
import {
  ALT_TEXT_MAX,
  buildFlexPreview,
  FLEX_TEMPLATE_IDS,
  type FlexPreviewInput,
} from '../src/flex-preview.js';
import { zonedLocalToUtc } from '../src/time.js';

const validDraft = {
  title: '  เรียน Network  ',
  category: 'personal',
  localDate: '2026-11-27',
  localTime: '19:00',
  allDay: false,
  timeZone: 'Asia/Bangkok',
  destinationIds: ['self'],
  reminderOffsets: [30],
  minimalDisclosure: false,
};

describe('appointment draft validation', () => {
  it('accepts a valid draft and trims the title', () => {
    const r = validateDraft(validDraft);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value.title, 'เรียน Network');
  });

  it('rejects empty titles, invalid dates and missing destinations with Thai messages', () => {
    const r = validateDraft({
      ...validDraft,
      title: '   ',
      localDate: '2026-02-30',
      destinationIds: [],
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      const paths = r.issues.map((i) => i.path);
      assert.ok(paths.includes('title'));
      assert.ok(paths.includes('localDate'));
      assert.ok(paths.includes('destinationIds'));
      assert.ok(r.issues.every((i) => i.message.length > 0));
    }
  });

  it('rejects unknown categories and too many reminders', () => {
    const r = validateDraft({
      ...validDraft,
      category: 'party',
      reminderOffsets: [0, 5, 10, 15, 30, 60],
    });
    assert.equal(r.ok, false);
  });
});

const now = new Date('2026-11-26T02:00:00Z');
const baseFlex: FlexPreviewInput = {
  templateId: 'health',
  category: 'health',
  title: 'นัดตรวจสุขภาพประจำปี',
  localDate: '2026-11-27',
  allDay: false,
  start: zonedLocalToUtc('2026-11-27', '09:00', 'Asia/Bangkok'),
  timeZone: 'Asia/Bangkok',
  location: 'คลินิกตัวอย่าง ชั้น 2',
  destination: { displayName: 'กลุ่มครอบครัว (ตัวอย่าง)', kind: 'line-group' },
  reminderOffsetMinutes: 30,
  now,
};

describe('flex preview model', () => {
  it('builds every template id', () => {
    for (const templateId of FLEX_TEMPLATE_IDS) {
      const m = buildFlexPreview({ ...baseFlex, templateId, summaryItems: [] });
      assert.equal(m.templateId, templateId);
      assert.ok(m.headerLabel.length > 0);
      assert.ok(m.altText.startsWith('[FLOW]'));
      assert.ok(m.altText.length <= ALT_TEXT_MAX);
    }
  });

  it('prioritises what / when / what next', () => {
    const m = buildFlexPreview(baseFlex);
    assert.equal(m.title, 'นัดตรวจสุขภาพประจำปี');
    assert.equal(m.timeText, '09:00 น.');
    assert.equal(m.timingContext, 'อีก 30 นาที');
    assert.equal(m.primaryAction.label, 'ดูรายละเอียด');
    assert.equal(m.secondaryAction?.label, 'รับทราบแล้ว');
    assert.match(m.destinationText ?? '', /กลุ่มครอบครัว/);
  });

  it('minimal-disclosure mode hides title, location and description — including the alt text', () => {
    const m = buildFlexPreview({
      ...baseFlex,
      minimalDisclosure: true,
      description: 'รายละเอียดลับ',
    });
    assert.equal(m.title, 'นัดหมายสำคัญ');
    assert.equal(m.location, undefined);
    assert.equal(m.description, undefined);
    assert.equal(m.sallyLine, 'คุณมีนัดหมายสำคัญเวลา 09:00 น.');
    assert.equal(m.theme, 'brand');
    assert.equal(m.headerLabel, 'แจ้งเตือนนัดหมาย');
    assert.ok(!m.altText.includes('ตรวจสุขภาพ'));
    assert.ok(!m.altText.includes('คลินิก'));
  });

  it('clamps very long alt text', () => {
    const m = buildFlexPreview({ ...baseFlex, title: 'ก'.repeat(900) });
    assert.equal(m.altText.length, ALT_TEXT_MAX);
    assert.ok(m.altText.endsWith('…'));
  });

  it('shows the previous time on the changed template', () => {
    const m = buildFlexPreview({
      ...baseFlex,
      templateId: 'changed',
      previous: {
        localDate: '2026-11-27',
        start: zonedLocalToUtc('2026-11-27', '08:00', 'Asia/Bangkok'),
        allDay: false,
      },
    });
    assert.match(m.previousWhenText ?? '', /08:00 น\./);
    assert.equal(m.theme, 'health');
  });

  it('uses a neutral theme and no acknowledgement action for cancellations', () => {
    const m = buildFlexPreview({ ...baseFlex, templateId: 'cancelled' });
    assert.equal(m.theme, 'neutral');
    assert.equal(m.secondaryAction, undefined);
    assert.equal(m.timingContext, undefined);
  });

  it('all-day appointments display "ทั้งวัน" instead of a time', () => {
    const m = buildFlexPreview({
      ...baseFlex,
      templateId: 'special',
      category: 'special',
      allDay: true,
      reminderOffsetMinutes: undefined,
    });
    assert.equal(m.timeText, 'ทั้งวัน');
  });
});

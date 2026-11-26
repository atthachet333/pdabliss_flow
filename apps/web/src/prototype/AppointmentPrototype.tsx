import { useId, useMemo, useReducer, useState } from 'react';
import {
  CATEGORIES,
  CATEGORY_IDS,
  describeOffsetThai,
  formatThaiDate,
  formatThaiLocalDate,
  formatThaiTime,
  isValidLocalDate,
  PRESET_REMINDER_OFFSETS,
  type QuotaEstimate,
  type ReminderIssue,
} from '@flow/shared';
import { ChatPreview } from '../components/FlexBubble';
import {
  ArrowLeft,
  Bell,
  CalendarDays,
  Check,
  Eye,
  RefreshCw,
  ShieldCheck,
} from '../components/icons';
import {
  Button,
  CATEGORY_ICON,
  CategoryBadge,
  Notice,
  ProtoBadge,
  SallyImage,
  Switch,
} from '../components/ui';
import { MOCK_DESTINATIONS, MOCK_QUOTA, MOCK_TIMEZONE } from '../fixtures/mock';
import { DestinationSelector } from './DestinationSelector';
import { deriveDraft, draftReducer, initialDraft, TITLE_PLACEHOLDER } from './draft-state';

const ISSUE_TH: Record<ReminderIssue, string> = {
  past: 'เวลานี้ผ่านไปแล้ว จึงไม่ตั้งเตือน',
  duplicate: 'ซ้ำกับรายการอื่น',
  'invalid-offset': 'ค่าไม่ถูกต้อง',
  'over-limit': 'เกินจำนวนสูงสุด',
};

const QUOTA_TH: Record<
  QuotaEstimate['status'],
  { tone: 'success' | 'caution' | 'block'; text: string }
> = {
  ok: { tone: 'success', text: 'โควตาเพียงพอ' },
  'near-limit': { tone: 'caution', text: 'โควตาใกล้หมด' },
  exceeds: { tone: 'block', text: 'โควตาไม่พอ — ระบบจะไม่ยอมให้ตั้งเตือนนี้' },
  'unknown-recipients': { tone: 'caution', text: 'บางกลุ่มยังไม่ทราบจำนวนสมาชิก' },
};

export function AppointmentPrototype() {
  const [now] = useState(() => new Date());
  const [state, dispatch] = useReducer(draftReducer, undefined, () =>
    initialDraft(now, MOCK_TIMEZONE, MOCK_DESTINATIONS),
  );
  const d = useMemo(
    () =>
      deriveDraft(state, {
        now,
        timeZone: MOCK_TIMEZONE,
        options: MOCK_DESTINATIONS,
        quota: MOCK_QUOTA,
      }),
    [state, now],
  );
  const ids = { title: useId(), date: useId(), time: useId(), location: useId() };
  const titleIssue = d.issues.find((i) => i.path === 'title');
  const [titleTouched, setTitleTouched] = useState(false);

  if (state.step === 'simulated') {
    return (
      <div className="proto proto--done f-card">
        <SallyImage expression="thoughtful" size={96} decorative />
        <h3>นี่คือการจำลองเท่านั้น</h3>
        <p className="f-muted">
          ระบบยังไม่ได้บันทึกนัดหมาย และยังไม่ได้ส่งข้อความ LINE ใดๆ — การบันทึกจริงจะเริ่มใน EP03
          และการแจ้งเตือนจริงใน EP04
        </p>
        <ProtoBadge>ไม่มีการบันทึกหรือส่งจริง</ProtoBadge>
        <Button
          variant="dark"
          icon={RefreshCw}
          onClick={() =>
            dispatch({ type: 'reset', state: initialDraft(now, MOCK_TIMEZONE, MOCK_DESTINATIONS) })
          }
        >
          เริ่มสร้างนัดหมายใหม่
        </Button>
      </div>
    );
  }

  const dateText = isValidLocalDate(state.localDate)
    ? formatThaiLocalDate(state.localDate).long
    : 'วันที่ไม่ถูกต้อง';

  const previewPanel = (
    <aside className="proto__preview" aria-label="ตัวอย่างการแจ้งเตือนแบบสด">
      <div className="proto__preview-head">
        <p className="f-eyebrow">Live preview</p>
        <ProtoBadge />
      </div>
      {d.previews.length > 1 ? (
        <div className="proto__tabs" role="tablist" aria-label="ตัวอย่างแยกตามปลายทาง">
          {d.previews.map((p) => (
            <button
              key={p.destination.id}
              role="tab"
              type="button"
              aria-selected={d.activePreview?.destination.id === p.destination.id}
              className="proto__tab"
              onClick={() => dispatch({ type: 'preview-destination', id: p.destination.id })}
            >
              {p.destination.displayName}
            </button>
          ))}
        </div>
      ) : null}
      {d.activePreview ? (
        <ChatPreview
          model={d.activePreview.model}
          label={d.previews.length > 1 ? 'แต่ละปลายทางได้รับข้อความแยกกัน' : undefined}
        />
      ) : (
        <Notice tone="caution">เลือกวันเวลาและปลายทางเพื่อดูตัวอย่าง</Notice>
      )}

      <div className="proto__schedule">
        <p className="proto__mini-title">
          <Bell aria-hidden /> เวลาแจ้งเตือนจริงที่คำนวณได้
        </p>
        {d.plan && d.plan.scheduled.length > 0 ? (
          <ol className="proto__times">
            {d.plan.scheduled.map((r) => (
              <li key={r.offsetMinutes}>
                <span className="f-num">{formatThaiTime(r.fireAt, MOCK_TIMEZONE)}</span>
                <span>{formatThaiDate(r.fireAt, MOCK_TIMEZONE).short}</span>
                <span className="f-muted">{describeOffsetThai(r.offsetMinutes)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="f-hint">ยังไม่มีการแจ้งเตือนที่ตั้งได้</p>
        )}
        {d.plan?.rejected.map((r) => (
          <p key={`${r.offsetMinutes}-${r.issue}`} className="f-hint proto__rejected">
            {describeOffsetThai(r.offsetMinutes)}: {ISSUE_TH[r.issue]}
          </p>
        ))}
      </div>

      <QuotaMeter estimate={d.quota} />
    </aside>
  );

  if (state.step === 'review') {
    return (
      <div className="proto proto--review">
        <div className="proto__form f-card">
          <p className="f-eyebrow">Review · ตรวจสอบก่อนยืนยัน</p>
          <h3 className="proto__review-title">{state.title.trim()}</h3>
          <dl className="proto__dl">
            <div>
              <dt>หมวด</dt>
              <dd>
                <CategoryBadge category={state.category} />
              </dd>
            </div>
            <div>
              <dt>วันเวลา</dt>
              <dd>
                {dateText} · {state.allDay ? 'ทั้งวัน' : `${state.localTime} น.`}
              </dd>
            </div>
            {state.location.trim() ? (
              <div>
                <dt>สถานที่</dt>
                <dd>{state.location.trim()}</dd>
              </div>
            ) : null}
            <div>
              <dt>ผู้ที่เห็นนัดหมาย</dt>
              <dd>{d.selected.map((s) => s.displayName).join(', ')}</dd>
            </div>
            <div>
              <dt>ปลายทางแจ้งเตือน</dt>
              <dd>{d.selected.length} ปลายทาง (ส่งแยกกัน)</dd>
            </div>
            <div>
              <dt>การแจ้งเตือน</dt>
              <dd>
                {d.plan?.scheduled.length
                  ? d.plan.scheduled
                      .map(
                        (r) =>
                          `${formatThaiDate(r.fireAt, MOCK_TIMEZONE).short} ${formatThaiTime(r.fireAt, MOCK_TIMEZONE)}`,
                      )
                      .join(' · ')
                  : 'ไม่มี'}
              </dd>
            </div>
            <div>
              <dt>โควตาข้อความโดยประมาณ</dt>
              <dd className="f-num">{d.quota.totalKnown} ข้อความ (ข้อมูลจำลอง)</dd>
            </div>
            <div>
              <dt>โหมดแจ้งแบบย่อ</dt>
              <dd>{state.minimalDisclosure ? 'เปิด (ซ่อนรายละเอียดในกลุ่ม)' : 'ปิด'}</dd>
            </div>
          </dl>
          <div className="proto__warnings">
            {d.evaluation.warnings
              .filter(
                (w) =>
                  w.severity !== 'info' ||
                  w.code === 'cannot-revoke' ||
                  w.code === 'group-visible-to-all',
              )
              .map((w, i) => (
                <Notice
                  key={`${w.code}-${i}`}
                  tone={
                    w.severity === 'block' ? 'block' : w.severity === 'caution' ? 'caution' : 'info'
                  }
                >
                  {w.messageTh}
                </Notice>
              ))}
            <Notice tone="info">
              การบันทึกนัดหมายกับการส่งข้อความเป็นคนละขั้นตอน — Sally จะส่งเฉพาะตามเวลาแจ้งเตือนข้างต้นเท่านั้น
            </Notice>
          </div>
          <div className="proto__actions">
            <Button icon={ArrowLeft} onClick={() => dispatch({ type: 'back-to-edit' })}>
              กลับไปแก้ไข
            </Button>
            <Button
              variant="primary"
              icon={Check}
              onClick={() => dispatch({ type: 'simulate-confirm' })}
            >
              ยืนยัน (โหมดจำลอง)
            </Button>
          </div>
        </div>
        {previewPanel}
      </div>
    );
  }

  return (
    <div className="proto">
      <form className="proto__form f-card" onSubmit={(e) => e.preventDefault()} noValidate>
        <fieldset className="proto__section">
          <legend>
            <span className="proto__step">1</span> นัดหมายอะไร
          </legend>
          <div className="f-field">
            <label className="f-label" htmlFor={ids.title}>
              ชื่อนัดหมาย
            </label>
            <input
              id={ids.title}
              className="f-input f-input--title"
              value={state.title}
              placeholder={`เช่น ประชุมพนักงาน, นัดหาหมอ`}
              maxLength={120}
              aria-invalid={titleTouched && titleIssue ? true : undefined}
              onBlur={() => setTitleTouched(true)}
              onChange={(e) => dispatch({ type: 'set-title', value: e.target.value })}
            />
            {titleTouched && titleIssue ? <p className="f-error">{titleIssue.message}</p> : null}
          </div>
          <div className="f-field">
            <span className="f-label" id={`${ids.title}-cat`}>
              หมวดนัดหมาย
            </span>
            <div className="proto__cats" role="radiogroup" aria-labelledby={`${ids.title}-cat`}>
              {CATEGORY_IDS.map((c) => {
                const Icon = CATEGORY_ICON[c];
                return (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={state.category === c}
                    className="proto__cat"
                    data-theme={c}
                    onClick={() => dispatch({ type: 'set-category', value: c })}
                  >
                    <Icon aria-hidden />
                    {CATEGORIES[c].labelTh}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="f-field">
            <label className="f-label" htmlFor={ids.location}>
              สถานที่ <small>(ไม่บังคับ)</small>
            </label>
            <input
              id={ids.location}
              className="f-input"
              value={state.location}
              placeholder="เช่น ห้องประชุมใหญ่"
              maxLength={160}
              onChange={(e) => dispatch({ type: 'set-location', value: e.target.value })}
            />
          </div>
        </fieldset>

        <fieldset className="proto__section">
          <legend>
            <span className="proto__step">2</span> เมื่อไร
          </legend>
          <div className="proto__row">
            <div className="f-field">
              <label className="f-label" htmlFor={ids.date}>
                วันที่
              </label>
              <input
                id={ids.date}
                className="f-input f-num"
                type="date"
                value={state.localDate}
                onChange={(e) => dispatch({ type: 'set-date', value: e.target.value })}
              />
            </div>
            <div className="f-field">
              <label className="f-label" htmlFor={ids.time}>
                เวลาเริ่ม
              </label>
              <input
                id={ids.time}
                className="f-input f-num"
                type="time"
                value={state.localTime}
                disabled={state.allDay}
                onChange={(e) => dispatch({ type: 'set-time', value: e.target.value })}
              />
            </div>
          </div>
          <p className="proto__date-th">
            <CalendarDays aria-hidden /> {dateText}
            {state.allDay ? ' · ทั้งวัน' : ''} · เวลาประเทศไทย
          </p>
          <Switch
            checked={state.allDay}
            onChange={(v) => dispatch({ type: 'set-all-day', value: v })}
            label="นัดหมายทั้งวัน"
            hint="แจ้งเตือนอ้างอิงเวลา 08:00 น. ของวันนั้น"
          />
        </fieldset>

        <fieldset className="proto__section">
          <legend>
            <span className="proto__step">3</span> ใครเห็น และแจ้งเตือนที่ไหน
          </legend>
          <DestinationSelector
            options={MOCK_DESTINATIONS}
            selectedIds={state.destinationIds}
            onToggle={(id) =>
              dispatch({ type: 'toggle-destination', id, options: MOCK_DESTINATIONS })
            }
            onOnlyMe={() => dispatch({ type: 'only-me', options: MOCK_DESTINATIONS })}
          />
          {d.evaluation.warnings
            .filter((w) => w.severity !== 'info')
            .map((w, i) => (
              <Notice key={`${w.code}-${i}`} tone={w.severity === 'block' ? 'block' : 'caution'}>
                {w.messageTh}
              </Notice>
            ))}
          {d.selected.some((s) => s.kind === 'line-group') ? (
            <Notice tone="info">ข้อความในกลุ่ม LINE สมาชิกปัจจุบันทุกคนจะเห็น และเรียกคืนไม่ได้</Notice>
          ) : null}
          <Switch
            checked={state.minimalDisclosure}
            onChange={(v) => dispatch({ type: 'set-minimal-disclosure', value: v })}
            label="แจ้งแบบย่อในกลุ่ม"
            hint={
              d.evaluation.suggestMinimalDisclosure
                ? 'แนะนำสำหรับนัดหมวดนี้ — กลุ่มจะเห็นเพียง “คุณมีนัดหมายสำคัญเวลา …”'
                : 'ซ่อนชื่อและสถานที่เมื่อแจ้งในกลุ่ม'
            }
          />
        </fieldset>

        <fieldset className="proto__section">
          <legend>
            <span className="proto__step">4</span> แจ้งเตือนเมื่อไร
          </legend>
          <div className="proto__reminders" role="group" aria-label="เวลาแจ้งเตือนล่วงหน้า">
            {PRESET_REMINDER_OFFSETS.map((o) => (
              <button
                key={o}
                type="button"
                className="f-chip"
                aria-pressed={state.reminderOffsets.includes(o)}
                onClick={() => dispatch({ type: 'toggle-reminder', offset: o })}
              >
                {o === 0 ? 'ตรงเวลา' : describeOffsetThai(o)}
              </button>
            ))}
          </div>
          <p className="f-hint">เลือกได้หลายเวลา สูงสุด 5 ครั้งต่อนัดหมาย</p>
        </fieldset>

        <div className="proto__submit">
          {!d.canReview ? (
            <p className="f-hint">
              {d.issues[0]?.message ??
                (d.quota.status === 'exceeds' ? 'โควตาไม่พอสำหรับการแจ้งเตือนนี้' : 'กรุณาตรวจสอบปลายทาง')}
            </p>
          ) : (
            <p className="f-hint">
              <ShieldCheck aria-hidden className="inline-icon" /> ขั้นถัดไปคือหน้าตรวจสอบ ยังไม่มีการบันทึก
            </p>
          )}
          <Button
            variant="primary"
            size="lg"
            icon={Eye}
            disabled={!d.canReview}
            onClick={() => {
              setTitleTouched(true);
              if (d.canReview) dispatch({ type: 'go-review' });
            }}
          >
            ตรวจสอบก่อนยืนยัน
          </Button>
        </div>
        <p className="f-hint proto__ph">ตัวอย่างจะแสดง “{TITLE_PLACEHOLDER}” จนกว่าจะพิมพ์ชื่อ</p>
      </form>
      {previewPanel}
    </div>
  );
}

export function QuotaMeter({ estimate }: { estimate: QuotaEstimate }) {
  const q = MOCK_QUOTA;
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / q.monthlyLimit) * 100))}%`;
  const info = QUOTA_TH[estimate.status];
  return (
    <div className="quota">
      <div className="quota__head">
        <p className="proto__mini-title">โควตาข้อความ LINE เดือนนี้</p>
        <ProtoBadge>ค่าจำลอง</ProtoBadge>
      </div>
      <div
        className="quota__bar"
        role="img"
        aria-label={`ใช้ไป ${q.consumedThisMonth} จอง ${q.reservedThisMonth} นัดนี้ ${estimate.totalKnown} สำรอง ${q.safetyReserve} จาก ${q.monthlyLimit}`}
      >
        <span className="quota__seg quota__seg--used" style={{ width: pct(q.consumedThisMonth) }} />
        <span
          className="quota__seg quota__seg--reserved"
          style={{ width: pct(q.reservedThisMonth) }}
        />
        <span
          className={`quota__seg quota__seg--this${estimate.status === 'exceeds' ? ' is-over' : ''}`}
          style={{ width: pct(estimate.totalKnown) }}
        />
        <span
          className="quota__seg quota__seg--safety"
          style={{ width: pct(q.safetyReserve), marginLeft: 'auto' }}
        />
      </div>
      <ul className="quota__legend f-num">
        <li>
          <i className="quota__key quota__key--used" />
          ใช้ไป {q.consumedThisMonth}
        </li>
        <li>
          <i className="quota__key quota__key--reserved" />
          จองไว้ {q.reservedThisMonth}
        </li>
        <li>
          <i className="quota__key quota__key--this" />
          นัดนี้ {estimate.totalKnown}
        </li>
        <li>
          <i className="quota__key quota__key--safety" />
          สำรอง {q.safetyReserve}
        </li>
      </ul>
      <p className={`quota__status quota__status--${info.tone}`}>
        {info.text} · เหลือใช้ได้หลังนัดนี้{' '}
        <span className="f-num">{Math.max(estimate.availableAfter, 0)}</span> จาก{' '}
        <span className="f-num">{q.monthlyLimit}</span>
      </p>
      <p className="f-hint">
        ข้อความในกลุ่มนับตามจำนวนสมาชิกที่ได้รับ · ข้อความตอบกลับ (reply) ไม่นับ · ขีดจำกัดจริงจะดึงจาก LINE ใน EP04
      </p>
    </div>
  );
}

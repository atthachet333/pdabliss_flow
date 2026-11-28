/**
 * Create / edit an appointment.
 *  - Idempotency: one key per form session, reused on retry until the save succeeds, so a
 *    double tap or a retried request never creates two appointments.
 *  - Edits send the version that was loaded; a 409 shows a conflict notice (no overwrite).
 *  - Reminder times are previewed with the shared engine; the server recomputes and is the
 *    authority. Destination rules (privacy, sensitive categories) are enforced server-side.
 *  - Previews and estimates never send anything.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import {
  CALENDAR_PRESETS,
  calculateReminders,
  CATEGORY_IDS,
  defaultAppointmentStart,
  describeRecurrenceThai,
  expandRecurrence,
  isPastLocalStart,
  MAX_REMINDER_RULES,
  normalizeAmount,
  RELATIVE_PRESETS,
  reminderLabelTh,
  formatThaiLocalDate,
  toLocalTimeString,
  type AppointmentDetailDto,
  type AppointmentInputDraft,
  type CategoryId,
  type DestinationOptionDto,
  type RecurrenceRule,
  type ReminderRuleDto,
  type SeriesScope,
} from '@flow/shared';
import { FlexBubble } from '../../components/FlexBubble';
import { Bell, Eye, Lock, Plus, TriangleAlert, Users, X } from '../../components/icons';
import { Button, CategoryBadge, Notice, Switch } from '../../components/ui';
import {
  newIdempotencyKey,
  type EstimateDto,
  type PreviewDto,
  type WorkspaceDetailDto,
} from '../api';
import {
  errorCode,
  errorText,
  KIND_TEXT,
  TZ,
  todayLocal,
  useAction,
  useApp,
  useLoad,
  VISIBILITY_TEXT,
} from '../core';
import { fireText, ScopeChooser } from '../extras';
import { Confirm, Field, Loaded, Page, Segmented } from '../ui';

type Visibility = 'PRIVATE' | 'WORKSPACE' | 'SELECTED';
type Policy = 'FULL' | 'PRIVACY_SAFE';
const SENSITIVE = new Set<CategoryId>(['health', 'personal', 'family']);
const BROAD_GROUP = 15;

interface Draft {
  workspaceId: string;
  title: string;
  category: CategoryId;
  allDay: boolean;
  date: string;
  endDate: string;
  startTime: string;
  endTime: string;
  location: string;
  notes: string;
  visibility: Visibility;
  sharedWithUserIds: string[];
  destinations: { destinationId: string; contentPolicy: Policy }[];
  confirmSensitive: boolean;
  reminders: ReminderRuleDto[];
  kind: 'EVENT' | 'BILL';
  amount: string;
  repeat: 'NONE' | RecurrenceRule['frequency'];
  interval: number;
  monthDayMode: 'START' | 'LAST' | 'DAY';
  monthDay: number;
  missingDay: 'LAST_DAY' | 'SKIP';
  endType: 'NEVER' | 'UNTIL' | 'COUNT';
  until: string;
  count: number;
}

function ruleOf(d: Draft): RecurrenceRule | null {
  if (d.repeat === 'NONE') return null;
  return {
    frequency: d.repeat,
    interval: Math.max(1, Math.min(99, Math.round(d.interval) || 1)),
    monthDay:
      d.repeat !== 'MONTHLY' || d.monthDayMode === 'START'
        ? null
        : d.monthDayMode === 'LAST'
          ? 'LAST'
          : Math.max(1, Math.min(31, Math.round(d.monthDay) || 1)),
    missingDay: d.missingDay,
    end:
      d.endType === 'UNTIL' && d.until
        ? { type: 'UNTIL', until: d.until }
        : d.endType === 'COUNT'
          ? { type: 'COUNT', count: Math.max(1, Math.min(500, Math.round(d.count) || 1)) }
          : { type: 'NEVER' },
  };
}

function toInput(d: Draft, withRecurrence = true): AppointmentInputDraft {
  const amount = d.amount.trim() ? normalizeAmount(d.amount) : null;
  return {
    workspaceId: d.workspaceId,
    title: d.title,
    category: d.category,
    allDay: d.allDay,
    date: d.date,
    endDate: d.allDay ? (d.endDate && d.endDate !== d.date ? d.endDate : null) : null,
    startTime: d.allDay ? null : d.startTime,
    endTime: d.allDay || !d.endTime ? null : d.endTime,
    timeZone: TZ,
    location: d.location || null,
    notes: d.notes || null,
    visibility: d.visibility,
    sharedWithUserIds: d.visibility === 'SELECTED' ? d.sharedWithUserIds : [],
    destinations: d.destinations,
    confirmSensitive: d.confirmSensitive,
    reminders: d.reminders,
    kind: d.kind,
    ...(d.kind === 'BILL'
      ? { bill: { amount: amount ?? (d.amount.trim() || null), currency: 'THB' } }
      : {}),
    ...(withRecurrence && ruleOf(d) ? { recurrence: ruleOf(d) } : {}),
  };
}

const RECURRENCE_DEFAULTS = {
  repeat: 'NONE',
  interval: 1,
  monthDayMode: 'START',
  monthDay: 1,
  missingDay: 'LAST_DAY',
  endType: 'NEVER',
  until: '',
  count: 12,
} as const;

function fromDetail(a: AppointmentDetailDto): Draft {
  const r = a.recurrence?.rule;
  return {
    workspaceId: a.workspaceId,
    title: a.title,
    category: a.category,
    allDay: a.allDay,
    date: a.startDate,
    endDate: a.endDate,
    startTime: a.startAt ? toLocalTimeString(new Date(a.startAt), a.timeZone) : '09:00',
    endTime: a.endAt ? toLocalTimeString(new Date(a.endAt), a.timeZone) : '',
    location: a.location ?? '',
    notes: a.notes ?? '',
    visibility: a.visibility,
    sharedWithUserIds: a.sharedWith.map((s) => s.id),
    destinations: a.destinations.map((d) => ({
      destinationId: d.id,
      contentPolicy: d.contentPolicy,
    })),
    confirmSensitive: false,
    reminders: a.reminders.map((r) =>
      r.kind === 'RELATIVE'
        ? { kind: 'RELATIVE', offsetMinutes: r.offsetMinutes ?? 0, enabled: r.enabled }
        : {
            kind: 'CALENDAR',
            dayOffset: r.dayOffset ?? 0,
            localTime: r.localTime ?? '06:00',
            enabled: r.enabled,
          },
    ),
    kind: a.kind,
    amount: a.bill?.amount ?? '',
    ...RECURRENCE_DEFAULTS,
    ...(r
      ? {
          repeat: r.frequency,
          interval: r.interval,
          monthDayMode: r.monthDay === null ? 'START' : r.monthDay === 'LAST' ? 'LAST' : 'DAY',
          monthDay: typeof r.monthDay === 'number' ? r.monthDay : 1,
          missingDay: r.missingDay,
          endType: r.end.type,
          until: r.end.type === 'UNTIL' ? r.end.until : '',
          count: r.end.type === 'COUNT' ? r.end.count : 12,
        }
      : {}),
  };
}

export function AppointmentFormPage({ mode }: { mode: 'create' | 'edit' }) {
  const { api, me } = useApp();
  const { id } = useParams();
  const [params] = useSearchParams();
  const from = params.get('from');
  const load = useLoad2(mode, id, from, api);
  const writable = me.workspaces.filter((w) => w.role !== 'VIEWER');
  return (
    <Page title={mode === 'create' ? 'สร้างนัดหมาย' : 'แก้ไขนัดหมาย'} back={true}>
      {writable.length === 0 ? (
        <Notice tone="info">คุณมีสิทธิ์ดูอย่างเดียวในทุกกลุ่ม จึงยังสร้างนัดหมายไม่ได้ค่ะ</Notice>
      ) : (
        <Loaded load={load}>
          {(initial) => (
            <Form
              mode={mode}
              id={id ?? null}
              initial={initial.draft}
              version={initial.version}
              creator={initial.creator}
              recurring={initial.recurring}
            />
          )}
        </Loaded>
      )}
    </Page>
  );
}

function useLoad2(
  mode: 'create' | 'edit',
  id: string | undefined,
  from: string | null,
  api: ReturnType<typeof useApp>['api'],
) {
  const { me } = useApp();
  const [params] = useSearchParams();
  const date = params.get('date');
  return useLoad(
    async () => {
      if (mode === 'edit' && id) {
        const a = await api.appointment(id);
        return {
          draft: fromDetail(a),
          version: a.version,
          creator: a.mine,
          recurring: a.series !== null,
        };
      }
      const prefs = me.preferences;
      const writable = me.workspaces.filter((w) => w.role !== 'VIEWER');
      const ws =
        writable.find((w) => w.id === prefs.defaultWorkspaceId)?.id ?? writable[0]?.id ?? '';
      // RD03: never default to a start time that has already passed (see form-defaults.ts).
      const start = defaultAppointmentStart(
        new Date(),
        TZ,
        date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayLocal(),
      );
      const kind = params.get('kind') === 'bill' ? ('BILL' as const) : ('EVENT' as const);
      const base: Draft = {
        workspaceId: ws,
        title: '',
        category: 'personal',
        allDay: kind === 'BILL',
        date: start.date,
        endDate: '',
        startTime: start.startTime,
        endTime: '',
        location: '',
        notes: '',
        visibility: prefs.defaultVisibility,
        sharedWithUserIds: [],
        destinations: [],
        confirmSensitive: false,
        reminders: prefs.defaultReminders,
        kind,
        amount: '',
        ...RECURRENCE_DEFAULTS,
        ...(kind === 'BILL' ? { repeat: 'MONTHLY' as const } : {}),
      };
      if (from) {
        const dup = await api.duplicateDraft(from);
        return {
          draft: {
            ...base,
            workspaceId:
              dup.workspaceId && writable.some((w) => w.id === dup.workspaceId)
                ? dup.workspaceId
                : ws,
            title: dup.title,
            category: dup.category,
            allDay: dup.allDay,
            date: dup.date,
            endDate: dup.endDate ?? '',
            startTime: dup.startTime ?? '09:00',
            endTime: dup.endTime ?? '',
            location: dup.location ?? '',
            notes: dup.notes ?? '',
            reminders: (dup.reminders as ReminderRuleDto[] | undefined) ?? base.reminders,
            kind: dup.kind ?? 'EVENT',
            amount: dup.bill?.amount ?? '',
            repeat: 'NONE' as const,
          },
          version: 0,
          creator: true,
          recurring: false,
        };
      }
      return { draft: base, version: 0, creator: true, recurring: false };
    },
    `${mode}|${id ?? ''}|${from ?? ''}|${params.get('kind') ?? ''}`,
  );
}

function Form({
  mode,
  id,
  initial,
  version,
  creator,
  recurring,
}: {
  mode: 'create' | 'edit';
  id: string | null;
  initial: Draft;
  version: number;
  /** Only the creator may change who can see an appointment (server rule). */
  creator: boolean;
  /** Editing an occurrence of a recurring series (asks for the scope before saving). */
  recurring: boolean;
}) {
  const { api, me, toast } = useApp();
  const navigate = useNavigate();
  const [d, setD] = useState<Draft>(initial);
  const [ws, setWs] = useState<WorkspaceDetailDto | null>(null);
  const [dests, setDests] = useState<DestinationOptionDto[] | null>(null);
  const [preview, setPreview] = useState<{
    data?: PreviewDto;
    error?: string;
    busy?: boolean;
  } | null>(null);
  const [estimate, setEstimate] = useState<EstimateDto | null>(null);
  const [run, saving, saveError] = useAction();
  const [askScope, setAskScope] = useState(false);
  const [scope, setScope] = useState<SeriesScope>('THIS');
  const key = useRef(newIdempotencyKey());
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  // Members and usable destinations of the chosen workspace (server-filtered).
  useEffect(() => {
    if (!d.workspaceId) return;
    let live = true;
    setWs(null);
    setDests(null);
    api.workspace(d.workspaceId).then(
      (w) => live && setWs(w),
      () => live && setWs(null),
    );
    api.destinations(d.workspaceId).then(
      (r) => live && setDests(r.items),
      () => live && setDests([]),
    );
    return () => {
      live = false;
    };
  }, [api, d.workspaceId]);

  const calc = useMemo(() => {
    try {
      return calculateReminders(
        {
          allDay: d.allDay,
          localDate: d.date,
          localTime: d.allDay ? null : d.startTime,
          timeZone: TZ,
        },
        d.reminders.map((r) => ({ ...r, enabled: r.enabled ?? true })),
        new Date(),
      );
    } catch {
      return null;
    }
  }, [d.allDay, d.date, d.startTime, d.reminders]);

  // Estimate (debounced) — local calculation by the server, never LINE-reported numbers.
  useEffect(() => {
    if (!d.title.trim() || !d.workspaceId) return;
    // Aborted on change or unmount, so no estimate request outlives the form (e.g. after Save).
    const ctl = new AbortController();
    const t = setTimeout(() => {
      api.estimate(toInput(d), ctl.signal).then(setEstimate, () => {
        if (!ctl.signal.aborted) setEstimate(null);
      });
    }, 500);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [api, d]);

  const writable = me.workspaces.filter((w) => w.role !== 'VIEWER');
  const groupSelected = d.destinations.some(
    (x) => dests?.find((o) => o.id === x.destinationId)?.kind === 'GROUP',
  );
  const fullToGroup = d.destinations.some(
    (x) =>
      x.contentPolicy === 'FULL' && dests?.find((o) => o.id === x.destinationId)?.kind === 'GROUP',
  );
  const needsSensitiveConfirm = fullToGroup && SENSITIVE.has(d.category);
  const code = errorCode(saveError);

  const toggleDest = (o: DestinationOptionDto) => {
    const on = d.destinations.some((x) => x.destinationId === o.id);
    set(
      'destinations',
      on
        ? d.destinations.filter((x) => x.destinationId !== o.id)
        : [
            ...d.destinations,
            { destinationId: o.id, contentPolicy: o.kind === 'GROUP' ? 'PRIVACY_SAFE' : 'FULL' },
          ],
    );
  };

  const rule = ruleOf(d);
  const nextDates = useMemo(() => {
    if (!rule) return [];
    try {
      return expandRecurrence(rule, d.date, { from: d.date, to: '2100-12-31', max: 4 }).map(
        (o) => o.date,
      );
    } catch {
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(rule), d.date]);
  const pastStart =
    !d.allDay && d.startTime && isPastLocalStart(new Date(), TZ, d.date, d.startTime);
  const amountInvalid =
    d.kind === 'BILL' && d.amount.trim() !== '' && normalizeAmount(d.amount) === null;

  const submit = async (chosen: SeriesScope = 'THIS') => {
    const input = toInput(d, mode === 'create' || chosen !== 'THIS');
    const r = await run(() =>
      mode === 'create'
        ? api.createAppointment(input, key.current)
        : api.updateAppointment(id as string, version, input, recurring ? chosen : 'THIS'),
    );
    if (!r) return;
    setAskScope(false);
    key.current = newIdempotencyKey();
    toast(mode === 'create' ? 'บันทึกแล้วค่ะ' : 'บันทึกการแก้ไขแล้วค่ะ');
    navigate(`/appointments/${r.appointment.id}`, { replace: true });
  };

  const showPreview = async (ruleIndex: number) => {
    setPreview({ busy: true });
    try {
      const first = d.destinations[0]?.destinationId ?? null;
      setPreview({ data: await api.preview(toInput(d), ruleIndex, first) });
    } catch (e) {
      setPreview({ error: errorText(e) });
    }
  };

  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        if (mode === 'edit' && recurring) setAskScope(true);
        else void submit();
      }}
      noValidate
    >
      <Field
        label="กลุ่ม"
        hint={
          ws
            ? `${KIND_TEXT[ws.workspace.kind]} · บทบาทของคุณ: ${ws.myRole === 'ADMIN' ? 'ผู้ดูแล' : 'สมาชิก'}`
            : undefined
        }
      >
        <select
          className="f-select"
          value={d.workspaceId}
          disabled={mode === 'edit'}
          onChange={(e) =>
            setD((x) => ({
              ...x,
              workspaceId: e.target.value,
              sharedWithUserIds: [],
              destinations: [],
            }))
          }
        >
          {writable.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </Field>

      {mode === 'create' ? (
        <fieldset className="fs">
          <legend className="f-label">ประเภท</legend>
          <Segmented<'EVENT' | 'BILL'>
            label="ประเภท"
            value={d.kind}
            onChange={(k) =>
              setD((x) => ({
                ...x,
                kind: k,
                ...(k === 'BILL' && x.repeat === 'NONE'
                  ? { repeat: 'MONTHLY' as const, allDay: true }
                  : {}),
              }))
            }
            options={[
              { value: 'EVENT', label: 'นัดหมาย' },
              { value: 'BILL', label: 'บิล / ค่าใช้จ่าย' },
            ]}
          />
        </fieldset>
      ) : null}

      <Field
        label={d.kind === 'BILL' ? 'ชื่อบิล' : 'ชื่อนัดหมาย'}
        error={code === 'VALIDATION_ERROR' && !d.title.trim() ? 'กรุณาใส่ชื่อ' : null}
      >
        <input
          className="f-input f-input--title"
          value={d.title}
          maxLength={120}
          required
          onChange={(e) => set('title', e.target.value)}
          placeholder={
            d.kind === 'BILL' ? 'เช่น ค่าไฟฟ้า, ค่าอินเทอร์เน็ต, ค่างวดรถ' : 'เช่น ไปหาหมอฟัน, ประชุมทีม'
          }
        />
      </Field>

      {d.kind === 'BILL' ? (
        <Field
          label="จำนวนเงิน (บาท, ไม่บังคับ)"
          hint="บิลที่ยอดไม่เท่ากันทุกเดือน แก้ยอดเฉพาะครั้งได้ภายหลัง · สถานะชำระเป็นข้อมูลที่ผู้ใช้แจ้งเอง"
          error={amountInvalid ? 'จำนวนเงินไม่ถูกต้อง (ทศนิยมได้ 2 ตำแหน่ง)' : null}
        >
          <input
            className="f-input f-num"
            inputMode="decimal"
            autoComplete="off"
            value={d.amount}
            maxLength={18}
            aria-invalid={amountInvalid}
            onChange={(e) => set('amount', e.target.value)}
            placeholder="เช่น 1,250.50"
          />
        </Field>
      ) : null}

      <fieldset className="fs">
        <legend className="f-label">หมวด</legend>
        <div className="chips">
          {CATEGORY_IDS.map((c) => (
            <button
              key={c}
              type="button"
              className="chip-cat"
              aria-pressed={d.category === c}
              onClick={() => set('category', c)}
            >
              <CategoryBadge category={c} solid={d.category === c} />
            </button>
          ))}
        </div>
      </fieldset>

      <Switch
        checked={d.allDay}
        onChange={(v) => set('allDay', v)}
        label={d.kind === 'BILL' ? 'ไม่ระบุเวลา (ครบกำหนดทั้งวัน)' : 'ทั้งวัน'}
      />
      {/* RD01: date on its own row, times share the next row; every cell may shrink. */}
      <div className={`dt-grid${d.allDay ? ' dt-grid--allday' : ''}`}>
        <Field label={d.kind === 'BILL' ? 'วันครบกำหนด' : 'วันที่'}>
          <input
            className="f-input"
            type="date"
            value={d.date}
            onChange={(e) => set('date', e.target.value)}
            required
          />
        </Field>
        {d.allDay ? (
          <Field label="ถึงวันที่ (ไม่บังคับ)">
            <input
              className="f-input"
              type="date"
              value={d.endDate}
              min={d.date}
              onChange={(e) => set('endDate', e.target.value)}
            />
          </Field>
        ) : (
          <>
            <Field label="เริ่ม">
              <input
                className="f-input"
                type="time"
                value={d.startTime}
                onChange={(e) => set('startTime', e.target.value)}
                required
              />
            </Field>
            <Field label="สิ้นสุด (ไม่บังคับ)">
              <input
                className="f-input"
                type="time"
                value={d.endTime}
                onChange={(e) => set('endTime', e.target.value)}
              />
            </Field>
          </>
        )}
      </div>
      {pastStart ? (
        <Notice tone="caution">
          เวลานี้ผ่านไปแล้ว — บันทึกย้อนหลังได้ แต่จะไม่มีการแจ้งเตือนสำหรับเวลาที่ผ่านไปแล้ว
        </Notice>
      ) : null}

      <fieldset className="fs">
        <legend className="f-label">ทำซ้ำ</legend>
        {mode === 'edit' && !recurring ? (
          <p className="f-hint">
            นัดหมายครั้งเดียวเปลี่ยนเป็นแบบทำซ้ำไม่ได้ — ใช้ “ทำซ้ำ” ในหน้ารายละเอียดเพื่อสร้างรายการใหม่
          </p>
        ) : (
          <>
            <select
              className="f-select"
              aria-label="ความถี่"
              value={d.repeat}
              onChange={(e) => set('repeat', e.target.value as Draft['repeat'])}
            >
              {mode === 'create' ? <option value="NONE">ครั้งเดียว</option> : null}
              <option value="DAILY">ทุกวัน</option>
              <option value="WEEKLY">ทุกสัปดาห์</option>
              <option value="MONTHLY">ทุกเดือน</option>
              <option value="YEARLY">ทุกปี</option>
            </select>
            {rule ? (
              <div className="repeat">
                <label className="repeat__row">
                  <span>ทุก</span>
                  <input
                    className="f-input repeat__num f-num"
                    type="number"
                    min={1}
                    max={99}
                    value={d.interval}
                    onChange={(e) => set('interval', Number(e.target.value))}
                    aria-label="ทุกกี่รอบ"
                  />
                  <span>
                    {{ DAILY: 'วัน', WEEKLY: 'สัปดาห์', MONTHLY: 'เดือน', YEARLY: 'ปี' }[rule.frequency]}
                  </span>
                </label>
                {rule.frequency === 'MONTHLY' ? (
                  <>
                    <Segmented<Draft['monthDayMode']>
                      label="วันในเดือน"
                      value={d.monthDayMode}
                      onChange={(v) => set('monthDayMode', v)}
                      options={[
                        { value: 'START', label: `วันที่ ${Number(d.date.slice(8))}` },
                        { value: 'DAY', label: 'เลือกวันที่' },
                        { value: 'LAST', label: 'วันสุดท้ายของเดือน' },
                      ]}
                    />
                    {d.monthDayMode === 'DAY' ? (
                      <input
                        className="f-input repeat__num f-num"
                        type="number"
                        min={1}
                        max={31}
                        aria-label="วันที่ของเดือน"
                        value={d.monthDay}
                        onChange={(e) => set('monthDay', Number(e.target.value))}
                      />
                    ) : null}
                  </>
                ) : null}
                {(rule.frequency === 'MONTHLY' &&
                  ((d.monthDayMode === 'DAY' && d.monthDay > 28) ||
                    (d.monthDayMode === 'START' && Number(d.date.slice(8)) > 28))) ||
                (rule.frequency === 'YEARLY' && d.date.slice(5) === '02-29') ? (
                  <Segmented<Draft['missingDay']>
                    label="เดือนหรือปีที่ไม่มีวันนี้"
                    value={d.missingDay}
                    onChange={(v) => set('missingDay', v)}
                    options={[
                      { value: 'LAST_DAY', label: 'ใช้วันสุดท้ายแทน' },
                      { value: 'SKIP', label: 'ข้ามครั้งนั้น' },
                    ]}
                  />
                ) : null}
                <Segmented<Draft['endType']>
                  label="สิ้นสุด"
                  value={d.endType}
                  onChange={(v) => set('endType', v)}
                  options={[
                    { value: 'NEVER', label: 'ไม่กำหนด' },
                    { value: 'UNTIL', label: 'ถึงวันที่' },
                    { value: 'COUNT', label: 'จำนวนครั้ง' },
                  ]}
                />
                {d.endType === 'UNTIL' ? (
                  <input
                    className="f-input"
                    type="date"
                    aria-label="สิ้นสุดวันที่"
                    min={d.date}
                    value={d.until}
                    onChange={(e) => set('until', e.target.value)}
                  />
                ) : null}
                {d.endType === 'COUNT' ? (
                  <input
                    className="f-input repeat__num f-num"
                    type="number"
                    min={1}
                    max={500}
                    aria-label="จำนวนครั้ง"
                    value={d.count}
                    onChange={(e) => set('count', Number(e.target.value))}
                  />
                ) : null}
                <p className="f-hint">
                  {describeRecurrenceThai(rule, d.date)}
                  {nextDates.length
                    ? ` · ครั้งถัดไป: ${nextDates.map((x) => formatThaiLocalDate(x).short).join(', ')}`
                    : ' · ไม่มีครั้งที่ตรงเงื่อนไข'}
                </p>
                <p className="f-hint">
                  FLOW สร้างรายการล่วงหน้าเป็นช่วง ๆ (เช่น 90 วันสำหรับทุกวัน, 2 ปีสำหรับทุกเดือน) และต่อให้อัตโนมัติ
                </p>
              </div>
            ) : null}
          </>
        )}
      </fieldset>

      <Field label="สถานที่ (ไม่บังคับ)">
        <input
          className="f-input"
          value={d.location}
          maxLength={160}
          onChange={(e) => set('location', e.target.value)}
        />
      </Field>
      <Field label="บันทึก (ไม่บังคับ)" hint="บันทึกไม่ถูกส่งไปในข้อความแจ้งเตือนใด ๆ">
        <textarea
          className="f-textarea"
          rows={3}
          maxLength={1000}
          value={d.notes}
          onChange={(e) => set('notes', e.target.value)}
        />
      </Field>

      <fieldset className="fs">
        <legend className="f-label">ใครเห็นนัดหมายนี้</legend>
        <Segmented<Visibility>
          label="การมองเห็น"
          value={d.visibility}
          onChange={(v) => creator && set('visibility', v)}
          options={(['PRIVATE', 'WORKSPACE', 'SELECTED'] as const).map((v) => ({
            value: v,
            label: VISIBILITY_TEXT[v].label,
          }))}
        />
        <p className="f-hint">
          {d.visibility === 'PRIVATE' ? (
            <Lock aria-hidden className="inline-icon" />
          ) : (
            <Users aria-hidden className="inline-icon" />
          )}{' '}
          {VISIBILITY_TEXT[d.visibility].hint} · เจ้าของระบบก็มองไม่เห็นนัดหมายส่วนตัวของคุณ
        </p>
        {!creator ? <p className="f-hint">เฉพาะผู้สร้างนัดหมายเปลี่ยนการมองเห็นได้</p> : null}
        {d.visibility === 'SELECTED' && creator ? (
          <div className="pick-list" role="group" aria-label="เลือกสมาชิก">
            {ws ? (
              ws.members
                .filter((m) => !m.me)
                .map((m) => {
                  const on = d.sharedWithUserIds.includes(m.userId);
                  return (
                    <label key={m.userId} className="pick">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          set(
                            'sharedWithUserIds',
                            on
                              ? d.sharedWithUserIds.filter((x) => x !== m.userId)
                              : [...d.sharedWithUserIds, m.userId],
                          )
                        }
                      />
                      <span className="f-name">{m.displayName}</span>
                    </label>
                  );
                })
            ) : (
              <p className="f-hint">กำลังโหลดสมาชิก…</p>
            )}
            {ws && ws.members.length <= 1 ? <p className="f-hint">ยังไม่มีสมาชิกคนอื่นในกลุ่มนี้</p> : null}
          </div>
        ) : null}
      </fieldset>

      <fieldset className="fs">
        <legend className="f-label">
          <Bell aria-hidden className="inline-icon" /> การแจ้งเตือน
        </legend>
        <ReminderEditor
          rules={d.reminders}
          onChange={(r) => set('reminders', r)}
          calc={calc}
          onPreview={showPreview}
        />
      </fieldset>

      <fieldset className="fs">
        <legend className="f-label">ส่งแจ้งเตือนไปที่</legend>
        {dests === null ? (
          <p className="f-hint">กำลังโหลดปลายทาง…</p>
        ) : dests.length === 0 ? (
          <p className="f-hint">ยังไม่มีปลายทางที่คุณใช้ได้ในกลุ่มนี้</p>
        ) : (
          <div className="dest-list">
            {dests.map((o) => {
              const sel = d.destinations.find((x) => x.destinationId === o.id);
              const broad =
                o.kind === 'GROUP' && (o.audienceSize === null || o.audienceSize >= BROAD_GROUP);
              return (
                <div key={o.id} className={`dest-opt${sel ? ' dest-opt--on' : ''}`}>
                  <label className="pick">
                    <input type="checkbox" checked={!!sel} onChange={() => toggleDest(o)} />
                    <span className="f-name">
                      {o.kind === 'PRIVATE_USER'
                        ? o.mine
                          ? 'แชตส่วนตัวของฉัน'
                          : `แชตส่วนตัว · ${o.label}`
                        : `กลุ่ม LINE · ${o.label}`}
                    </span>
                    {o.kind === 'GROUP' ? (
                      <span className="tag">
                        {o.audienceSize ? `~${o.audienceSize} คน` : 'ไม่ทราบจำนวนคน'}
                      </span>
                    ) : null}
                  </label>
                  {sel && o.kind === 'GROUP' ? (
                    <div className="dest-opt__policy">
                      <Segmented<Policy>
                        label="รายละเอียดในข้อความ"
                        value={sel.contentPolicy}
                        onChange={(p) =>
                          set(
                            'destinations',
                            d.destinations.map((x) =>
                              x.destinationId === o.id ? { ...x, contentPolicy: p } : x,
                            ),
                          )
                        }
                        options={[
                          { value: 'PRIVACY_SAFE', label: 'ไม่แสดงรายละเอียด' },
                          { value: 'FULL', label: 'แสดงชื่อและสถานที่' },
                        ]}
                      />
                      {broad ? (
                        <Notice tone="caution">
                          <TriangleAlert aria-hidden className="inline-icon" /> กลุ่มนี้มีคนจำนวนมาก
                          ทุกคนในกลุ่ม LINE จะเห็นข้อความแจ้งเตือน
                        </Notice>
                      ) : null}
                      {sel.contentPolicy === 'FULL' && d.visibility !== 'WORKSPACE' ? (
                        <Notice tone="block">
                          นัดหมายที่ไม่ได้เปิดให้ทั้งกลุ่มเห็น ส่งรายละเอียดเต็มไปยังกลุ่ม LINE ไม่ได้
                        </Notice>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
        {needsSensitiveConfirm ? (
          <label className="pick pick--warn">
            <input
              type="checkbox"
              checked={d.confirmSensitive}
              onChange={(e) => set('confirmSensitive', e.target.checked)}
            />
            <span>
              ฉันยืนยันว่าส่งชื่อนัดหมายหมวด “
              {d.category === 'health' ? 'สุขภาพ' : d.category === 'family' ? 'ครอบครัว' : 'ส่วนตัว'}”
              ไปยังกลุ่มได้
            </span>
          </label>
        ) : null}
        {groupSelected ? <p className="f-hint">ข้อความในกลุ่มไม่เคยมีบันทึกส่วนตัวของคุณ</p> : null}
        {estimate ? (
          <p className="f-hint f-num">
            ประมาณการ: {estimate.scheduledReminders} ครั้ง × ปลายทางที่เลือก ≈{' '}
            {estimate.estimate.totalKnown} ข้อความ
            {estimate.estimate.hasUnknownRecipients ? ' (บางกลุ่มยังไม่ทราบจำนวนคน)' : ''}
            {estimate.quotaKnown ? '' : ' · ยังไม่ได้ดึงโควตาจาก LINE — เป็นการประมาณเท่านั้น'}
          </p>
        ) : null}
      </fieldset>

      {preview ? (
        <div className="preview" role="region" aria-label="ตัวอย่างข้อความแจ้งเตือน">
          <div className="preview__head">
            <span>
              <Eye aria-hidden className="inline-icon" /> ตัวอย่างเท่านั้น — ไม่มีการส่งข้อความจริง
            </span>
            <button
              type="button"
              className="icon-btn"
              aria-label="ปิดตัวอย่าง"
              onClick={() => setPreview(null)}
            >
              <X aria-hidden />
            </button>
          </div>
          {preview.busy ? <p className="f-hint">กำลังสร้างตัวอย่าง…</p> : null}
          {preview.error ? <Notice tone="caution">{preview.error}</Notice> : null}
          {preview.data ? (
            <>
              <p className="f-hint f-num">
                เวลาแจ้งเตือนที่คำนวณไว้: {preview.data.fireAtLocal} · ตัวอย่างเท่านั้น ไม่มีการส่ง
              </p>
              <FlexBubble model={preview.data.model} />
              {preview.data.issues.length ? (
                <Notice tone="caution">
                  ตรวจพบปัญหาของรูปแบบข้อความ {preview.data.issues.length} รายการ
                </Notice>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      {saveError ? (
        <Notice tone={code === 'VERSION_CONFLICT' ? 'caution' : 'block'}>
          {errorText(saveError)}
          {code === 'VERSION_CONFLICT' && id ? (
            <>
              {' '}
              <button
                type="button"
                className="link-btn"
                onClick={() => navigate(`/appointments/${id}`)}
              >
                ดูข้อมูลล่าสุด
              </button>
            </>
          ) : null}
        </Notice>
      ) : null}
      <div className="form__actions">
        <Button
          type="submit"
          variant="create"
          size="lg"
          block
          busy={saving}
          disabled={
            !d.title.trim() ||
            !d.workspaceId ||
            amountInvalid ||
            (calc !== null && !calc.valid) ||
            (rule !== null && nextDates.length === 0)
          }
        >
          {mode === 'create' ? 'บันทึก' : 'บันทึกการแก้ไข'}
        </Button>
      </div>
      <Confirm
        open={askScope}
        title="บันทึกการแก้ไขรายการทำซ้ำ"
        confirmLabel="บันทึก"
        busy={saving}
        error={saveError ? errorText(saveError) : null}
        onClose={() => setAskScope(false)}
        onConfirm={() => void submit(scope)}
      >
        <ScopeChooser
          value={scope}
          onChange={setScope}
          verb="แก้ไข"
          extra={
            scope === 'THIS' ? (
              <p className="f-hint">
                การเปลี่ยนรูปแบบการทำซ้ำมีผลเฉพาะเมื่อเลือก “ครั้งนี้และครั้งถัดไป” หรือ “ทุกครั้ง”
              </p>
            ) : null
          }
        />
      </Confirm>
    </form>
  );
}

function ReminderEditor({
  rules,
  onChange,
  calc,
  onPreview,
}: {
  rules: ReminderRuleDto[];
  onChange: (r: ReminderRuleDto[]) => void;
  calc: ReturnType<typeof calculateReminders> | null;
  onPreview: (i: number) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [customTime, setCustomTime] = useState('07:00');
  const [customDay, setCustomDay] = useState(0);
  const add = (r: ReminderRuleDto) => {
    onChange([...rules, r]);
    setAdding(false);
  };
  // RD06: calculated times only — the label never implies a message is queued for delivery.
  const STATUS: Record<string, string> = {
    SCHEDULED: 'คำนวณแล้ว',
    PAST: 'เวลาผ่านไปแล้ว · จะไม่ส่ง',
    DISABLED: 'ปิดอยู่',
    DUPLICATE: 'ซ้ำกับรายการอื่น',
    CANCELLED: 'ยกเลิก',
  };
  const ISSUE: Record<string, string> = {
    'after-start': 'อยู่หลังเวลาเริ่มนัด',
    'invalid-time': 'เวลาไม่ถูกต้อง',
    'invalid-offset': 'ระยะเวลาไม่ถูกต้อง',
    'invalid-day-offset': 'วันไม่ถูกต้อง',
    'too-many': `ตั้งได้สูงสุด ${MAX_REMINDER_RULES} รายการ`,
  };
  return (
    <div className="rem">
      {rules.length === 0 ? <p className="f-hint">ไม่มีการแจ้งเตือน</p> : null}
      <ul className="rem__list">
        {rules.map((r, i) => {
          const c = calc?.reminders[i];
          const when = c?.fireAt ? fireText(c.fireAt.toISOString()) : '';
          const note = c?.issue ? ISSUE[c.issue] : c ? STATUS[c.status] : '';
          return (
            <li
              key={i}
              className={`rem__item${c && c.status !== 'SCHEDULED' ? ' rem__item--off' : ''}`}
            >
              <span className="rem__label">
                {reminderLabelTh({ ...r, enabled: r.enabled ?? true })}
              </span>
              <span className="rem__when f-num">
                {when}
                {note ? <span className="tag tag--muted">{note}</span> : null}
                {c?.sameTimeAs !== null && c?.sameTimeAs !== undefined ? (
                  <span className="tag tag--muted">เวลาเดียวกับอีกรายการ</span>
                ) : null}
              </span>
              <span className="rem__act">
                {c?.status === 'SCHEDULED' ? (
                  <button type="button" className="link-btn" onClick={() => onPreview(i)}>
                    ตัวอย่าง
                  </button>
                ) : null}
                <button
                  type="button"
                  className="icon-btn icon-btn--sm"
                  aria-label={`ลบ ${reminderLabelTh({ ...r, enabled: true })}`}
                  onClick={() => onChange(rules.filter((_, j) => j !== i))}
                >
                  <X aria-hidden />
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      {rules.length < MAX_REMINDER_RULES ? (
        adding ? (
          <div className="rem__add">
            <p className="f-label">เวลาตามปฏิทิน</p>
            <div className="chips">
              {CALENDAR_PRESETS.map((p) => (
                <button
                  key={`${p.dayOffset}${p.localTime}`}
                  type="button"
                  className="f-chip"
                  onClick={() =>
                    add({
                      kind: 'CALENDAR',
                      dayOffset: p.dayOffset,
                      localTime: p.localTime,
                      enabled: true,
                    })
                  }
                >
                  {reminderLabelTh({
                    kind: 'CALENDAR',
                    dayOffset: p.dayOffset,
                    localTime: p.localTime,
                    enabled: true,
                  })}
                </button>
              ))}
            </div>
            <div className="grid-3">
              <select
                className="f-select"
                aria-label="วัน"
                value={customDay}
                onChange={(e) => setCustomDay(Number(e.target.value))}
              >
                <option value={0}>วันนัด</option>
                <option value={-1}>1 วันก่อน</option>
                <option value={-2}>2 วันก่อน</option>
                <option value={-3}>3 วันก่อน</option>
                <option value={-7}>7 วันก่อน</option>
              </select>
              <input
                className="f-input"
                type="time"
                aria-label="เวลา"
                value={customTime}
                onChange={(e) => setCustomTime(e.target.value)}
              />
              <Button
                size="sm"
                icon={Plus}
                onClick={() =>
                  add({
                    kind: 'CALENDAR',
                    dayOffset: customDay,
                    localTime: customTime,
                    enabled: true,
                  })
                }
              >
                เพิ่ม
              </Button>
            </div>
            <p className="f-label">ก่อนเวลานัด</p>
            <div className="chips">
              {RELATIVE_PRESETS.map((m) => (
                <button
                  key={m}
                  type="button"
                  className="f-chip"
                  onClick={() => add({ kind: 'RELATIVE', offsetMinutes: m, enabled: true })}
                >
                  {reminderLabelTh({ kind: 'RELATIVE', offsetMinutes: m, enabled: true })}
                </button>
              ))}
            </div>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
              ปิด
            </Button>
          </div>
        ) : (
          <Button size="sm" icon={Plus} onClick={() => setAdding(true)}>
            เพิ่มการแจ้งเตือน
          </Button>
        )
      ) : (
        <p className="f-hint">ตั้งได้สูงสุด {MAX_REMINDER_RULES} รายการ</p>
      )}
    </div>
  );
}

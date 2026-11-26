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
  MAX_REMINDER_RULES,
  RELATIVE_PRESETS,
  reminderLabelTh,
  toLocalTimeString,
  type AppointmentDetailDto,
  type AppointmentInputDraft,
  type CategoryId,
  type DestinationOptionDto,
  type ReminderRuleDto,
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
import { Field, Loaded, Page, Segmented } from '../ui';

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
}

function toInput(d: Draft): AppointmentInputDraft {
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
  };
}

function fromDetail(a: AppointmentDetailDto): Draft {
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
        return { draft: fromDetail(a), version: a.version, creator: a.mine };
      }
      const prefs = me.preferences;
      const writable = me.workspaces.filter((w) => w.role !== 'VIEWER');
      const ws =
        writable.find((w) => w.id === prefs.defaultWorkspaceId)?.id ?? writable[0]?.id ?? '';
      const base: Draft = {
        workspaceId: ws,
        title: '',
        category: 'personal',
        allDay: false,
        date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayLocal(),
        endDate: '',
        startTime: '09:00',
        endTime: '',
        location: '',
        notes: '',
        visibility: prefs.defaultVisibility,
        sharedWithUserIds: [],
        destinations: [],
        confirmSensitive: false,
        reminders: prefs.defaultReminders,
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
          },
          version: 0,
          creator: true,
        };
      }
      return { draft: base, version: 0, creator: true };
    },
    `${mode}|${id ?? ''}|${from ?? ''}`,
  );
}

function Form({
  mode,
  id,
  initial,
  version,
  creator,
}: {
  mode: 'create' | 'edit';
  id: string | null;
  initial: Draft;
  version: number;
  /** Only the creator may change who can see an appointment (server rule). */
  creator: boolean;
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
    const t = setTimeout(() => {
      api.estimate(toInput(d)).then(setEstimate, () => setEstimate(null));
    }, 500);
    return () => clearTimeout(t);
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

  const submit = async () => {
    const input = toInput(d);
    const r = await run(() =>
      mode === 'create'
        ? api.createAppointment(input, key.current)
        : api.updateAppointment(id as string, version, input),
    );
    if (!r) return;
    key.current = newIdempotencyKey();
    toast(mode === 'create' ? 'บันทึกนัดหมายแล้วค่ะ' : 'บันทึกการแก้ไขแล้วค่ะ');
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
        void submit();
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

      <Field
        label="ชื่อนัดหมาย"
        error={code === 'VALIDATION_ERROR' && !d.title.trim() ? 'กรุณาใส่ชื่อนัดหมาย' : null}
      >
        <input
          className="f-input f-input--title"
          value={d.title}
          maxLength={120}
          required
          onChange={(e) => set('title', e.target.value)}
          placeholder="เช่น ไปหาหมอฟัน, ประชุมทีม"
        />
      </Field>

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

      <Switch checked={d.allDay} onChange={(v) => set('allDay', v)} label="ทั้งวัน" />
      <div className="grid-2">
        <Field label="วันที่">
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
              <p className="f-hint f-num">จะแจ้งเตือนเวลา {preview.data.fireAtLocal} น.</p>
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
          disabled={!d.title.trim() || !d.workspaceId || (calc !== null && !calc.valid)}
        >
          {mode === 'create' ? 'บันทึกนัดหมาย' : 'บันทึกการแก้ไข'}
        </Button>
      </div>
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
  const STATUS: Record<string, string> = {
    SCHEDULED: '',
    PAST: 'เลยเวลาแล้ว',
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
          const when = c?.fireAt
            ? `${c.fireAt.toLocaleDateString('th-TH', { timeZone: TZ, day: 'numeric', month: 'short' })} ${toLocalTimeString(c.fireAt, TZ)} น.`
            : '';
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

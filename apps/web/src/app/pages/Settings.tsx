import { useState } from 'react';
import { Link } from 'react-router';
import {
  CALENDAR_PRESETS,
  RELATIVE_PRESETS,
  reminderLabelTh,
  type PreferencesDto,
  type ReminderRuleDto,
} from '@flow/shared';
import {
  Bell,
  ChevronRight,
  Eye,
  History,
  Lock,
  LogOut,
  ShieldCheck,
  Users,
} from '../../components/icons';
import { Button, Notice } from '../../components/ui';
import { errorText, GLOBAL_ROLE_TEXT, useAction, useApp, VISIBILITY_TEXT } from '../core';
import { Confirm, Field, Page, Segmented } from '../ui';

function Row({
  to,
  icon: Icon,
  title,
  hint,
  badge,
}: {
  to: string;
  icon: typeof Bell;
  title: string;
  hint?: string;
  badge?: number;
}) {
  return (
    <Link to={to} className="row-card">
      <span className="row-card__icon" aria-hidden>
        <Icon />
      </span>
      <span className="row-card__body">
        <span className="row-card__title">{title}</span>
        {hint ? <span className="f-hint">{hint}</span> : null}
      </span>
      {badge ? <span className="dot">{badge}</span> : null}
      <ChevronRight aria-hidden />
    </Link>
  );
}

export function SettingsPage() {
  const { me, logout } = useApp();
  const [confirm, setConfirm] = useState(false);
  const pending = me.adminBadge ? me.adminBadge.pendingRequests + me.adminBadge.pendingGroups : 0;
  return (
    <Page title="ตั้งค่า">
      <div className="account">
        <p className="account__name f-name">{me.user.displayName}</p>
        <p className="f-hint">{GLOBAL_ROLE_TEXT[me.user.globalRole]} · ชื่อจากบัญชี LINE</p>
      </div>
      <div className="stack">
        {me.permissions.ownerConsole ? (
          <Row
            to="/owner"
            icon={ShieldCheck}
            title="คอนโซลเจ้าของระบบ"
            hint="อนุมัติผู้ใช้ เชิญ และจัดการกลุ่ม LINE"
            badge={pending}
          />
        ) : null}
        <Row
          to="/settings/preferences"
          icon={Bell}
          title="ค่าเริ่มต้นการสร้างนัด"
          hint="กลุ่ม การแจ้งเตือน และการมองเห็น"
        />
        <Row to="/groups" icon={Users} title="กลุ่มของฉัน" />
        <Row to="/history" icon={History} title="ประวัตินัดหมาย" />
        <Row to="/settings/privacy" icon={Lock} title="ความเป็นส่วนตัวของฉัน" hint="ใครเห็นอะไรได้บ้าง" />
        <Row to="/privacy" icon={Eye} title="นโยบายความเป็นส่วนตัว" />
        <Row to="/terms" icon={ShieldCheck} title="ข้อกำหนดการใช้งาน" />
      </div>
      <Button icon={LogOut} block onClick={() => setConfirm(true)}>
        ออกจากระบบ
      </Button>
      <p className="f-hint center">PDA BLISS FLOW · EP02 (ช่วงพัฒนา)</p>
      <Confirm
        open={confirm}
        title="ออกจากระบบ?"
        body={<p>เซสชันบนอุปกรณ์นี้จะสิ้นสุด สิทธิ์และกลุ่มของคุณยังอยู่ครบ</p>}
        confirmLabel="ออกจากระบบ"
        onClose={() => setConfirm(false)}
        onConfirm={logout}
      />
    </Page>
  );
}

const PRESET_RULES: ReminderRuleDto[] = [
  ...CALENDAR_PRESETS.map((p) => ({
    kind: 'CALENDAR' as const,
    dayOffset: p.dayOffset,
    localTime: p.localTime,
    enabled: true,
  })),
  ...RELATIVE_PRESETS.map((m) => ({ kind: 'RELATIVE' as const, offsetMinutes: m, enabled: true })),
];
const same = (a: ReminderRuleDto, b: ReminderRuleDto) =>
  a.kind === b.kind &&
  (a.kind === 'RELATIVE'
    ? a.offsetMinutes === (b as typeof a).offsetMinutes
    : a.dayOffset === (b as typeof a).dayOffset && a.localTime === (b as typeof a).localTime);

export function PreferencesPage() {
  const { api, me, reloadMe, toast } = useApp();
  const [p, setP] = useState<PreferencesDto>(me.preferences);
  const [run, busy, error] = useAction();
  const writable = me.workspaces.filter((w) => w.role !== 'VIEWER');
  return (
    <Page title="ค่าเริ่มต้นการสร้างนัด" back="/settings">
      <Field label="กลุ่มเริ่มต้น">
        <select
          className="f-select"
          value={p.defaultWorkspaceId ?? ''}
          onChange={(e) => setP({ ...p, defaultWorkspaceId: e.target.value || null })}
        >
          {writable.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </Field>
      <fieldset className="fs">
        <legend className="f-label">การแจ้งเตือนเริ่มต้น (สูงสุด 5)</legend>
        <div className="chips">
          {PRESET_RULES.map((r) => {
            const on = p.defaultReminders.some((x) => same(x, r));
            return (
              <button
                key={reminderLabelTh(r)}
                type="button"
                className="f-chip"
                aria-pressed={on}
                disabled={!on && p.defaultReminders.length >= 5}
                onClick={() =>
                  setP({
                    ...p,
                    defaultReminders: on
                      ? p.defaultReminders.filter((x) => !same(x, r))
                      : [...p.defaultReminders, r],
                  })
                }
              >
                {reminderLabelTh(r)}
              </button>
            );
          })}
        </div>
      </fieldset>
      <fieldset className="fs">
        <legend className="f-label">การมองเห็นเริ่มต้น</legend>
        <Segmented
          label="การมองเห็นเริ่มต้น"
          value={p.defaultVisibility}
          onChange={(v) => setP({ ...p, defaultVisibility: v })}
          options={(['PRIVATE', 'WORKSPACE', 'SELECTED'] as const).map((v) => ({
            value: v,
            label: VISIBILITY_TEXT[v].label,
          }))}
        />
      </fieldset>
      <fieldset className="fs">
        <legend className="f-label">รายละเอียดในข้อความถึงกลุ่ม LINE</legend>
        <Segmented
          label="รายละเอียดในข้อความ"
          value={p.defaultContentPolicy}
          onChange={(v) => setP({ ...p, defaultContentPolicy: v })}
          options={[
            { value: 'PRIVACY_SAFE', label: 'ไม่แสดงรายละเอียด' },
            { value: 'FULL', label: 'แสดงชื่อและสถานที่' },
          ]}
        />
      </fieldset>
      {error ? <Notice tone="caution">{errorText(error)}</Notice> : null}
      <Button
        variant="dark"
        block
        busy={busy}
        onClick={async () => {
          if (await run(() => api.savePreferences(p))) {
            await reloadMe();
            toast('บันทึกค่าเริ่มต้นแล้ว');
          }
        }}
      >
        บันทึก
      </Button>
    </Page>
  );
}

export function PrivacySettingsPage() {
  return (
    <Page title="ความเป็นส่วนตัวของฉัน" back="/settings">
      <div className="prose">
        <h2>สามเรื่องที่แยกจากกัน</h2>
        <p>
          <strong>1. กลุ่ม</strong> — คุณเห็นเฉพาะกลุ่มที่คุณเป็นสมาชิก การเป็นสมาชิกไม่ได้แปลว่าเห็นทุกนัด
        </p>
        <p>
          <strong>2. การมองเห็นนัดหมาย</strong> — “เฉพาะฉัน” เห็นได้เฉพาะคุณ (ผู้ดูแลกลุ่มและเจ้าของระบบก็ไม่เห็น)
          · “ทุกคนในกลุ่ม” สมาชิกกลุ่มนั้นเห็น · “เลือกคน” เฉพาะคนที่คุณเลือก
        </p>
        <p>
          <strong>3. ปลายทางแจ้งเตือน</strong> — ทุกคนในกลุ่ม LINE เห็นข้อความที่ส่งเข้ากลุ่ม
          นัดส่วนตัวจึงส่งเข้ากลุ่มได้แบบ “ไม่แสดงรายละเอียด” เท่านั้น และบันทึกส่วนตัวไม่ถูกส่งไปที่ใดเลย
        </p>
        <h2>สิ่งที่ FLOW เก็บ</h2>
        <p>
          ชื่อที่แสดงจาก LINE, กลุ่มและบทบาท, นัดหมายที่คุณสร้าง และประวัติการเปลี่ยนแปลงที่จำเป็น FLOW ไม่เก็บอีเมล
          เบอร์โทร หรือรหัสผ่าน
        </p>
        <h2>บันทึกการตรวจสอบ</h2>
        <p>เจ้าของระบบเห็นว่ามีการเปลี่ยนแปลงอะไรเมื่อไร แต่ไม่เห็นชื่อหรือรายละเอียดของนัดหมาย</p>
      </div>
    </Page>
  );
}

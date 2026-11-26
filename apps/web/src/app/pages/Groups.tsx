import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  Archive,
  ChevronRight,
  LogOut,
  MessageCircle,
  PencilLine,
  Plus,
  UserPlus,
  Users,
} from '../../components/icons';
import { Button, Notice } from '../../components/ui';
import type { Role, WorkspaceDetailDto } from '../api';
import { errorText, KIND_TEXT, ROLE_TEXT, useAction, useApp, useLoad } from '../core';
import { Confirm, Empty, Field, Loaded, Page, Segmented } from '../ui';

type Kind = 'FAMILY' | 'COMPANY' | 'CUSTOM';
const KINDS: { value: Kind; label: string }[] = [
  { value: 'FAMILY', label: KIND_TEXT.FAMILY },
  { value: 'COMPANY', label: KIND_TEXT.COMPANY },
  { value: 'CUSTOM', label: KIND_TEXT.CUSTOM },
];

export function GroupsPage() {
  const { api, reloadMe, toast } = useApp();
  const navigate = useNavigate();
  const load = useLoad(() => api.workspaces(), 'workspaces');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Kind>('FAMILY');
  const [run, busy, error] = useAction();
  return (
    <Page
      title="กลุ่มของฉัน"
      actions={
        <Button size="sm" icon={Plus} onClick={() => setCreating(true)}>
          สร้างกลุ่ม
        </Button>
      }
    >
      <p className="f-hint">
        กลุ่มแยกนัดหมายของครอบครัว บริษัท และเรื่องส่วนตัวออกจากกัน สมาชิกเห็นเฉพาะนัดที่เปิดให้กลุ่มเห็น
      </p>
      <Loaded load={load}>
        {(d) =>
          d.items.length ? (
            <div className="stack">
              {d.items.map((w) => (
                <Link key={w.id} to={`/groups/${w.id}`} className="row-card">
                  <span className="row-card__icon" aria-hidden>
                    <Users />
                  </span>
                  <span className="row-card__body">
                    <span className="f-name row-card__title">{w.name}</span>
                    <span className="f-hint">
                      {KIND_TEXT[w.kind]} · {ROLE_TEXT[w.role]} · สมาชิก {w.memberCount} คน
                    </span>
                  </span>
                  <ChevronRight aria-hidden />
                </Link>
              ))}
            </div>
          ) : (
            <Empty title="ยังไม่มีกลุ่ม" />
          )
        }
      </Loaded>
      <Confirm
        open={creating}
        title="สร้างกลุ่มใหม่"
        confirmLabel="สร้างกลุ่ม"
        busy={busy}
        error={error ? errorText(error) : null}
        onClose={() => setCreating(false)}
        onConfirm={async () => {
          const ws = await run(() => api.createWorkspace(name.trim(), kind));
          if (!ws) return;
          setCreating(false);
          setName('');
          await reloadMe();
          toast('สร้างกลุ่มแล้ว');
          navigate(`/groups/${ws.id}`);
        }}
      >
        <Field label="ชื่อกลุ่ม">
          <input
            className="f-input"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            placeholder="เช่น บ้านเรา, ทีมขาย"
          />
        </Field>
        <Segmented label="ประเภทกลุ่ม" value={kind} onChange={setKind} options={KINDS} />
        <p className="f-hint">คุณจะเป็นผู้ดูแลของกลุ่มนี้</p>
      </Confirm>
    </Page>
  );
}

type Dialog =
  | { kind: 'rename' }
  | { kind: 'add' }
  | { kind: 'role'; userId: string; name: string; role: Role }
  | { kind: 'remove'; userId: string; name: string }
  | { kind: 'leave' }
  | { kind: 'archive' }
  | null;

export function GroupDetailPage() {
  const { id = '' } = useParams();
  const { api, reloadMe, toast } = useApp();
  const navigate = useNavigate();
  const load = useLoad(() => api.workspace(id), `ws|${id}`);
  const [dialog, setDialog] = useState<Dialog>(null);
  return (
    <Page title="กลุ่ม" back="/groups">
      <Loaded load={load}>
        {(w) => (
          <GroupBody
            w={w}
            dialog={dialog}
            setDialog={setDialog}
            done={async (msg, leave) => {
              setDialog(null);
              toast(msg);
              await reloadMe();
              if (leave) navigate('/groups', { replace: true });
              else load.reload();
            }}
            api={api}
          />
        )}
      </Loaded>
    </Page>
  );
}

function GroupBody({
  w,
  dialog,
  setDialog,
  done,
  api,
}: {
  w: WorkspaceDetailDto;
  dialog: Dialog;
  setDialog: (d: Dialog) => void;
  done: (msg: string, leave?: boolean) => Promise<void>;
  api: ReturnType<typeof useApp>['api'];
}) {
  const [run, busy, error] = useAction();
  const [name, setName] = useState(w.workspace.name);
  const [role, setRole] = useState<Role>('MEMBER');
  const [pick, setPick] = useState('');
  const candidates = useLoad(
    () => (w.can.manageMembers ? api.candidates(w.workspace.id) : Promise.resolve({ items: [] })),
    `cand|${w.workspace.id}|${dialog?.kind === 'add'}`,
  );
  const personal = w.workspace.kind === 'PERSONAL';
  const close = () => setDialog(null);
  const err = error ? errorText(error) : null;
  return (
    <>
      <div className="group-head">
        <h2 className="f-name">{w.workspace.name}</h2>
        <p className="f-hint">
          {KIND_TEXT[w.workspace.kind]} · บทบาทของคุณ: {ROLE_TEXT[w.myRole]}
        </p>
        {w.can.edit && !personal ? (
          <Button size="sm" icon={PencilLine} onClick={() => setDialog({ kind: 'rename' })}>
            เปลี่ยนชื่อ
          </Button>
        ) : null}
      </div>
      {personal ? (
        <Notice tone="info">กลุ่มส่วนตัวมีเพียงคุณคนเดียว นัดหมายในนี้ไม่มีใครเห็นนอกจากคุณ</Notice>
      ) : null}

      <h3 className="section-title">สมาชิก ({w.members.length})</h3>
      <ul className="member-list">
        {w.members.map((m) => (
          <li key={m.userId}>
            <span className="f-name member-list__name">
              {m.displayName}
              {m.me ? ' (คุณ)' : ''}
            </span>
            <span className="tag">{ROLE_TEXT[m.role]}</span>
            {w.can.manageMembers && !m.me ? (
              <span className="member-list__act">
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setRole(m.role);
                    setDialog({
                      kind: 'role',
                      userId: m.userId,
                      name: m.displayName,
                      role: m.role,
                    });
                  }}
                >
                  เปลี่ยนบทบาท
                </button>
                <button
                  type="button"
                  className="link-btn link-btn--danger"
                  onClick={() =>
                    setDialog({ kind: 'remove', userId: m.userId, name: m.displayName })
                  }
                >
                  นำออก
                </button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {w.can.manageMembers ? (
        <Button icon={UserPlus} onClick={() => setDialog({ kind: 'add' })}>
          เพิ่มสมาชิก
        </Button>
      ) : null}

      {w.destinations.length ? (
        <>
          <h3 className="section-title">
            <MessageCircle aria-hidden className="inline-icon" /> กลุ่ม LINE ที่เชื่อมไว้
          </h3>
          <ul className="member-list">
            {w.destinations.map((d) => (
              <li key={d.id}>
                <span className="f-name member-list__name">{d.label}</span>
                <span className="tag">{d.status === 'ACTIVE' ? 'ใช้งาน' : 'ปิดอยู่'}</span>
              </li>
            ))}
          </ul>
          <p className="f-hint">การเชื่อมกลุ่ม LINE ทำโดยเจ้าของระบบในคอนโซล</p>
        </>
      ) : null}

      <div className="danger-zone">
        {w.can.leave && !personal ? (
          <Button icon={LogOut} onClick={() => setDialog({ kind: 'leave' })}>
            ออกจากกลุ่ม
          </Button>
        ) : null}
        {w.can.archive && !personal ? (
          <Button variant="danger" icon={Archive} onClick={() => setDialog({ kind: 'archive' })}>
            เก็บกลุ่มถาวร
          </Button>
        ) : null}
      </div>

      <Confirm
        open={dialog?.kind === 'rename'}
        title="เปลี่ยนชื่อกลุ่ม"
        confirmLabel="บันทึก"
        busy={busy}
        error={err}
        onClose={close}
        onConfirm={async () => {
          if (
            await run(() =>
              api.updateWorkspace(w.workspace.id, w.workspace.version, { name: name.trim() }),
            )
          )
            await done('เปลี่ยนชื่อแล้ว');
        }}
      >
        <Field label="ชื่อกลุ่ม">
          <input
            className="f-input"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
      </Confirm>

      <Confirm
        open={dialog?.kind === 'add'}
        title="เพิ่มสมาชิก"
        body={<p>เลือกจากผู้ใช้ที่ได้รับอนุมัติแล้ว · ผู้ใช้ใหม่ให้เจ้าของระบบส่งลิงก์เชิญ</p>}
        confirmLabel="เพิ่ม"
        busy={busy}
        error={err}
        onClose={close}
        onConfirm={async () => {
          if (!pick) return;
          if (await run(() => api.addMember(w.workspace.id, pick, role))) {
            setPick('');
            await done('เพิ่มสมาชิกแล้ว');
          }
        }}
      >
        <Field label="ผู้ใช้">
          <select className="f-select" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">— เลือก —</option>
            {(candidates.data?.items ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}
              </option>
            ))}
          </select>
        </Field>
        <RolePicker value={role} onChange={setRole} />
      </Confirm>

      <Confirm
        open={dialog?.kind === 'role'}
        title={dialog?.kind === 'role' ? `บทบาทของ ${dialog.name}` : ''}
        confirmLabel="บันทึกบทบาท"
        busy={busy}
        error={err}
        onClose={close}
        onConfirm={async () => {
          if (dialog?.kind !== 'role') return;
          if (await run(() => api.changeMemberRole(w.workspace.id, dialog.userId, role)))
            await done('เปลี่ยนบทบาทแล้ว');
        }}
      >
        <RolePicker value={role} onChange={setRole} />
      </Confirm>

      <Confirm
        open={dialog?.kind === 'remove'}
        title="นำสมาชิกออก?"
        body={
          dialog?.kind === 'remove' ? (
            <p>
              <span className="f-name">{dialog.name}</span> จะไม่เห็นนัดหมายของกลุ่มนี้อีกทันที
            </p>
          ) : null
        }
        confirmLabel="นำออก"
        danger
        busy={busy}
        error={err}
        onClose={close}
        onConfirm={async () => {
          if (dialog?.kind !== 'remove') return;
          if (await run(() => api.removeMember(w.workspace.id, dialog.userId)))
            await done('นำสมาชิกออกแล้ว');
        }}
      />

      <Confirm
        open={dialog?.kind === 'leave'}
        title="ออกจากกลุ่มนี้?"
        body={<p>คุณจะไม่เห็นนัดหมายของกลุ่มนี้อีก จนกว่าผู้ดูแลจะเพิ่มคุณกลับ</p>}
        confirmLabel="ออกจากกลุ่ม"
        danger
        busy={busy}
        error={err}
        onClose={close}
        onConfirm={async () => {
          if (await run(() => api.leaveWorkspace(w.workspace.id))) await done('ออกจากกลุ่มแล้ว', true);
        }}
      />

      <Confirm
        open={dialog?.kind === 'archive'}
        title="เก็บกลุ่มนี้ถาวร?"
        body={
          <p>สมาชิกทุกคนจะไม่เห็นกลุ่มและนัดหมายของกลุ่มนี้อีก ข้อมูลไม่ถูกลบ แต่ไม่สามารถเปิดกลับได้เองในเวอร์ชันนี้</p>
        }
        confirmLabel="เก็บกลุ่ม"
        danger
        busy={busy}
        error={err}
        onClose={close}
        onConfirm={async () => {
          if (await run(() => api.archiveWorkspace(w.workspace.id, w.workspace.version)))
            await done('เก็บกลุ่มแล้ว', true);
        }}
      />
    </>
  );
}

function RolePicker({ value, onChange }: { value: Role; onChange: (r: Role) => void }) {
  return (
    <fieldset className="fs">
      <legend className="f-label">บทบาท</legend>
      <Segmented
        label="บทบาท"
        value={value}
        onChange={onChange}
        options={[
          { value: 'ADMIN', label: ROLE_TEXT.ADMIN },
          { value: 'MEMBER', label: ROLE_TEXT.MEMBER },
          { value: 'VIEWER', label: ROLE_TEXT.VIEWER },
        ]}
      />
      <p className="f-hint">
        {value === 'ADMIN'
          ? 'จัดการสมาชิก แก้ไขนัดที่เปิดให้กลุ่มเห็น และส่งแจ้งเตือนเข้ากลุ่ม LINE ได้'
          : value === 'MEMBER'
            ? 'สร้างนัดหมายและเห็นนัดที่เปิดให้กลุ่มเห็น'
            : 'ดูนัดที่เปิดให้กลุ่มเห็นได้อย่างเดียว'}
      </p>
    </fieldset>
  );
}

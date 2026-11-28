/**
 * Workspaces, roles/permissions, invitations, LINE groups and the security audit. The
 * invitation, LINE-group and audit panels are the existing Owner Console components (same
 * endpoints, same server rules) embedded in the desktop layout.
 */
import { Link, useParams } from 'react-router';
import { Notice } from '../../components/ui';
import { GLOBAL_ROLE_TEXT, KIND_TEXT, ROLE_TEXT, STATUS_TEXT, useApp, useLoad } from '../core';
import { fireText, MemberMark } from '../extras';
import { Audit, Invitations, LineGroups } from '../pages/owner/OwnerConsole';
import { AdminPage, ErrorBox } from './AdminCenter';

export function WorkspacesPage() {
  const { api } = useApp();
  const load = useLoad(() => api.adminWorkspaces(), 'adm-workspaces');
  return (
    <AdminPage
      title="กลุ่มงาน"
      intro="กลุ่มครอบครัว บริษัท และกลุ่มอื่น ๆ — พื้นที่ส่วนตัวของผู้ใช้นับรวมไว้แต่เปิดดูจากที่นี่ไม่ได้ และการเป็นผู้ดูแลระบบไม่ได้ทำให้เห็นนัดหมายในกลุ่ม"
    >
      {load.state === 'error' && !load.data ? (
        <ErrorBox error={load.error} onRetry={load.reload} />
      ) : !load.data ? (
        <p aria-busy="true">กำลังโหลด…</p>
      ) : (
        <>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <caption className="sr-only">กลุ่มงาน</caption>
              <thead>
                <tr>
                  <th scope="col">ชื่อกลุ่ม</th>
                  <th scope="col">ประเภท</th>
                  <th scope="col">สมาชิก</th>
                  <th scope="col">ผู้ดูแล / สมาชิก / ดูอย่างเดียว</th>
                  <th scope="col">สร้างเมื่อ</th>
                </tr>
              </thead>
              <tbody>
                {load.data.items.map((w) => (
                  <tr key={w.id}>
                    <td>
                      <Link to={`/admin/workspaces/${w.id}`} className="adm-link f-name">
                        {w.name}
                      </Link>
                    </td>
                    <td>{KIND_TEXT[w.kind]}</td>
                    <td className="f-num">
                      <Link to={`/admin/users?workspaceId=${w.id}`} className="adm-link">
                        {w.memberCount} คน
                      </Link>
                    </td>
                    <td className="f-num">
                      {w.roles ? `${w.roles.ADMIN} / ${w.roles.MEMBER} / ${w.roles.VIEWER}` : '—'}
                    </td>
                    <td className="f-num">{w.createdAt ? fireText(w.createdAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {load.data.items.length === 0 ? <p className="adm-empty">ยังไม่มีกลุ่มงานที่ใช้ร่วมกัน</p> : null}
          {typeof load.data.personalCount === 'number' ? (
            <p className="adm-fine">
              พื้นที่ส่วนตัวของผู้ใช้: {load.data.personalCount} พื้นที่ (ไม่แสดงรายละเอียด)
            </p>
          ) : null}
          <Notice tone="info">
            สร้างกลุ่มใหม่ได้จากหน้า “กลุ่ม” ในแอป FLOW โดยผู้สร้างเป็นผู้ดูแลกลุ่มนั้น —
            ผู้ดูแลระบบกำหนดสมาชิกให้ผู้ใช้ได้ที่หน้ารายละเอียดผู้ใช้หรือขณะอนุมัติคำขอ
          </Notice>
        </>
      )}
    </AdminPage>
  );
}

export function WorkspaceDetailPage() {
  const { id = '' } = useParams();
  const { api } = useApp();
  const load = useLoad(() => api.adminWorkspace(id), `adm-workspace|${id}`);
  if (load.state === 'error' && !load.data)
    return <ErrorBox error={load.error} onRetry={load.reload} />;
  if (!load.data) return <p aria-busy="true">กำลังโหลด…</p>;
  const d = load.data;
  return (
    <AdminPage
      title={d.workspace.name}
      intro={`${KIND_TEXT[d.workspace.kind]} · สร้างเมื่อ ${fireText(d.workspace.createdAt)} · ข้อมูลสมาชิกและสิทธิ์เท่านั้น ไม่มีเนื้อหานัดหมาย`}
    >
      <section className="adm-card">
        <h2 className="adm-card__title">สมาชิก ({d.members.length})</h2>
        <div className="adm-table-wrap">
          <table className="adm-table">
            <caption className="sr-only">สมาชิกของกลุ่ม</caption>
            <thead>
              <tr>
                <th scope="col">สมาชิก</th>
                <th scope="col">บทบาทในกลุ่ม</th>
                <th scope="col">สถานะบัญชี</th>
                <th scope="col">บทบาทระบบ</th>
                <th scope="col">อยู่ในกลุ่มตั้งแต่</th>
              </tr>
            </thead>
            <tbody>
              {d.members.map((m) => (
                <tr key={m.userId}>
                  <td>
                    <Link to={`/admin/users/${m.userId}`} className="adm-link">
                      <MemberMark name={m.displayName} color={m.color} />
                    </Link>
                  </td>
                  <td>{ROLE_TEXT[m.role]}</td>
                  <td>{STATUS_TEXT[m.status]}</td>
                  <td>{GLOBAL_ROLE_TEXT[m.globalRole]}</td>
                  <td className="f-num">{fireText(m.since)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="adm-fine">สีประจำตัวเลือกโดยสมาชิกแต่ละคนสำหรับกลุ่มนี้ และแสดงคู่กับชื่อเสมอ</p>
      </section>
      <div className="adm-grid-2">
        <section className="adm-card">
          <h2 className="adm-card__title">กลุ่ม LINE ที่ผูกไว้</h2>
          {d.groups.length ? (
            <ul className="adm-list">
              {d.groups.map((g) => (
                <li key={g.id}>
                  <span className="f-name">{g.label}</span>
                  <span className="tag">{g.status}</span>
                  <span className="f-hint">
                    {g.audienceSize ? `~${g.audienceSize} คน` : 'ไม่ทราบจำนวนคน'}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="f-hint">ยังไม่มีกลุ่ม LINE ที่ผูกกับกลุ่มงานนี้</p>
          )}
        </section>
        <section className="adm-card">
          <h2 className="adm-card__title">ลิงก์เชิญ</h2>
          <p className="f-num">
            ใช้ได้อยู่ {d.invitations.active} จาก {d.invitations.total} ลิงก์
          </p>
          <Link className="f-btn" to="/admin/invitations">
            จัดการลิงก์เชิญ
          </Link>
        </section>
      </div>
    </AdminPage>
  );
}

const MATRIX: [string, string, string, string][] = [
  ['เปิดศูนย์ผู้ดูแลระบบ เห็นจำนวนคำขอ', '✓', '✓', '–'],
  ['อนุมัติ / ไม่อนุมัติคำขอ', '✓', '✓', '–'],
  ['ระงับ คืนสิทธิ์ เพิกถอน เปิดใช้งานอีกครั้ง', '✓', 'เฉพาะผู้ใช้ทั่วไป', '–'],
  ['กำหนดกลุ่มงานให้ผู้ใช้', '✓', 'เฉพาะผู้ใช้ทั่วไป', '–'],
  ['สร้าง / ยกเลิกลิงก์เชิญ', '✓', '✓', '–'],
  ['เปลี่ยนบทบาทระบบ (ผู้ดูแล ↔ ผู้ใช้)', '✓', '–', '–'],
  ['จัดการกลุ่ม LINE, โควตา, เพื่อน LINE, กิจกรรม, สถานะระบบ', '✓', '–', '–'],
  ['อ่านเนื้อหานัดหมายของผู้อื่น', '–', '–', '–'],
];

export function PermissionsPage() {
  return (
    <AdminPage
      title="บทบาทและสิทธิ์"
      intro="สามมิติแยกจากกันเสมอ: สิทธิ์ในกลุ่มงาน, การมองเห็นนัดหมาย และสิทธิ์ส่งแจ้งเตือนไปปลายทาง LINE — มิติหนึ่งไม่ได้ให้สิทธิ์อีกมิติ เซิร์ฟเวอร์ตรวจทุกคำขอ"
    >
      <section className="adm-card">
        <h2 className="adm-card__title">บทบาทระบบ</h2>
        <div className="adm-table-wrap">
          <table className="adm-table adm-table--matrix">
            <thead>
              <tr>
                <th scope="col">การดำเนินการ</th>
                <th scope="col">เจ้าของระบบ</th>
                <th scope="col">ผู้ดูแลระบบ</th>
                <th scope="col">ผู้ใช้</th>
              </tr>
            </thead>
            <tbody>
              {MATRIX.map((r) => (
                <tr key={r[0]}>
                  <th scope="row">{r[0]}</th>
                  <td>{r[1]}</td>
                  <td>{r[2]}</td>
                  <td>{r[3]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="adm-fine">
          เจ้าของระบบมอบให้ผ่าน API หรือลิงก์เชิญไม่ได้ · ทำกับบัญชีตัวเองไม่ได้ · เจ้าของคนสุดท้ายระงับไม่ได้ ·
          การเปลี่ยนสถานะ บทบาท และการนำออกจากกลุ่มต้องยืนยันตัวตนกับ LINE ภายใน 15 นาทีล่าสุด
        </p>
      </section>
      <section className="adm-card">
        <h2 className="adm-card__title">บทบาทในกลุ่มงาน</h2>
        <ul className="adm-list adm-list--plain">
          <li>
            <strong>ผู้ดูแลกลุ่ม</strong> — เห็นนัดที่เปิดให้ทั้งกลุ่ม สร้าง แก้ไขนัดของกลุ่ม จัดการสมาชิก ใช้กลุ่ม LINE
            ของกลุ่มเป็นปลายทาง
          </li>
          <li>
            <strong>สมาชิก</strong> — เห็นนัดที่เปิดให้ทั้งกลุ่ม สร้างและแก้ไขนัดของตัวเอง
          </li>
          <li>
            <strong>ดูอย่างเดียว</strong> — เห็นนัดที่เปิดให้ทั้งกลุ่ม แก้ไขอะไรไม่ได้
          </li>
          <li>นัดหมาย “เฉพาะฉัน” ไม่มีใครเห็นนอกจากผู้สร้าง — รวมถึงผู้ดูแลกลุ่มและเจ้าของระบบ</li>
        </ul>
      </section>
    </AdminPage>
  );
}

export function InvitationsPage() {
  return (
    <AdminPage
      title="ลิงก์เชิญ"
      intro="ลิงก์ใช้ได้ครั้งเดียว มีวันหมดอายุ ให้บทบาทในกลุ่มงานเท่านั้น (ไม่ให้บทบาทระบบ) และผู้ใช้ยังต้องได้รับการอนุมัติ — ลิงก์แสดงครั้งเดียวตอนสร้าง"
    >
      <div className="adm-embed">
        <Invitations />
      </div>
    </AdminPage>
  );
}

export function GroupsPage() {
  return (
    <AdminPage
      title="กลุ่ม LINE"
      intro="กลุ่มที่ Sally ถูกเชิญเข้าจะรอการลงทะเบียน — การเป็นสมาชิกกลุ่ม LINE ไม่ได้ให้สิทธิ์ใช้ FLOW และไม่มีการส่งข้อความทดสอบไปกลุ่มที่ยังไม่อนุมัติ"
    >
      <Notice tone="caution">
        ทุกคนในกลุ่ม LINE อ่านข้อความที่ส่งไปกลุ่มได้ — นัดหมายส่วนตัวหรือที่เลือกคนเห็น
        ส่งไปกลุ่มได้เฉพาะแบบไม่แสดงรายละเอียด · การรับเหตุการณ์เข้า/ออกกลุ่มแบบสมบูรณ์และการส่งจริงอยู่ใน EP03
      </Notice>
      <div className="adm-embed">
        <LineGroups />
      </div>
    </AdminPage>
  );
}

export function AuditPage() {
  return (
    <AdminPage
      title="บันทึกความปลอดภัย"
      intro="การกระทำที่มีสิทธิ์พิเศษทั้งหมดพร้อมผู้กระทำและเวลา — รายการของนัดหมาย รายการทำซ้ำ และบิล แสดงเฉพาะประเภทการกระทำ ไม่มีชื่อ เนื้อหา หรือจำนวนเงิน"
    >
      <div className="adm-embed">
        <Audit />
      </div>
    </AdminPage>
  );
}

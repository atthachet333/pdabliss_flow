/**
 * Interactive dashboard: every card is a real link (keyboard and touch) to an authorized
 * detail route with its filter in the URL, so back/forward and direct links work. Unknown or
 * not-yet-enabled metrics say so — they are never shown as zero.
 */
import { Link } from 'react-router';
import type { AdminMetricKey, MetricDto } from '@flow/shared';
import {
  Activity,
  Bell,
  Building2,
  Gauge,
  HeartPulse,
  Inbox,
  MessageCircle,
  ScrollText,
  UserCheck,
  UserRound,
  UserX,
  Users,
} from '../../components/icons';
import type { LucideIcon } from '../../components/icons';
import { Skeleton } from '../../components/ui';
import { fireText } from '../extras';
import { useApp, useLoad } from '../core';
import { AdminPage, ErrorBox } from './AdminCenter';

const CARDS: { key: AdminMetricKey; label: string; icon: LucideIcon; hint?: string }[] = [
  { key: 'requestsPending', label: 'คำขอรออนุมัติ', icon: Inbox },
  { key: 'usersTotal', label: 'ผู้ใช้ FLOW ทั้งหมด', icon: UserRound },
  { key: 'usersActive', label: 'ใช้งานได้', icon: UserCheck },
  { key: 'usersRestricted', label: 'ระงับ / เพิกถอน', icon: UserX },
  { key: 'workspaces', label: 'กลุ่มงานที่ใช้งาน', icon: Building2 },
  { key: 'groupsPending', label: 'กลุ่ม LINE รอลงทะเบียน', icon: MessageCircle },
  { key: 'groupsRegistered', label: 'กลุ่ม LINE ที่ลงทะเบียน', icon: MessageCircle },
  { key: 'remindersCalculated', label: 'เวลาแจ้งเตือนที่คำนวณไว้ (7 วัน)', icon: Activity },
  { key: 'notificationFailures', label: 'การส่งที่ล้มเหลว', icon: Bell },
  { key: 'quota', label: 'โควตาข้อความ LINE', icon: Gauge },
  { key: 'friends', label: 'เพื่อน LINE ของ Sally', icon: Users },
  { key: 'health', label: 'สถานะระบบ', icon: HeartPulse },
  { key: 'audit24h', label: 'เหตุการณ์ความปลอดภัย (24 ชม.)', icon: ScrollText },
];

function value(key: AdminMetricKey, m: MetricDto): { main: string; sub?: string } {
  if (m.status === 'not-enabled') return { main: 'ยังไม่เปิด', sub: 'EP03' };
  if (m.status === 'unavailable' && m.value === null) return { main: 'ไม่พร้อม', sub: 'ดูรายละเอียด' };
  if (key === 'quota')
    return {
      main: m.total !== null && m.total !== undefined ? `${m.value} / ${m.total}` : `${m.value}`,
      sub: m.total === null ? 'ไม่จำกัดโควตา' : 'ใช้ไป / โควตาเดือนนี้',
    };
  if (key === 'health') return { main: m.value === 1 ? 'ปกติ' : 'มีปัญหา' };
  return { main: String(m.value ?? '—') };
}

export function DashboardPage() {
  const { api } = useApp();
  const load = useLoad(() => api.adminOverview(), 'adm-overview');
  return (
    <AdminPage
      title="แดชบอร์ด"
      intro="ทุกการ์ดกดเพื่อดูรายละเอียดได้ ตัวเลขทั้งหมดอ่านจากฐานข้อมูล FLOW หรือ LINE โดยตรง — ค่าที่ยังไม่มีแหล่งข้อมูลจะแจ้งตามจริง ไม่แสดงเป็นศูนย์"
    >
      {load.state === 'error' && !load.data ? (
        <ErrorBox error={load.error} onRetry={load.reload} />
      ) : !load.data ? (
        <div className="adm-kpis" aria-busy="true">
          {CARDS.slice(0, 8).map((c) => (
            <Skeleton key={c.key} height={112} radius={16} />
          ))}
        </div>
      ) : (
        <>
          <ul className="adm-kpis">
            {CARDS.filter((c) => load.data?.metrics[c.key]).map((c) => {
              const m = load.data?.metrics[c.key] as MetricDto;
              const v = value(c.key, m);
              const hot = c.key === 'requestsPending' && (m.value ?? 0) > 0;
              return (
                <li key={c.key}>
                  <Link
                    to={m.to}
                    className={`adm-kpi adm-kpi--${m.status}${hot ? ' adm-kpi--hot' : ''}`}
                    aria-describedby={m.noteTh ? `kpi-${c.key}` : undefined}
                  >
                    <span className="adm-kpi__top">
                      <c.icon aria-hidden />
                      <span className="adm-kpi__label">{c.label}</span>
                    </span>
                    <span className="adm-kpi__value f-num">{v.main}</span>
                    {v.sub ? <span className="adm-kpi__sub">{v.sub}</span> : null}
                    {m.noteTh ? (
                      <span className="adm-kpi__note" id={`kpi-${c.key}`}>
                        {m.noteTh}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="adm-fine">
            ข้อมูล ณ {fireText(load.data.generatedAt)}
            {load.data.ownerOnly ? ' · บางการ์ด (LINE, กิจกรรม, สถานะระบบ) แสดงเฉพาะเจ้าของระบบ' : ''}
          </p>
        </>
      )}
    </AdminPage>
  );
}

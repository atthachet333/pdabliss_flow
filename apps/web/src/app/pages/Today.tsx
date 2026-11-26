import { Link } from 'react-router';
import { formatThaiLocalDate, describeTimeUntilThai } from '@flow/shared';
import { BellRing, CalendarPlus, History, Search } from '../../components/icons';
import { Notice, SallyImage } from '../../components/ui';
import { useApp, useLoad, whenText } from '../core';
import { AppointmentCard, Empty, Loaded, Page } from '../ui';
import { WorkspaceFilter } from './shared';

export function TodayPage() {
  const { api, me, workspaceId } = useApp();
  const load = useLoad(() => api.today(), 'today');
  const first = me.user.displayName;
  return (
    <Page
      title="วันนี้"
      actions={
        <>
          <Link to="/search" className="icon-btn" aria-label="ค้นหานัดหมาย">
            <Search aria-hidden />
          </Link>
          <Link to="/history" className="icon-btn" aria-label="ประวัติ">
            <History aria-hidden />
          </Link>
        </>
      }
    >
      <WorkspaceFilter />
      <Loaded load={load}>
        {(d) => {
          const pick = <T extends { workspaceId: string }>(xs: T[]) =>
            workspaceId === 'all' ? xs : xs.filter((x) => x.workspaceId === workspaceId);
          const today = pick(d.today);
          const upcoming = pick(d.upcoming).filter((a) => !today.some((t) => t.id === a.id));
          const next = pick(d.next ? [d.next] : [])[0] ?? null;
          const dt = formatThaiLocalDate(d.date);
          return (
            <>
              <div className="hero">
                <SallyImage expression={next ? 'reminder' : 'default'} size={72} decorative />
                <div>
                  <p className="hero__date">{dt.long}</p>
                  <p className="hero__greet f-name">สวัสดีค่ะ คุณ{first}</p>
                  <p className="hero__line">
                    {next ? (
                      <>
                        นัดถัดไป <strong className="f-name">{next.title}</strong> · {whenText(next)}
                        {next.startAt
                          ? ` (${describeTimeUntilThai(new Date(next.startAt), new Date())})`
                          : ''}
                      </>
                    ) : (
                      'ยังไม่มีนัดหมายที่กำลังจะถึงค่ะ'
                    )}
                  </p>
                </div>
              </div>
              <div className="stat-row">
                <div className="stat">
                  <span className="stat__n f-num">{today.length}</span>
                  <span className="stat__l">นัดวันนี้</span>
                </div>
                <div className="stat">
                  <span className="stat__n f-num">{upcoming.length}</span>
                  <span className="stat__l">ใน 14 วัน</span>
                </div>
                <div className="stat">
                  <span className="stat__n f-num">{d.reminders.scheduledNext7Days}</span>
                  <span className="stat__l">แจ้งเตือนใน 7 วัน</span>
                </div>
              </div>
              {!d.reminders.deliveryEnabled ? (
                <Notice tone="info">
                  <BellRing aria-hidden className="inline-icon" /> ระบบคำนวณเวลาแจ้งเตือนไว้ให้แล้ว —
                  การส่งข้อความ LINE จริงจะเปิดในเฟสถัดไป
                </Notice>
              ) : null}
              <h2 className="section-title">วันนี้</h2>
              {today.length ? (
                <div className="stack">
                  {today.map((a) => (
                    <AppointmentCard key={a.id} a={a} showDate={false} />
                  ))}
                </div>
              ) : (
                <Empty
                  title="วันนี้ว่างค่ะ"
                  body="ไม่มีนัดหมายในวันนี้"
                  action={
                    <Link className="f-btn f-btn--create" to="/appointments/new">
                      <CalendarPlus aria-hidden /> สร้างนัดหมาย
                    </Link>
                  }
                />
              )}
              {upcoming.length ? (
                <>
                  <h2 className="section-title">กำลังจะถึง</h2>
                  <div className="stack">
                    {upcoming.map((a) => (
                      <AppointmentCard key={a.id} a={a} />
                    ))}
                  </div>
                  <Link to="/calendar" className="more-link">
                    ดูทั้งหมดในปฏิทิน
                  </Link>
                </>
              ) : null}
            </>
          );
        }}
      </Loaded>
    </Page>
  );
}

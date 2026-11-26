import { useMemo, useState } from 'react';
import {
  describeTimeUntilThai,
  formatThaiLocalDate,
  toLocalDateString,
  zonedLocalToUtc,
  zonedParts,
} from '@flow/shared';
import { brandArt } from '../brand/assets';
import {
  CalendarDays,
  CalendarPlus,
  History,
  House,
  MapPin,
  Settings,
  Users,
} from '../components/icons';
import { CATEGORY_ICON, CategoryBadge, ProtoBadge, SallyImage, StateView } from '../components/ui';
import {
  MOCK_DESTINATIONS,
  MOCK_TIMEZONE,
  mockAppointments,
  type MockAppointment,
} from '../fixtures/mock';

type Filter = 'all' | 'personal' | 'family' | 'company';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'ทั้งหมด' },
  { id: 'personal', label: 'ส่วนตัว' },
  { id: 'family', label: 'ครอบครัว' },
  { id: 'company', label: 'บริษัท' },
];

function greeting(hour: number): string {
  if (hour < 12) return 'อรุณสวัสดิ์ค่ะ';
  if (hour < 17) return 'สวัสดีตอนบ่ายค่ะ';
  return 'สวัสดีตอนเย็นค่ะ';
}

function workspaceOf(a: MockAppointment) {
  return MOCK_DESTINATIONS.find((d) => d.id === a.destinationId)?.workspaceKind ?? 'personal';
}

export function TodayPrototype({ forceEmpty = false }: { forceEmpty?: boolean }) {
  const [now] = useState(() => new Date());
  const [filter, setFilter] = useState<Filter>('all');
  const today = toLocalDateString(now, MOCK_TIMEZONE);
  const all = useMemo(() => (forceEmpty ? [] : mockAppointments(now)), [now, forceEmpty]);
  const withStart = all.map((a) => ({
    ...a,
    start: zonedLocalToUtc(a.localDate, a.allDay ? '00:00' : a.localTime, MOCK_TIMEZONE),
  }));
  const visible = withStart.filter((a) => filter === 'all' || workspaceOf(a) === filter);
  const todays = visible.filter((a) => a.localDate === today);
  const upcoming = visible.filter((a) => a.localDate > today);
  const next = todays.find((a) => !a.allDay && a.start.getTime() > now.getTime());
  const hour = zonedParts(now, MOCK_TIMEZONE).hour;
  const dateText = formatThaiLocalDate(today);

  return (
    <div className="today">
      <header className="today__bar">
        <img src={brandArt.flowWordmark} alt="FLOW" className="today__mark" />
        <ProtoBadge>ข้อมูลจำลอง</ProtoBadge>
      </header>

      <section className="today__hello">
        <SallyImage expression={next ? 'reminder' : 'default'} size={56} decorative />
        <div>
          <p className="today__greet">{greeting(hour)}</p>
          <p className="today__date">{dateText.long}</p>
        </div>
      </section>

      {next ? (
        <article className="today__next" data-theme={next.category}>
          <p className="today__next-label">นัดถัดไป · {describeTimeUntilThai(next.start, now)}</p>
          <p className="today__next-time f-num">{next.localTime} น.</p>
          <p className="today__next-title">{next.title}</p>
          {next.location ? (
            <p className="today__next-loc">
              <MapPin aria-hidden /> {next.location}
            </p>
          ) : null}
        </article>
      ) : null}

      <div className="today__filters" role="group" aria-label="กรองตามกลุ่ม">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className="f-chip"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <section aria-labelledby="today-list">
        <h4 id="today-list" className="today__h">
          วันนี้ <span className="f-muted">({todays.length})</span>
        </h4>
        {todays.length === 0 ? (
          <StateView
            expression="empty"
            title="วันนี้ยังไม่มีนัดหมายค่ะ"
            body="ใช้เวลากับสิ่งที่สำคัญได้เต็มที่เลยนะคะ"
          />
        ) : (
          <ol className="timeline">
            {todays.map((a) => {
              const past = !a.allDay && a.start.getTime() < now.getTime();
              const Icon = CATEGORY_ICON[a.category];
              return (
                <li
                  key={a.id}
                  className={`timeline__item${past ? ' is-past' : ''}`}
                  data-theme={a.category}
                >
                  <span className="timeline__time f-num">{a.allDay ? 'ทั้งวัน' : a.localTime}</span>
                  <span className="timeline__dot" aria-hidden>
                    <Icon />
                  </span>
                  <div className="timeline__card">
                    <p className="timeline__title">{a.title}</p>
                    <p className="timeline__meta">
                      <CategoryBadge category={a.category} />
                      {past ? <span className="f-muted"> · ผ่านไปแล้ว</span> : null}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {upcoming.length > 0 ? (
        <section aria-labelledby="upcoming-list">
          <h4 id="upcoming-list" className="today__h">
            เร็วๆ นี้
          </h4>
          <ul className="upcoming">
            {upcoming.map((a) => (
              <li key={a.id} data-theme={a.category}>
                <span className="upcoming__date">
                  <span className="f-num">{formatThaiLocalDate(a.localDate).day}</span>
                  <small>{formatThaiLocalDate(a.localDate).month}</small>
                </span>
                <span className="upcoming__text">
                  <span className="upcoming__title">{a.title}</span>
                  <span className="f-hint">{a.allDay ? 'ทั้งวัน' : `${a.localTime} น.`}</span>
                </span>
                <CategoryBadge category={a.category} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <a href="#create" className="f-btn f-btn--create today__fab">
        <CalendarPlus aria-hidden /> เพิ่มนัดหมาย
      </a>

      <div
        className="f-tabbar today__tabbar"
        aria-label="เมนูหลัก (ภาพต้นแบบ ยังไม่เชื่อมหน้าจริง)"
        role="img"
      >
        <span data-current="true">
          <House aria-hidden />
          วันนี้
        </span>
        <span>
          <CalendarDays aria-hidden />
          ปฏิทิน
        </span>
        <span>
          <Users aria-hidden />
          กลุ่ม
        </span>
        <span>
          <History aria-hidden />
          ประวัติ
        </span>
        <span>
          <Settings aria-hidden />
          ตั้งค่า
        </span>
      </div>
    </div>
  );
}

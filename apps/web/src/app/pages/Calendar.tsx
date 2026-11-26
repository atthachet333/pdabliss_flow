import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { AppointmentSummaryDto, CategoryId } from '@flow/shared';
import { ChevronRight, ArrowLeft, CalendarPlus } from '../../components/icons';
import { Notice, Switch } from '../../components/ui';
import {
  dateLabel,
  monthGrid,
  shift,
  THAI_MONTHS,
  THAI_WEEKDAYS_MON,
  todayLocal,
  useApp,
  useLoad,
  weekStart,
  whenText,
} from '../core';
import { AppointmentCard, Empty, Loaded, Page, Segmented } from '../ui';
import { CategoryFilter, WorkspaceFilter } from './shared';

type View = 'month' | 'week' | 'agenda';

function rangeFor(view: View, anchor: string): { from: string; to: string } {
  if (view === 'week') {
    const from = weekStart(anchor);
    return { from, to: shift(from, 6) };
  }
  if (view === 'agenda') return { from: anchor, to: shift(anchor, 30) };
  const [y, m] = anchor.split('-').map(Number) as [number, number];
  const grid = monthGrid(y, m);
  return { from: grid[0] as string, to: grid[41] as string };
}

const onDay = (a: AppointmentSummaryDto, d: string) => a.startDate <= d && a.endDate >= d;

export function CalendarPage() {
  const { api, workspaceId } = useApp();
  const [view, setView] = useState<View>('month');
  const [anchor, setAnchor] = useState(todayLocal());
  const [selected, setSelected] = useState(todayLocal());
  const [cats, setCats] = useState<CategoryId[]>([]);
  const [cancelled, setCancelled] = useState(false);
  const range = rangeFor(view, anchor);
  const wsParam = workspaceId === 'all' ? undefined : workspaceId;
  const key = `${range.from}|${range.to}|${wsParam ?? ''}|${cats.join(',')}|${cancelled}`;
  // Server-side range, workspace and category filtering: only authorized rows ever arrive.
  const load = useLoad(
    () =>
      api.calendar(range.from, range.to, {
        ...(wsParam ? { workspaceId: wsParam } : {}),
        ...(cats.length ? { category: cats.join(',') } : {}),
        cancelled,
      }),
    key,
  );

  const [y, m] = anchor.split('-').map(Number) as [number, number];
  const title =
    view === 'month'
      ? `${THAI_MONTHS[m - 1]} ${y + 543}`
      : view === 'week'
        ? `${dateLabel(range.from)} – ${dateLabel(range.to)}`
        : `30 วันนับจาก ${dateLabel(range.from)}`;
  const move = (dir: 1 | -1) => {
    if (view === 'month') {
      const d = new Date(Date.UTC(y, m - 1 + dir, 1)).toISOString().slice(0, 10);
      setAnchor(d);
    } else setAnchor(shift(anchor, dir * (view === 'week' ? 7 : 30)));
  };

  return (
    <Page
      title="ปฏิทิน"
      actions={
        <Link
          to={`/appointments/new?date=${selected}`}
          className="icon-btn"
          aria-label="สร้างนัดหมายในวันที่เลือก"
        >
          <CalendarPlus aria-hidden />
        </Link>
      }
    >
      <WorkspaceFilter />
      <div className="cal-toolbar">
        <Segmented<View>
          label="มุมมองปฏิทิน"
          value={view}
          onChange={setView}
          options={[
            { value: 'month', label: 'เดือน' },
            { value: 'week', label: 'สัปดาห์' },
            { value: 'agenda', label: 'รายการ' },
          ]}
        />
        <div className="cal-nav">
          <button type="button" className="icon-btn" aria-label="ก่อนหน้า" onClick={() => move(-1)}>
            <ArrowLeft aria-hidden />
          </button>
          <span className="cal-nav__title f-num" aria-live="polite">
            {title}
          </span>
          <button type="button" className="icon-btn" aria-label="ถัดไป" onClick={() => move(1)}>
            <ChevronRight aria-hidden />
          </button>
          <button
            type="button"
            className="f-btn f-btn--sm"
            onClick={() => {
              setAnchor(todayLocal());
              setSelected(todayLocal());
            }}
          >
            วันนี้
          </button>
        </div>
      </div>
      <details className="filters">
        <summary>
          ตัวกรอง{cats.length || cancelled ? ` (${cats.length + (cancelled ? 1 : 0)})` : ''}
        </summary>
        <CategoryFilter value={cats} onChange={setCats} />
        <Switch checked={cancelled} onChange={setCancelled} label="แสดงนัดที่ยกเลิกแล้ว" />
      </details>
      <Loaded load={load} skeleton={4}>
        {(d) => (
          <>
            {d.truncated ? (
              <Notice tone="caution">มีนัดหมายมากเกินกว่าจะแสดงทั้งหมดในช่วงนี้ — ลองใช้มุมมองสัปดาห์</Notice>
            ) : null}
            {view === 'month' ? (
              <MonthGrid
                year={y}
                month={m}
                days={d.days}
                items={d.items}
                selected={selected}
                onSelect={setSelected}
              />
            ) : null}
            {view === 'week' ? <WeekList from={range.from} items={d.items} /> : null}
            {view === 'agenda' ? <Agenda items={d.items} /> : null}
            {view === 'month' ? (
              <>
                <h2 className="section-title">{dateLabel(selected)}</h2>
                <DayList items={d.items.filter((a) => onDay(a, selected))} date={selected} />
              </>
            ) : null}
          </>
        )}
      </Loaded>
    </Page>
  );
}

function MonthGrid({
  year,
  month,
  days,
  items,
  selected,
  onSelect,
}: {
  year: number;
  month: number;
  days: Record<string, number>;
  items: AppointmentSummaryDto[];
  selected: string;
  onSelect: (d: string) => void;
}) {
  const grid = useMemo(() => monthGrid(year, month), [year, month]);
  const today = todayLocal();
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  return (
    <div className="month" role="grid" aria-label="ปฏิทินรายเดือน">
      <div className="month__head" role="row">
        {THAI_WEEKDAYS_MON.map((w) => (
          <span key={w} role="columnheader">
            {w}
          </span>
        ))}
      </div>
      <div className="month__body">
        {grid.map((d) => {
          const n = days[d] ?? 0;
          const cats = [...new Set(items.filter((a) => onDay(a, d)).map((a) => a.category))].slice(
            0,
            3,
          );
          return (
            <button
              key={d}
              type="button"
              role="gridcell"
              className={`day${d.startsWith(prefix) ? '' : ' day--out'}${d === today ? ' day--today' : ''}`}
              aria-selected={d === selected}
              aria-label={`${dateLabel(d)}${n ? ` มี ${n} นัด` : ''}`}
              onClick={() => onSelect(d)}
            >
              <span className="day__n f-num">{Number(d.slice(8))}</span>
              <span className="day__dots" aria-hidden>
                {cats.map((c) => (
                  <span key={c} className="dotc" data-theme={c} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DayList({ items, date }: { items: AppointmentSummaryDto[]; date: string }) {
  if (!items.length)
    return (
      <Empty
        title="ไม่มีนัดในวันนี้"
        action={
          <Link className="f-btn" to={`/appointments/new?date=${date}`}>
            <CalendarPlus aria-hidden /> สร้างนัดวันนี้
          </Link>
        }
      />
    );
  return (
    <div className="stack">
      {items.map((a) => (
        <AppointmentCard key={a.id} a={a} showDate={false} />
      ))}
    </div>
  );
}

function WeekList({ from, items }: { from: string; items: AppointmentSummaryDto[] }) {
  return (
    <div className="week">
      {Array.from({ length: 7 }, (_, i) => shift(from, i)).map((d) => {
        const list = items.filter((a) => onDay(a, d));
        return (
          <section key={d} className={`week__day${d === todayLocal() ? ' week__day--today' : ''}`}>
            <h3>{dateLabel(d)}</h3>
            {list.length ? (
              list.map((a) => (
                <Link
                  key={a.id}
                  to={`/appointments/${a.id}`}
                  className="week__item"
                  data-theme={a.category}
                >
                  <span className="f-num">{whenText(a)}</span>{' '}
                  <span className="f-name">{a.title}</span>
                </Link>
              ))
            ) : (
              <p className="f-hint">ว่าง</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Agenda({ items }: { items: AppointmentSummaryDto[] }) {
  if (!items.length) return <Empty title="ไม่มีนัดหมายใน 30 วันนี้" />;
  return (
    <div className="stack">
      {items.map((a) => (
        <AppointmentCard key={a.id} a={a} />
      ))}
    </div>
  );
}

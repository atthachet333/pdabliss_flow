import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { AppointmentSummaryDto, CategoryId, PageDto } from '@flow/shared';
import { Search } from '../../components/icons';
import { Button } from '../../components/ui';
import { useApp, useLoad } from '../core';
import { AppointmentCard, Empty, Loaded, Page, Segmented } from '../ui';
import { CategoryFilter } from './shared';

/** Paged list with an explicit "load more" (offset paging on the server). */
function PagedList({
  first,
  more,
  emptyTitle,
}: {
  first: PageDto<AppointmentSummaryDto>;
  more: (offset: number) => Promise<PageDto<AppointmentSummaryDto>>;
  emptyTitle: string;
}) {
  const [items, setItems] = useState(first.items);
  const [hasMore, setHasMore] = useState(first.hasMore);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setItems(first.items);
    setHasMore(first.hasMore);
  }, [first]);
  if (!items.length) return <Empty title={emptyTitle} />;
  return (
    <>
      <div className="stack">
        {items.map((a) => (
          <AppointmentCard key={a.id} a={a} />
        ))}
      </div>
      {hasMore ? (
        <Button
          block
          busy={busy}
          onClick={async () => {
            setBusy(true);
            setFailed(false);
            try {
              const next = await more(items.length);
              setItems((x) => [...x, ...next.items]);
              setHasMore(next.hasMore);
            } catch {
              setFailed(true);
            } finally {
              setBusy(false);
            }
          }}
        >
          {failed ? 'โหลดไม่สำเร็จ — ลองอีกครั้ง' : 'โหลดเพิ่ม'}
        </Button>
      ) : null}
    </>
  );
}

export function SearchPage() {
  const { api, me } = useApp();
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get('q') ?? '');
  const q = params.get('q') ?? '';
  const [cats, setCats] = useState<CategoryId[]>([]);
  const [ws, setWs] = useState('');
  const [status, setStatus] = useState<'scheduled' | 'cancelled' | 'all'>('all');
  const filters = {
    ...(q ? { q } : {}),
    ...(ws ? { workspaceId: ws } : {}),
    ...(cats.length ? { category: cats.join(',') } : {}),
    status,
  };
  const key = JSON.stringify(filters);
  const load = useLoad(() => api.search(filters), key);
  return (
    <Page title="ค้นหานัดหมาย" back="/today">
      <form
        className="searchbar"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setParams(text.trim() ? { q: text.trim() } : {}, { replace: true });
        }}
      >
        <Search aria-hidden />
        <input
          className="f-input"
          type="search"
          maxLength={80}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="ชื่อนัด หรือสถานที่"
          aria-label="คำค้นหา"
        />
        <Button type="submit" size="sm" variant="dark">
          ค้นหา
        </Button>
      </form>
      <details className="filters">
        <summary>ตัวกรอง</summary>
        <select
          className="f-select"
          aria-label="กลุ่ม"
          value={ws}
          onChange={(e) => setWs(e.target.value)}
        >
          <option value="">ทุกกลุ่ม</option>
          {me.workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <CategoryFilter value={cats} onChange={setCats} />
        <Segmented
          label="สถานะ"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: 'ทั้งหมด' },
            { value: 'scheduled', label: 'ตามนัด' },
            { value: 'cancelled', label: 'ยกเลิก' },
          ]}
        />
      </details>
      <p className="f-hint">ค้นหาเฉพาะนัดหมายที่คุณมีสิทธิ์เห็นเท่านั้น</p>
      <Loaded load={load}>
        {(page) => (
          <PagedList
            first={page}
            more={(offset) => api.search({ ...filters, offset })}
            emptyTitle={q ? `ไม่พบ “${q}”` : 'ไม่พบนัดหมาย'}
          />
        )}
      </Loaded>
    </Page>
  );
}

export function HistoryPage() {
  const { api } = useApp();
  const [scope, setScope] = useState<'upcoming' | 'past' | 'cancelled'>('past');
  const load = useLoad(() => api.history(scope), scope);
  return (
    <Page title="ประวัติ" back="/today">
      <Segmented
        label="ช่วงเวลา"
        value={scope}
        onChange={setScope}
        options={[
          { value: 'upcoming', label: 'กำลังจะถึง' },
          { value: 'past', label: 'ที่ผ่านมา' },
          { value: 'cancelled', label: 'ยกเลิกแล้ว' },
        ]}
      />
      <Loaded load={load}>
        {(page) => (
          <PagedList
            first={page}
            more={(offset) => api.history(scope, offset)}
            emptyTitle={
              scope === 'cancelled'
                ? 'ไม่มีนัดที่ยกเลิก'
                : scope === 'past'
                  ? 'ยังไม่มีนัดที่ผ่านมา'
                  : 'ไม่มีนัดที่กำลังจะถึง'
            }
          />
        )}
      </Loaded>
    </Page>
  );
}

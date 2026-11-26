import { useId, useMemo, useState } from 'react';
import { destinationAvailability, type DestinationOption } from '@flow/shared';
import { Check, ChevronDown, Lock, Search, User, Users, X } from '../components/icons';

const ROLE_TH: Record<DestinationOption['viewerRole'], string> = {
  'system-owner': 'คุณเป็นเจ้าของระบบ',
  'workspace-admin': 'คุณเป็นผู้ดูแล',
  member: 'คุณเป็นสมาชิก',
  viewer: 'คุณดูได้อย่างเดียว',
};

const KIND_TH: Record<DestinationOption['kind'], string> = {
  'private-self': 'แชทส่วนตัว',
  'line-group': 'กลุ่ม LINE',
  individual: 'รายบุคคล',
};

function KindIcon({ kind }: { kind: DestinationOption['kind'] }) {
  if (kind === 'private-self') return <Lock aria-hidden />;
  if (kind === 'individual') return <User aria-hidden />;
  return <Users aria-hidden />;
}

function metaLine(o: DestinationOption): string {
  const parts = [KIND_TH[o.kind], o.workspaceLabel];
  if (o.kind === 'line-group')
    parts.push(o.memberCount === null ? 'ไม่ทราบจำนวนสมาชิก' : `${o.memberCount} คน`);
  return parts.join(' · ');
}

function unavailableReason(o: DestinationOption): string | null {
  const a = destinationAvailability(o);
  if (a === 'not-active')
    return o.lifecycle === 'pending-registration' ? 'รอผู้ดูแลยืนยันการลงทะเบียน' : 'ปลายทางนี้ไม่พร้อมใช้งาน';
  if (a === 'no-permission') return 'ไม่มีสิทธิ์แจ้งเตือนในกลุ่มนี้';
  return null;
}

export function DestinationSelector({
  options,
  selectedIds,
  onToggle,
  onOnlyMe,
}: {
  options: readonly DestinationOption[];
  selectedIds: readonly string[];
  onToggle: (id: string) => void;
  onOnlyMe: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const panelId = useId();
  const searchId = useId();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => `${o.displayName} ${o.workspaceLabel}`.toLowerCase().includes(q));
  }, [options, query]);

  const selected = selectedIds
    .map((id) => options.find((o) => o.id === id))
    .filter((o): o is DestinationOption => Boolean(o));

  return (
    <div className="dest">
      <button
        type="button"
        className="dest__trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="dest__trigger-label">
          {selected.length === 0 ? (
            <span className="f-muted">เลือกปลายทางการแจ้งเตือน</span>
          ) : (
            selected.map((o) => (
              <span key={o.id} className="dest__pill">
                <KindIcon kind={o.kind} />
                {o.displayName}
              </span>
            ))
          )}
        </span>
        <ChevronDown aria-hidden className={`dest__chev${open ? ' is-open' : ''}`} />
      </button>

      {open ? (
        <div className="dest__panel" id={panelId}>
          <div className="dest__search">
            <Search aria-hidden />
            <label htmlFor={searchId} className="f-sr-only">
              ค้นหากลุ่มหรือผู้รับ
            </label>
            <input
              id={searchId}
              className="f-input"
              type="search"
              placeholder="ค้นหากลุ่มหรือผู้รับ"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div role="group" aria-label="ปลายทางที่คุณมีสิทธิ์" className="dest__list">
            {filtered.length === 0 ? <p className="dest__none">ไม่พบกลุ่มที่ตรงกับคำค้นหา</p> : null}
            {filtered.map((o) => {
              const reason = unavailableReason(o);
              const isSelected = selectedIds.includes(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  className="dest__option"
                  aria-pressed={isSelected}
                  aria-disabled={reason ? true : undefined}
                  onClick={() => (reason ? undefined : onToggle(o.id))}
                >
                  <span className="dest__icon" data-kind={o.kind}>
                    <KindIcon kind={o.kind} />
                  </span>
                  <span className="dest__text">
                    <span className="dest__name">{o.displayName}</span>
                    <span className="dest__meta">{metaLine(o)}</span>
                    <span className="dest__role">{reason ?? ROLE_TH[o.viewerRole]}</span>
                  </span>
                  <span className="dest__check" aria-hidden>
                    {isSelected ? <Check /> : null}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="dest__actions">
            <button type="button" className="f-btn f-btn--ghost f-btn--sm" onClick={onOnlyMe}>
              <Lock aria-hidden /> เฉพาะฉัน
            </button>
            <button
              type="button"
              className="f-btn f-btn--sm f-btn--dark"
              onClick={() => setOpen(false)}
            >
              <X aria-hidden /> ปิดรายการ
            </button>
          </div>
        </div>
      ) : null}

      <p className="dest__summary" aria-live="polite">
        {selected.length === 0
          ? 'ยังไม่ได้เลือกปลายทาง'
          : `จะแจ้งเตือน ${selected.length} ปลายทาง · แยกข้อความตามปลายทาง`}
      </p>
    </div>
  );
}

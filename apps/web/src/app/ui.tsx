import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import type { AppointmentSummaryDto } from '@flow/shared';
import {
  ArrowLeft,
  Bell,
  ChevronRight,
  Lock,
  MapPin,
  RefreshCw,
  Users,
  X,
} from '../components/icons';
import { Button, CategoryBadge, Notice, Skeleton, StateView } from '../components/ui';
import { dateLabel, errorText, whenText, type Load } from './core';
import { BillBadge, MemberMark, SeriesBadge } from './extras';

export function Page({
  title,
  back,
  actions,
  children,
  wide,
}: {
  title: string;
  back?: string | true;
  actions?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  const navigate = useNavigate();
  useEffect(() => {
    document.title = `${title} · FLOW`;
  }, [title]);
  return (
    <section className={`page${wide ? ' page--wide' : ''}`} aria-labelledby="page-title">
      <header className="page__head">
        {back ? (
          <button
            type="button"
            className="icon-btn"
            aria-label="ย้อนกลับ"
            onClick={() => (back === true ? navigate(-1) : navigate(back))}
          >
            <ArrowLeft aria-hidden />
          </button>
        ) : null}
        <h1 id="page-title" className="page__title f-name">
          {title}
        </h1>
        {actions ? <div className="page__actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

/** Loading / error / ready switch with an explicit retry (never an automatic one). */
export function Loaded<T>({
  load,
  children,
  skeleton = 3,
}: {
  load: Load<T> & { reload: () => void };
  children: (data: T) => ReactNode;
  skeleton?: number;
}) {
  if (load.data !== undefined && load.state !== 'error') return <>{children(load.data)}</>;
  if (load.state === 'error')
    return (
      <div className="load-error" role="alert">
        <Notice tone="caution">{errorText(load.error)}</Notice>
        <Button icon={RefreshCw} onClick={load.reload}>
          ลองอีกครั้ง
        </Button>
      </div>
    );
  return (
    <div className="stack" aria-busy="true" aria-label="กำลังโหลด">
      {Array.from({ length: skeleton }, (_, i) => (
        <Skeleton key={i} height={72} radius={16} />
      ))}
    </div>
  );
}

export function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return <StateView expression="empty" title={title} {...(body ? { body } : {})} action={action} />;
}

export function AppointmentCard({
  a,
  showDate = true,
}: {
  a: AppointmentSummaryDto;
  showDate?: boolean;
}) {
  const cancelled = a.status === 'CANCELLED';
  return (
    <Link
      to={`/appointments/${a.id}`}
      className={`appt${cancelled ? ' appt--cancelled' : ''}`}
      data-theme={a.category}
    >
      <span className="appt__bar" aria-hidden />
      <span className="appt__body">
        <span className="appt__when f-num">
          {showDate ? `${dateLabel(a.startDate)} · ` : ''}
          {whenText(a)}
          {cancelled ? <span className="tag tag--muted">ยกเลิกแล้ว</span> : null}
        </span>
        <span className="appt__title f-name">{a.title}</span>
        <span className="appt__meta">
          <CategoryBadge category={a.category} />
          <SeriesBadge a={a} />
          <BillBadge a={a} />
          {a.creator && !a.mine ? (
            <span className="appt__creator">
              <MemberMark name={a.creator.displayName} color={a.creator.color} />
            </span>
          ) : null}
          <span className="appt__ws">
            {a.visibility === 'PRIVATE' ? <Lock aria-label="ส่วนตัว" /> : <Users aria-hidden />}
            {a.workspaceName}
          </span>
          {a.location ? (
            <span className="appt__loc">
              <MapPin aria-hidden />
              {a.location}
            </span>
          ) : null}
          {a.scheduledReminders > 0 ? (
            <span className="appt__rem" title="จำนวนเวลาแจ้งเตือนที่คำนวณไว้ (ยังไม่ส่งจริง)">
              <Bell aria-hidden />
              {a.scheduledReminders}
            </span>
          ) : null}
        </span>
      </span>
      <ChevronRight className="appt__go" aria-hidden />
    </Link>
  );
}

/** Accessible confirmation dialog for every destructive or privilege-changing action. */
export function Confirm({
  open,
  title,
  body,
  confirmLabel,
  danger,
  busy,
  error,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    }
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={`${id}-t`}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="sheet__head">
        <h2 id={`${id}-t`}>{title}</h2>
        <button
          type="button"
          className="icon-btn"
          aria-label="ปิด"
          onClick={onClose}
          disabled={busy}
        >
          <X aria-hidden />
        </button>
      </div>
      {body ? <div className="sheet__body">{body}</div> : null}
      {children}
      {error ? <Notice tone="caution">{error}</Notice> : null}
      <div className="sheet__actions">
        <Button onClick={onClose} disabled={busy}>
          ยกเลิก
        </Button>
        <Button variant={danger ? 'danger' : 'dark'} busy={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}

export function Toasts({
  items,
}: {
  items: { id: number; text: string; tone: 'success' | 'info' | 'caution' }[];
}) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast toast--${t.tone}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function useToasts() {
  const [items, setItems] = useState<
    { id: number; text: string; tone: 'success' | 'info' | 'caution' }[]
  >([]);
  const seq = useRef(0);
  const push = (text: string, tone: 'success' | 'info' | 'caution' = 'success') => {
    const id = (seq.current += 1);
    setItems((x) => [...x.slice(-2), { id, text, tone }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 3500);
  };
  return { items, push };
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="f-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label className="f-field">
      <span className="f-label">{label}</span>
      {children}
      {hint ? <span className="f-hint">{hint}</span> : null}
      {error ? <span className="f-error">{error}</span> : null}
    </label>
  );
}

export function KeyValue({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="kv">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { CategoryId } from '@flow/shared';
import { CATEGORIES } from '@flow/shared';
import { sallyArt, sallyRaster, type SallyExpression } from '../brand/assets';
import {
  Briefcase,
  CircleCheck,
  Gift,
  Heart,
  Info,
  LoaderCircle,
  Siren,
  Stethoscope,
  TriangleAlert,
  UserRound,
  type LucideIcon,
} from './icons';

export const CATEGORY_ICON: Record<CategoryId, LucideIcon> = {
  family: Heart,
  business: Briefcase,
  personal: UserRound,
  health: Stethoscope,
  special: Gift,
  urgent: Siren,
};

type ButtonVariant = 'primary' | 'secondary' | 'dark' | 'ghost' | 'danger' | 'create';

export function Button({
  variant = 'secondary',
  size,
  block,
  busy,
  icon: Icon,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: 'sm' | 'lg';
  block?: boolean;
  busy?: boolean;
  icon?: LucideIcon;
}) {
  const classes = [
    'f-btn',
    variant !== 'secondary' ? `f-btn--${variant}` : '',
    size ? `f-btn--${size}` : '',
    block ? 'f-btn--block' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      {...rest}
      type={rest.type ?? 'button'}
      className={classes}
      aria-busy={busy || undefined}
      disabled={busy || rest.disabled}
    >
      {busy ? <LoaderCircle className="f-spin" aria-hidden /> : Icon ? <Icon aria-hidden /> : null}
      {children}
    </button>
  );
}

export function CategoryBadge({ category, solid }: { category: CategoryId; solid?: boolean }) {
  const Icon = CATEGORY_ICON[category];
  return (
    <span className={`f-cat${solid ? ' f-cat--solid' : ''}`} data-theme={category}>
      <Icon aria-hidden />
      {CATEGORIES[category].labelTh}
    </span>
  );
}

export function When({
  time,
  date,
  timing,
}: {
  time: string;
  date: string;
  timing?: string | undefined;
}) {
  return (
    <div className="f-when">
      <span className="f-when__time">{time}</span>
      <span className="f-when__date">
        {date}
        {timing ? ` · ${timing}` : ''}
      </span>
    </div>
  );
}

const NOTICE_ICON = {
  info: Info,
  caution: TriangleAlert,
  block: TriangleAlert,
  success: CircleCheck,
} as const;

export function Notice({
  tone = 'info',
  children,
}: {
  tone?: keyof typeof NOTICE_ICON;
  children: ReactNode;
}) {
  const Icon = NOTICE_ICON[tone];
  return (
    <div
      className={`f-notice${tone === 'info' ? '' : ` f-notice--${tone}`}`}
      role={tone === 'block' ? 'alert' : undefined}
    >
      <Icon aria-hidden />
      <div>{children}</div>
    </div>
  );
}

/** Marks anything simulated. EP00 rule: every mock value or action must carry this. */
export function ProtoBadge({ children = 'ข้อมูลจำลอง · PROTOTYPE' }: { children?: ReactNode }) {
  return <span className="f-proto">{children}</span>;
}

export function Switch({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="f-switch">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="f-switch__track" aria-hidden />
      <span>
        <span style={{ display: 'block', fontWeight: 600 }}>{label}</span>
        {hint ? <span className="f-hint">{hint}</span> : null}
      </span>
    </label>
  );
}

/**
 * Sally renderings.
 *  - expression (default): vector expression set — consistent across states.
 *  - variant "avatar": raster crop of the owner-approved reference (chat avatar, profile).
 *  - variant "portrait": the full owner-approved reference image.
 */
export function SallyImage({
  expression = 'default',
  size = 64,
  decorative = false,
  variant = 'expression',
}: {
  expression?: SallyExpression;
  size?: number;
  decorative?: boolean;
  variant?: 'expression' | 'avatar' | 'portrait';
}) {
  const src =
    variant === 'avatar'
      ? size > 128
        ? sallyRaster.avatar256
        : sallyRaster.avatar128
      : variant === 'portrait'
        ? size > 360
          ? sallyRaster.portrait720
          : sallyRaster.portrait360
        : sallyArt[expression];
  const alt = decorative
    ? ''
    : variant === 'expression'
      ? `Sally (${expression})`
      : 'Sally — มาสคอตรถยนต์ของ FLOW';
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt={alt}
      className={`sally-img sally-img--${variant}`}
      draggable={false}
      decoding="async"
    />
  );
}

export function StateView({
  expression,
  title,
  body,
  action,
}: {
  expression: SallyExpression;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="f-state">
      <SallyImage expression={expression} size={104} decorative />
      <p className="f-state__title">{title}</p>
      {body ? <p className="f-state__body">{body}</p> : null}
      {action}
    </div>
  );
}

export function Skeleton({
  width = '100%',
  height = 16,
  radius,
}: {
  width?: number | string;
  height?: number;
  radius?: number;
}) {
  return <div className="f-skeleton" style={{ width, height, borderRadius: radius }} aria-hidden />;
}

/**
 * FLOW design tokens — single source of truth for colour decisions.
 * tokens.css mirrors these values for the web app; a test guards against drift.
 * Future Flex Message builders (EP04) read colours from here, because LINE Flex
 * Messages accept hex colours, not CSS variables.
 *
 * Changes from the EP00 brief palette are documented in docs/DESIGN-SYSTEM.md.
 */

export const brand = {
  forest: '#0B211C',
  emerald: '#16836B',
  /** Added in EP00: emerald dark enough for text on ivory/white (AA). */
  emerald700: '#127261',
  mint: '#A5EFCB',
  ivory: '#F8F7F2',
  graphite: '#202923',
} as const;

export const sally = {
  blue: '#A8D2E8',
  ice: '#EAF5FC',
  silver: '#C8D9E6',
  deepBlue: '#34566E',
  /** Decorative only — below AA for small text on white. */
  mutedBlue: '#517F9F',
} as const;

export const neutral = {
  ink: '#1B2420',
  inkMuted: '#55605A',
  line: '#E3E1D8',
  lineStrong: '#CFCCC0',
  surface: '#FFFFFF',
  canvas: brand.ivory,
} as const;

export const feedback = {
  success: '#127261',
  warning: '#8A5A00',
  warningTint: '#FFF6E5',
  danger: '#B3261E',
  dangerTint: '#FDEDEB',
  info: '#34566E',
  infoTint: '#EAF5FC',
} as const;

export interface CategoryTheme {
  /** Header / badge fill. White text must reach 4.5:1 on it. */
  accent: string;
  /** Soft background for cards. */
  tint: string;
  /** Text colour on the tint (≥ 7:1). */
  ink: string;
  /** Optional decorative highlight (never carries information). */
  highlight: string;
}

export const categoryThemes = {
  family: { accent: '#A8435B', tint: '#FBEFF2', ink: '#6E2236', highlight: '#F2C7D1' },
  business: { accent: '#1F3A5F', tint: '#EAF0F7', ink: '#142740', highlight: '#16836B' },
  personal: { accent: '#5E4F8C', tint: '#F1EEF8', ink: '#3B3060', highlight: '#CFC6E8' },
  health: { accent: '#0E7175', tint: '#E5F4F3', ink: '#0A4F52', highlight: '#A6DCD8' },
  special: { accent: '#8A6420', tint: '#FAF3E3', ink: '#5E4313', highlight: '#D9B970' },
  urgent: { accent: '#B3261E', tint: '#FDEDEB', ink: '#7A1B15', highlight: '#F4B183' },
  brand: { accent: '#0B211C', tint: '#EEF6F2', ink: '#0B211C', highlight: '#A5EFCB' },
  neutral: { accent: '#5B6660', tint: '#F0F1EE', ink: '#202923', highlight: '#C9CEC9' },
} as const satisfies Record<string, CategoryTheme>;

export type ThemeId = keyof typeof categoryThemes;

export const radius = { sm: 8, md: 12, lg: 18, xl: 26, pill: 999 } as const;
export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

export const typography = {
  family:
    "'IBM Plex Sans Thai', 'Noto Sans Thai', 'Leelawadee UI', 'Tahoma', system-ui, sans-serif",
  /** Thai needs generous line height so above/below marks are never clipped. */
  lineHeightBody: 1.65,
  lineHeightHeading: 1.35,
  minTextPx: 13,
  scalePx: { xs: 13, sm: 14, base: 16, md: 18, lg: 21, xl: 26, '2xl': 32, '3xl': 40, display: 52 },
} as const;

// ----------------------------------------------------------------- contrast

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m || !m[1]) throw new RangeError(`Expected #RRGGBB, got ${hex}`);
  const n = parseInt(m[1], 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

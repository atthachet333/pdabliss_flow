# Design system

Direction: **Luxury Tech × Friendly Assistant × Editorial Minimalism**. The implementation is in
`packages/design-system` (tokens as TS + CSS, component CSS) and is rendered live at
`/dev/design-showcase`.

## 1. Signature language

- **Ivory canvas, deep-forest panels, emerald accent.** LINE green is never the identity.
- **The time ring.** An open circle with a "moment" dot. It appears in the FLOW symbol, the
  wordmark's O, the hero's concentric rings and the next-appointment card. This is the
  recognisable FLOW motif.
- **Editorial hierarchy.** Letter-spaced English eyebrows over Thai headings, hairline rules,
  generous whitespace, one strong number (the time) per card.
- **Sally** brings warmth through expressions and voice rather than decoration.

## 2. Colour tokens (`src/tokens.ts`, mirrored in `src/tokens.css`)

| Token                                 | Hex                                           | Use                                             |
| ------------------------------------- | --------------------------------------------- | ----------------------------------------------- |
| forest                                | `#0B211C`                                     | Panels, dark buttons, hero                      |
| emerald                               | `#16836B`                                     | Filled primary buttons (white text 4.67:1)      |
| **emerald700** _(new)_                | `#127261`                                     | Text/links on ivory or white (5.8:1)            |
| mint                                  | `#A5EFCB`                                     | Accents on forest (12.7:1)                      |
| ivory                                 | `#F8F7F2`                                     | Canvas                                          |
| graphite                              | `#202923`                                     | Quota "used", neutral ink                       |
| Sally Blue / Ice / Silver / Deep Blue | `#A8D2E8` / `#EAF5FC` / `#C8D9E6` / `#34566E` | Mascot, info surfaces                           |
| Muted Blue                            | `#517F9F`                                     | **Decoration only** (4.30:1 on white, below AA) |
| ink / ink-muted                       | `#1B2420` / `#55605A`                         | Body / secondary text (≥ 6:1 on ivory)          |

**Changes from the brief palette (documented as required):**

1. Added `emerald700`, because the brief emerald on ivory is 4.36:1, which fails AA for body text.
2. Muted Blue is restricted to decoration.
3. Added neutral and feedback tokens (warning `#8A5A00`, danger `#B3261E`, info `#34566E`).

### Category themes

| Theme                    | Accent (white text) | Tint      | Ink on tint      |
| ------------------------ | ------------------- | --------- | ---------------- |
| family (warm rose)       | `#A8435B` 5.8:1     | `#FBEFF2` | `#6E2236` 9.6:1  |
| business (navy + forest) | `#1F3A5F` 11.5:1    | `#EAF0F7` | `#142740` 13.1:1 |
| personal (muted violet)  | `#5E4F8C` 7.1:1     | `#F1EEF8` | `#3B3060` 10.3:1 |
| health (calm teal)       | `#0E7175` 5.8:1     | `#E5F4F3` | `#0A4F52` 8.2:1  |
| special (champagne)      | `#8A6420` 5.4:1     | `#FAF3E3` | `#5E4313` 8.3:1  |
| urgent (restrained red)  | `#B3261E` 6.5:1     | `#FDEDEB` | `#7A1B15` 9.3:1  |

`packages/design-system/tests/tokens.test.ts` enforces these ratios and the TS↔CSS sync.
Colour is never the only signal: every category has an icon and a text label.

## 3. Typography

- **IBM Plex Sans Thai** (SIL OFL 1.1), self-hosted via `@fontsource/ibm-plex-sans-thai`,
  weights 400/500/600/700, with fallbacks Noto Sans Thai → Leelawadee UI → Tahoma.
- Body line-height **1.65**, headings 1.35, plus 0.05em top padding on headings, so Thai
  above/below marks are never clipped.
- Scale (px): 13 (minimum) · 14 · 16 · 18 · 21 · 26 · 32 · 40 · display clamp(36–52).
- Times use **tabular lining numerals** (`.f-num`).
- Long Thai text wraps with `overflow-wrap: anywhere`.

## 4. Space, radius, elevation, motion

4 px grid (`--sp-1`…`--sp-16`); radius 8/12/18/26/pill; three warm, low-contrast shadows.
Motion is 140/220/360 ms with an ease-out curve, used only for state changes (selection, panel
open, preview update). Under `prefers-reduced-motion` all durations become 0 and the skeleton
shimmer stops.

## 5. Components (`src/components.css`, class prefix `f-`)

Buttons (primary, secondary, dark, ghost, danger, **create**, sm/lg/block, busy, disabled) ·
cards · fields, inputs, select, textarea, error · group chips (`aria-pressed`) · category badge ·
date/time block · segmented control · switch · notices (info/caution/block/success) ·
**prototype badge** (`.f-proto`, required on every simulated value) · empty/error/loading states
and skeleton · tab bar · focus ring (`:focus-visible`, 2 px emerald with ivory gap).

Touch targets are at least 44 px for primary controls. Compact chips are 36–40 px and always sit
in spaced groups.

## 6. Sally usage

Sally is an **original anthropomorphic car mascot** (owner direction, 2026-11-26). Canonical art:
`assets/mascot/reference/sally-reference-owner.png`. The full character sheet is in
[assets/README.md](../assets/README.md).

| Rendering                   | Where                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------- |
| Reference portrait (raster) | Welcome screen, showcase hero, About, Behind the Product                               |
| Avatar crop (raster, round) | LINE profile picture, chat avatar beside Flex previews, small identity spots (≥ 32 px) |
| Vector expressions (6)      | UI states: greeting, loading, empty, error, reminders, confirmation                    |

| Expression | Use                                                                           |
| ---------- | ----------------------------------------------------------------------------- |
| default    | Welcome, greetings                                                            |
| happy      | **Only** after a real, confirmed success (EP03+). Never for simulated actions |
| reminder   | Reminder cards, daily summary                                                 |
| thoughtful | Loading, checking, the simulated-confirmation screen                          |
| empty      | Empty day or list                                                             |
| error      | Failures and unavailable states                                               |

## 7. Approved decisions (owner, 2026-11-26)

1. **CSS custom properties are approved for EP00.** The system is framework-agnostic CSS
   custom properties plus a small component stylesheet. The same tokens are exported from
   TypeScript for the future Flex builder, which needs hex values, not classes. The app is
   **not** refactored into Tailwind just to match the original proposed stack. Tailwind may be
   mapped onto these variables later if a real need appears.
2. **React Hook Form, TanStack Query and Framer Motion stay deferred** until their own
   requirements arise: real form persistence (EP02/EP03), server data (EP02/EP03) and motion
   beyond CSS transitions (EP05, only if justified).
3. **Sally is a car mascot** that follows the owner-approved reference (§6).

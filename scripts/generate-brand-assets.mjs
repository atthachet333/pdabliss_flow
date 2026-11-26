#!/usr/bin/env node
/**
 * Generates FLOW's original SVG brand assets from code (editable source).
 *   npm run brand:generate
 *
 * Outputs:
 *   assets/brand/flow-symbol.svg, flow-wordmark.svg, flow-lockup.svg
 *   assets/mascot/sally-<expression>.svg  (6 expressions)
 *   assets/rich-menu/rich-menu-concept.svg (2500 × 1686, 6 areas)
 *
 * Sally is an ORIGINAL anthropomorphic car mascot for PDA BLISS FLOW. The canonical,
 * owner-approved design is assets/mascot/reference/sally-reference-owner.png; these
 * vectors follow it (pastel-blue bubble body, windshield face, clock crown + halo,
 * calendar headphones, emerald bow, heart headlights). No third-party character
 * artwork, logos or licensed designs are used, and no affiliation is implied.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = (rel, svg) => {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, svg.trim() + '\n', 'utf8');
  console.log('wrote', rel);
};

const C = {
  forest: '#0B211C',
  emerald: '#16836B',
  mint: '#A5EFCB',
  ivory: '#F8F7F2',
  sallyBlue: '#A8D2E8',
  ice: '#EAF5FC',
  silver: '#C8D9E6',
  deepBlue: '#34566E',
  mutedBlue: '#517F9F',
  ink: '#1F3445',
  rose: '#E9A9B6',
};

// ------------------------------------------------------------------ symbol
// An open "time ring" with an F whose bars read as clock hands — flow + time.
const symbolInner = (stroke = C.mint, ring = C.emerald) => `
  <path d="M46.5 14.6 A22 22 0 1 0 53.4 33" fill="none" stroke="${ring}" stroke-width="5" stroke-linecap="round"/>
  <path d="M25 44 V21 H41.5 M25 32.5 H36" fill="none" stroke="${stroke}" stroke-width="5.2" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="52.6" cy="22.6" r="3.4" fill="${stroke}"/>`;

const symbol = (size = 64) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64" role="img" aria-labelledby="t">
  <title id="t">FLOW symbol</title>
  <rect width="64" height="64" rx="18" fill="${C.forest}"/>
  ${symbolInner()}
</svg>`;

// ---------------------------------------------------------------- wordmark
const wordmarkPaths = (color, accent) => `
  <g fill="none" stroke="${color}" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M6 38 V6 H27 M6 21.5 H21"/>
    <path d="M40 6 V38 H58"/>
    <path d="M111 6 L119.5 38 L128.5 14 L137.5 38 L146 6"/>
  </g>
  <path d="M93.6 9.5 A16 16 0 1 0 100 22" fill="none" stroke="${color}" stroke-width="6.5" stroke-linecap="round"/>
  <circle cx="98.8" cy="12.4" r="3.6" fill="${accent}"/>`;

const wordmark = (color = C.forest, accent = C.emerald) => `
<svg xmlns="http://www.w3.org/2000/svg" width="304" height="88" viewBox="0 0 152 44" role="img" aria-labelledby="t">
  <title id="t">FLOW wordmark</title>
  ${wordmarkPaths(color, accent)}
</svg>`;

const lockup = () => `
<svg xmlns="http://www.w3.org/2000/svg" width="440" height="96" viewBox="0 0 220 48" role="img" aria-labelledby="t">
  <title id="t">PDA BLISS FLOW</title>
  <g transform="scale(0.75)"><rect width="64" height="64" rx="18" fill="${C.forest}"/>${symbolInner()}</g>
  <g transform="translate(62 2)">${wordmarkPaths(C.forest, C.emerald)}</g>
</svg>`;

// ------------------------------------------------------------------ Sally
// Owner-approved direction (2026-11-26): Sally is an adorable, original anthropomorphic
// compact car. Canonical reference: assets/mascot/reference/sally-reference-owner.png.
// These vector expressions follow that reference: pastel-blue bubble body, a face on the
// windshield with large emerald eyes, a silver clock crown with a mint halo, headphones
// with a calendar-check mark, an emerald bow with a heart gem, and heart headlights.
const S = {
  bodyTop: '#C9E1F2',
  body: '#A9CDE6',
  bodyShade: '#86B0CF',
  face: '#FBFAFF',
  faceShade: '#E6E4F3',
  eye: '#0F6B55',
  eyeDeep: '#0A3F33',
  lash: '#1C2430',
  silver: '#D9E3EC',
  silverDark: '#8FA3B5',
  emerald: '#16836B',
  emeraldDark: '#0E5E4C',
  glow: '#7FE3C0',
  ivory: '#FFFDF7',
  blush: '#F4A7B9',
  tire: '#2A323C',
};

const EXPRESSIONS = {
  default: { eyes: 'open', mouth: 'open-smile', brows: 'soft', badge: null, look: 0, lights: 'on' },
  happy: {
    eyes: 'closed-happy',
    mouth: 'big-smile',
    brows: 'raised',
    badge: 'check',
    look: 0,
    lights: 'on',
  },
  reminder: {
    eyes: 'open',
    mouth: 'small-o',
    brows: 'raised',
    badge: 'bell',
    look: 0,
    lights: 'on',
  },
  thoughtful: {
    eyes: 'open',
    mouth: 'flat',
    brows: 'thinking',
    badge: 'dots',
    look: -4,
    lights: 'on',
  },
  empty: {
    eyes: 'calm',
    mouth: 'small-smile',
    brows: 'soft',
    badge: 'leaf',
    look: 0,
    lights: 'soft',
  },
  error: {
    eyes: 'open',
    mouth: 'worried',
    brows: 'worried',
    badge: 'alert',
    look: 0,
    lights: 'dim',
  },
};

function heart(cx, cy, s, fill, extra = '') {
  // Heart centred on (cx, cy), roughly s wide.
  const h = s / 2;
  return `<path d="M${cx} ${cy + h * 0.9} C${cx - h * 1.4} ${cy - h * 0.1} ${cx - h * 0.9} ${cy - h * 1.2} ${cx} ${cy - h * 0.45} C${cx + h * 0.9} ${cy - h * 1.2} ${cx + h * 1.4} ${cy - h * 0.1} ${cx} ${cy + h * 0.9} Z" fill="${fill}" ${extra}/>`;
}

function sallyEyes(kind, look, irisId) {
  const L = 98 + look;
  const R = 142 + look;
  const y = 108;
  if (kind === 'closed-happy') {
    return `<path d="M${L - 11} ${y + 3} Q${L} ${y - 10} ${L + 11} ${y + 3} M${R - 11} ${y + 3} Q${R} ${y - 10} ${R + 11} ${y + 3}" fill="none" stroke="${S.lash}" stroke-width="4" stroke-linecap="round"/>`;
  }
  if (kind === 'calm') {
    return `<path d="M${L - 10} ${y} Q${L} ${y + 8} ${L + 10} ${y} M${R - 10} ${y} Q${R} ${y + 8} ${R + 10} ${y}" fill="none" stroke="${S.lash}" stroke-width="4" stroke-linecap="round"/>
      <path d="M${L - 12} ${y - 1} l-4 -3 M${R + 12} ${y - 1} l4 -3" stroke="${S.lash}" stroke-width="2.4" stroke-linecap="round"/>`;
  }
  const eye = (cx) => `
      <ellipse cx="${cx}" cy="${y}" rx="15" ry="17" fill="#fff"/>
      <ellipse cx="${cx + look * 0.4}" cy="${y + 1.5}" rx="12.5" ry="15" fill="url(#${irisId})"/>
      <ellipse cx="${cx + look * 0.4}" cy="${y + 3}" rx="6" ry="7.5" fill="${S.eyeDeep}"/>
      ${heart(cx + 4.5 + look * 0.4, y - 5, 8, '#fff')}
      <circle cx="${cx - 5 + look * 0.4}" cy="${y + 7}" r="2.2" fill="#fff" opacity="0.9"/>
      <path d="M${cx - 15.5} ${y - 6} Q${cx} ${y - 22} ${cx + 15.5} ${y - 6}" fill="none" stroke="${S.lash}" stroke-width="4" stroke-linecap="round"/>`;
  const lashes = `<path d="M${L - 15} ${y - 7} l-6 -4 M${L - 15} ${y - 1} l-6 -1 M${R + 15} ${y - 7} l6 -4 M${R + 15} ${y - 1} l6 -1" stroke="${S.lash}" stroke-width="2.4" stroke-linecap="round"/>`;
  return eye(L) + eye(R) + lashes;
}

function sallyBrows(kind) {
  const p = {
    soft: 'M86 84 Q98 78 110 82 M130 82 Q142 78 154 84',
    raised: 'M86 81 Q98 73 110 78 M130 78 Q142 73 154 81',
    thinking: 'M86 83 Q98 80 110 83 M130 78 Q142 73 154 79',
    worried: 'M87 85 Q99 84 109 77 M131 77 Q141 84 153 85',
  }[kind];
  return `<path d="${p}" fill="none" stroke="${S.lash}" stroke-width="2.8" stroke-linecap="round"/>`;
}

function sallyMouth(kind) {
  switch (kind) {
    case 'big-smile':
      return `<path d="M110 128 Q120 142 130 128 Z" fill="#B8435E"/><path d="M114 134 Q120 139 126 134" fill="none" stroke="${S.blush}" stroke-width="3" stroke-linecap="round"/>`;
    case 'small-o':
      return `<ellipse cx="120" cy="132" rx="4" ry="5" fill="#B8435E"/>`;
    case 'flat':
      return `<path d="M114 133 Q121 134 127 131" fill="none" stroke="${S.lash}" stroke-width="3" stroke-linecap="round"/>`;
    case 'small-smile':
      return `<path d="M115 130 Q120 135 125 130" fill="none" stroke="${S.lash}" stroke-width="3" stroke-linecap="round"/>`;
    case 'worried':
      return `<path d="M113 135 Q120 128 127 135" fill="none" stroke="${S.lash}" stroke-width="3" stroke-linecap="round"/>`;
    default:
      return `<path d="M112 128 Q120 139 128 128 Z" fill="#B8435E"/><path d="M115 132 Q120 136 125 132" fill="none" stroke="${S.blush}" stroke-width="2.6" stroke-linecap="round"/>`;
  }
}

function sallyBadge(kind) {
  if (!kind) return '';
  const disc = (fill) =>
    `<circle cx="204" cy="40" r="20" fill="${fill}" stroke="#fff" stroke-width="4"/>`;
  switch (kind) {
    case 'check':
      return `${disc(S.emerald)}<path d="M195 40 L202 47 L213 34" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    case 'bell':
      return `${disc('#34566E')}<path d="M195 47 H213 L210.5 43 V38 A6.5 6.5 0 0 0 197.5 38 V43 Z" fill="${S.ivory}"/><circle cx="204" cy="50" r="2.6" fill="${S.ivory}"/>`;
    case 'dots':
      return `${disc('#EAF5FC')}<circle cx="195.5" cy="40" r="3.2" fill="#34566E"/><circle cx="204" cy="40" r="3.2" fill="#34566E"/><circle cx="212.5" cy="40" r="3.2" fill="#34566E"/>`;
    case 'leaf':
      return `${disc('#A5EFCB')}<path d="M196 48 Q196 31 213 31 Q213 48 198 48 Z" fill="${S.emerald}"/><path d="M198 46 L208 37" stroke="#A5EFCB" stroke-width="2" stroke-linecap="round"/>`;
    case 'alert':
      return `${disc('#B3261E')}<path d="M204 29 V43" stroke="#fff" stroke-width="4.5" stroke-linecap="round"/><circle cx="204" cy="50" r="2.8" fill="#fff"/>`;
    default:
      return '';
  }
}

/** Sally's body + face as an SVG group (reused by the rich menu). */
function sallyGroup(expr, idPrefix = 's') {
  const e = EXPRESSIONS[expr];
  const lightFill = e.lights === 'dim' ? '#C7CED6' : '#FFFFFF';
  const lightGlow = e.lights === 'dim' ? 0 : e.lights === 'soft' ? 0.35 : 0.7;
  const ids = (n) => `${idPrefix}-${n}`;
  return `
  <defs>
    <linearGradient id="${ids('body')}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${S.bodyTop}"/><stop offset="0.6" stop-color="${S.body}"/><stop offset="1" stop-color="${S.bodyShade}"/>
    </linearGradient>
    <linearGradient id="${ids('face')}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${S.face}"/><stop offset="1" stop-color="${S.faceShade}"/>
    </linearGradient>
    <linearGradient id="${ids('silver')}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#F5F8FB"/><stop offset="1" stop-color="${S.silver}"/>
    </linearGradient>
    <radialGradient id="${ids('iris')}" cx="0.45" cy="0.35" r="0.7">
      <stop offset="0" stop-color="#3FB894"/><stop offset="0.55" stop-color="${S.eye}"/><stop offset="1" stop-color="${S.eyeDeep}"/>
    </radialGradient>
  </defs>
  <!-- ground shadow -->
  <ellipse cx="120" cy="226" rx="92" ry="7" fill="#0B211C" opacity="0.10"/>
  <!-- wheels -->
  <rect x="48" y="190" width="34" height="34" rx="12" fill="${S.tire}"/>
  <rect x="158" y="190" width="34" height="34" rx="12" fill="${S.tire}"/>
  <circle cx="65" cy="210" r="9" fill="url(#${ids('silver')})"/>
  <circle cx="175" cy="210" r="9" fill="url(#${ids('silver')})"/>
  ${heart(65, 210, 7, S.emerald)}${heart(175, 210, 7, S.emerald)}
  <!-- mirrors -->
  <ellipse cx="40" cy="128" rx="11" ry="8" fill="url(#${ids('silver')})" stroke="${S.silverDark}" stroke-width="1.2"/>
  <ellipse cx="200" cy="128" rx="11" ry="8" fill="url(#${ids('silver')})" stroke="${S.silverDark}" stroke-width="1.2"/>
  <!-- body -->
  <path d="M30 186 C26 158 36 134 60 124 C66 92 88 66 120 64 C152 66 174 92 180 124 C204 134 214 158 210 186 C209 199 199 206 186 206 L54 206 C41 206 31 199 30 186 Z" fill="url(#${ids('body')})"/>
  <path d="M70 76 C88 62 112 58 134 61" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity="0.55"/>
  <!-- windshield face -->
  <path d="M62 114 C63 84 86 70 120 70 C154 70 177 84 178 114 C178 136 165 146 148 146 L92 146 C75 146 62 136 62 114 Z" fill="url(#${ids('face')})" stroke="#9FC2DB" stroke-width="2"/>
  <ellipse cx="80" cy="128" rx="10" ry="5.5" fill="${S.blush}" opacity="0.55"/>
  <ellipse cx="160" cy="128" rx="10" ry="5.5" fill="${S.blush}" opacity="0.55"/>
  ${sallyBrows(e.brows)}
  ${sallyEyes(e.eyes, e.look, ids('iris'))}
  ${sallyMouth(e.mouth)}
  <!-- headphones: silver band over the roof, emerald cups; right cup carries the calendar mark -->
  <path d="M58 112 C58 70 86 50 120 50 C154 50 182 70 182 112" fill="none" stroke="url(#${ids('silver')})" stroke-width="6" stroke-linecap="round"/>
  <circle cx="57" cy="114" r="14" fill="${S.emerald}" stroke="url(#${ids('silver')})" stroke-width="4"/>
  <circle cx="183" cy="114" r="14" fill="${S.emerald}" stroke="url(#${ids('silver')})" stroke-width="4"/>
  <circle cx="57" cy="114" r="7" fill="none" stroke="#DFFBF0" stroke-width="1.6" opacity="0.8"/>
  <rect x="176" y="107" width="14" height="13" rx="2.5" fill="none" stroke="#DFFBF0" stroke-width="1.8"/>
  <path d="M176 111 H190 M179.5 105 V108.5 M186.5 105 V108.5 M179.8 115.5 L182.3 118 L186.6 113.6" fill="none" stroke="#DFFBF0" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  <!-- bow with heart gem -->
  <path d="M120 153 C100 136 74 140 78 158 C82 172 104 166 120 157 Z" fill="${S.emerald}"/>
  <path d="M120 153 C140 136 166 140 162 158 C158 172 136 166 120 157 Z" fill="${S.emerald}"/>
  <path d="M116 156 L104 176 L112 175 L118 168 Z M124 156 L136 176 L128 175 L122 168 Z" fill="${S.emeraldDark}"/>
  <circle cx="120" cy="154" r="7.5" fill="url(#${ids('silver')})"/>
  ${heart(120, 154.5, 9, '#2FB287')}
  <!-- heart headlights -->
  <circle cx="62" cy="168" r="17" fill="url(#${ids('silver')})"/>
  <circle cx="178" cy="168" r="17" fill="url(#${ids('silver')})"/>
  <circle cx="62" cy="168" r="13" fill="${e.lights === 'dim' ? '#AEB9C4' : S.glow}" opacity="${e.lights === 'dim' ? 1 : 0.55 + lightGlow * 0.45}"/>
  <circle cx="178" cy="168" r="13" fill="${e.lights === 'dim' ? '#AEB9C4' : S.glow}" opacity="${e.lights === 'dim' ? 1 : 0.55 + lightGlow * 0.45}"/>
  <circle cx="62" cy="168" r="10" fill="${e.lights === 'dim' ? '#C9D1D9' : '#E9FFF6'}"/>
  <circle cx="178" cy="168" r="10" fill="${e.lights === 'dim' ? '#C9D1D9' : '#E9FFF6'}"/>
  ${heart(62, 168, 15, lightFill)}${heart(178, 168, 15, lightFill)}
  <!-- plate + glow strip -->
  <path d="M40 192 Q120 204 200 192" fill="none" stroke="${S.glow}" stroke-width="3.5" stroke-linecap="round" opacity="${lightGlow + 0.2}"/>
  <rect x="96" y="178" width="48" height="20" rx="6" fill="${S.ivory}" stroke="url(#${ids('silver')})" stroke-width="2.5"/>
  <g transform="translate(103.5 182.6) scale(0.218)">${wordmarkPaths(C.forest, C.emerald)}</g>
  <!-- clock crown with mint halo -->
  <ellipse cx="120" cy="56" rx="64" ry="12" fill="none" stroke="${S.glow}" stroke-width="3.5" opacity="0.85"/>
  <path d="M96 30 C90 24 92 18 98 20 M144 30 C150 24 148 18 142 20" fill="none" stroke="url(#${ids('silver')})" stroke-width="4" stroke-linecap="round"/>
  <circle cx="120" cy="38" r="22" fill="${S.ivory}" stroke="url(#${ids('silver')})" stroke-width="5"/>
  <circle cx="120" cy="38" r="22" fill="none" stroke="${S.silverDark}" stroke-width="1"/>
  <path d="M120 22 V25 M120 51 V54 M104 38 H107 M133 38 H136" stroke="${S.emeraldDark}" stroke-width="2" stroke-linecap="round"/>
  <path d="${expr === 'reminder' ? 'M120 38 L120 26 M120 38 L129 43' : 'M120 38 L111 31 M120 38 L131 34'}" stroke="${S.emeraldDark}" stroke-width="2.8" stroke-linecap="round"/>
  <circle cx="120" cy="38" r="2.4" fill="${S.emeraldDark}"/>
  ${heart(120, 13, 10, '#2FB287', `stroke="url(#${ids('silver')})" stroke-width="1.6"`)}
  ${heart(120, 62, 8, '#2FB287')}
  ${sallyBadge(e.badge)}`;
}

function sally(expr) {
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240" role="img" aria-labelledby="t">
  <title id="t">Sally — ${expr}</title>
  ${sallyGroup(expr, `s-${expr}`)}
</svg>`;
}

// --------------------------------------------------------------- rich menu
// Large rich menu: 2500 × 1686, 3 × 2 grid. Requirements (JPEG/PNG, ≤ 1 MB,
// 2500×1686 etc.) are recorded in docs/LINE-INTEGRATION-PLAN.md.
const RM = { w: 2500, h: 1686, cols: 3, rows: 2 };
const cellW = [833, 834, 833];
const cellH = 843;
const ACTIONS = [
  { th: 'วันนี้', en: 'TODAY', icon: 'sun' },
  { th: 'เพิ่มนัดหมาย', en: 'NEW APPOINTMENT', icon: 'plus', hero: true },
  { th: 'ปฏิทิน', en: 'CALENDAR', icon: 'calendar' },
  { th: 'กลุ่มของฉัน', en: 'MY GROUPS', icon: 'users' },
  { th: 'ประวัติ', en: 'HISTORY', icon: 'history' },
  { th: 'ตั้งค่า', en: 'SETTINGS', icon: 'settings' },
];

function rmIcon(kind, cx, cy, color) {
  const stroke = (w = 18) =>
    `fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
  const s = stroke();
  switch (kind) {
    case 'sun':
      return `<g ${s}><circle cx="${cx}" cy="${cy}" r="40"/>${[0, 45, 90, 135, 180, 225, 270, 315]
        .map((a) => {
          const r = (a * Math.PI) / 180;
          return `<path d="M${cx + Math.cos(r) * 68} ${cy + Math.sin(r) * 68} L${cx + Math.cos(r) * 92} ${cy + Math.sin(r) * 92}"/>`;
        })
        .join('')}</g>`;
    case 'plus':
      return `<g ${stroke(24)}><path d="M${cx} ${cy - 62} V${cy + 62} M${cx - 62} ${cy} H${cx + 62}"/></g>`;
    case 'calendar':
      return `<g ${s}><rect x="${cx - 86}" y="${cy - 70}" width="172" height="150" rx="26"/><path d="M${cx - 86} ${cy - 22} H${cx + 86} M${cx - 44} ${cy - 96} V${cy - 50} M${cx + 44} ${cy - 96} V${cy - 50}"/></g><circle cx="${cx + 34}" cy="${cy + 32}" r="14" fill="${color}"/>`;
    case 'users':
      return `<g ${s}><circle cx="${cx - 28}" cy="${cy - 34}" r="36"/><path d="M${cx - 102} ${cy + 78} C${cx - 96} ${cy + 22} ${cx + 40} ${cy + 22} ${cx + 46} ${cy + 78}"/><path d="M${cx + 46} ${cy - 66} A36 36 0 0 1 ${cx + 46} ${cy - 2} M${cx + 74} ${cy + 26} C${cx + 98} ${cy + 36} ${cx + 106} ${cy + 56} ${cx + 106} ${cy + 78}"/></g>`;
    case 'history':
      return `<g ${s}><path d="M${cx - 80} ${cy} A80 80 0 1 0 ${cx - 56} ${cy - 56}"/><path d="M${cx - 92} ${cy - 76} L${cx - 56} ${cy - 56} L${cx - 40} ${cy - 96}"/><path d="M${cx} ${cy - 44} V${cy} L${cx + 32} ${cy + 22}"/></g>`;
    case 'settings':
      return `<g ${s}><circle cx="${cx}" cy="${cy}" r="30"/><path d="M${cx} ${cy - 88} V${cy - 62} M${cx} ${cy + 62} V${cy + 88} M${cx - 88} ${cy} H${cx - 62} M${cx + 62} ${cy} H${cx + 88} M${cx - 62} ${cy - 62} L${cx - 44} ${cy - 44} M${cx + 44} ${cy + 44} L${cx + 62} ${cy + 62} M${cx + 62} ${cy - 62} L${cx + 44} ${cy - 44} M${cx - 44} ${cy + 44} L${cx - 62} ${cy + 62}"/><circle cx="${cx}" cy="${cy}" r="62"/></g>`;
    default:
      return '';
  }
}

function richMenu() {
  let cells = '';
  let x = 0;
  ACTIONS.forEach((a, i) => {
    const col = i % RM.cols;
    const row = Math.floor(i / RM.cols);
    if (col === 0) x = 0;
    const w = cellW[col];
    const y = row * cellH;
    const cx = x + w / 2;
    const hero = Boolean(a.hero);
    const bg = hero ? C.forest : row === 0 ? C.ivory : '#FFFFFF';
    const fg = hero ? C.ivory : C.forest;
    const iconColor = hero ? C.mint : C.emerald;
    cells += `
    <g>
      <rect x="${x}" y="${y}" width="${w}" height="${cellH}" fill="${bg}"/>
      ${hero ? `<circle cx="${cx}" cy="${y + 330}" r="150" fill="${C.emerald}"/><circle cx="${cx}" cy="${y + 330}" r="190" fill="none" stroke="${C.mint}" stroke-opacity="0.35" stroke-width="6"/>` : `<circle cx="${cx}" cy="${y + 330}" r="150" fill="${row === 0 ? '#EEF6F2' : C.ice}"/>`}
      ${rmIcon(a.icon, cx, y + 330, hero ? C.ivory : iconColor)}
      <text x="${cx}" y="${y + 628}" text-anchor="middle" font-family="'IBM Plex Sans Thai','Noto Sans Thai','Leelawadee UI',sans-serif" font-weight="600" font-size="${hero ? 112 : 104}" fill="${fg}">${a.th}</text>
      <text x="${cx}" y="${y + 720}" text-anchor="middle" font-family="'IBM Plex Sans Thai','Noto Sans Thai',sans-serif" font-weight="600" font-size="44" letter-spacing="9" fill="${hero ? C.mint : C.mutedBlue}">${a.en}</text>
    </g>`;
    x += w;
  });
  const grid = `<g stroke="${'#E3E1D8'}" stroke-width="4">
      <path d="M833 0 V1686 M1667 0 V1686"/><path d="M0 843 H2500"/></g>`;
  // Tasteful branding: the FLOW symbol + wordmark sit quietly in the hero cell's top corner.
  const brandMark = `<g transform="translate(873 44) scale(1.25)">${symbolInner()}</g><g transform="translate(965 64) scale(1.05)" opacity="0.92">${wordmarkPaths(C.ivory, C.mint)}</g>`;
  // Sally greets from the hero cell's top-right corner (vector, so it scales cleanly).
  const sallyMark = `<g transform="translate(1456 34) scale(0.82)"><circle cx="120" cy="120" r="116" fill="#EAF5FC"/>${sallyGroup('default', 'rm')}</g>`;
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="2500" height="1686" viewBox="0 0 2500 1686" role="img" aria-labelledby="t">
  <title id="t">FLOW rich menu concept — 6 actions (prototype, not uploaded)</title>
  ${cells}
  ${grid}
  ${brandMark}
  ${sallyMark}
</svg>`;
}

out('assets/brand/flow-symbol.svg', symbol());
out('assets/brand/flow-wordmark.svg', wordmark());
out('assets/brand/flow-wordmark-ivory.svg', wordmark(C.ivory, C.mint));
out('assets/brand/flow-lockup.svg', lockup());
for (const expr of Object.keys(EXPRESSIONS)) out(`assets/mascot/sally-${expr}.svg`, sally(expr));
out('assets/rich-menu/rich-menu-concept.svg', richMenu());

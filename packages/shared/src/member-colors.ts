/**
 * Per-workspace member identity colours (EP02 consolidated).
 *
 * Three colour systems stay separate and never substitute for each other:
 *   1. member identity colour  — this palette, chosen by each member per workspace
 *   2. appointment category    — design-system category themes (family, business, …)
 *   3. workspace identity      — workspace kind label/icon
 *
 * Only these token ids are ever stored or rendered (no free-form CSS reaches the database or
 * the DOM). Every swatch carries white text at ≥ 4.5:1 and is always paired with the member's
 * name or initial — colour is never the only signal.
 */
export const MEMBER_COLORS = [
  { id: 'jade', hex: '#0F7B5F', labelTh: 'เขียวหยก' },
  { id: 'ocean', hex: '#1D5F8C', labelTh: 'น้ำเงินทะเล' },
  { id: 'plum', hex: '#7A3E7E', labelTh: 'ม่วงพลัม' },
  { id: 'coral', hex: '#B13F2A', labelTh: 'ส้มอิฐ' },
  { id: 'amber', hex: '#8A5A00', labelTh: 'อำพัน' },
  { id: 'teal', hex: '#0E6B74', labelTh: 'ฟ้าอมเขียว' },
  { id: 'rose', hex: '#A3385A', labelTh: 'ชมพูกุหลาบ' },
  { id: 'indigo', hex: '#4A4FA3', labelTh: 'คราม' },
  { id: 'olive', hex: '#58661C', labelTh: 'เขียวมะกอก' },
  { id: 'slate', hex: '#4B5A66', labelTh: 'เทาหินชนวน' },
] as const;

export type MemberColorId = (typeof MEMBER_COLORS)[number]['id'];
export const MEMBER_COLOR_IDS = MEMBER_COLORS.map((c) => c.id) as unknown as readonly [
  MemberColorId,
  ...MemberColorId[],
];

const BY_ID = new Map<string, (typeof MEMBER_COLORS)[number]>(MEMBER_COLORS.map((c) => [c.id, c]));

export function isMemberColorId(value: unknown): value is MemberColorId {
  return typeof value === 'string' && BY_ID.has(value);
}

export function memberColorHex(id: MemberColorId): string {
  return (BY_ID.get(id) as (typeof MEMBER_COLORS)[number]).hex;
}

/** Deterministic default for a (workspace, user) pair — stable across devices and sessions. */
export function defaultMemberColor(workspaceId: string, userId: string): MemberColorId {
  let h = 2166136261;
  for (const ch of `${workspaceId}:${userId}`) {
    h ^= ch.codePointAt(0) as number;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return MEMBER_COLORS[h % MEMBER_COLORS.length]!.id;
}

/** Stored token (validated) or the default. Unknown stored values fall back safely. */
export function effectiveMemberColor(
  stored: string | null | undefined,
  workspaceId: string,
  userId: string,
): MemberColorId {
  return isMemberColorId(stored) ? stored : defaultMemberColor(workspaceId, userId);
}

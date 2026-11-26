/**
 * Destination-selection rules (pure). These produce the warnings shown before a
 * user confirms where Sally will notify. Authorization itself is enforced server-side
 * from EP03; this module only decides what the user must be told.
 */
import { CATEGORIES, type CategoryId, type DestinationOption } from './domain.js';

export const BROAD_GROUP_THRESHOLD = 20;

export type DestinationWarningCode =
  | 'no-destination'
  | 'group-visible-to-all'
  | 'broad-group'
  | 'sensitive-in-group'
  | 'sensitive-in-company-group'
  | 'mixed-workspaces'
  | 'unknown-member-count'
  | 'destination-inactive'
  | 'cannot-revoke';

export interface DestinationWarning {
  code: DestinationWarningCode;
  severity: 'info' | 'caution' | 'block';
  destinationId?: string;
  messageTh: string;
}

export interface DestinationEvaluation {
  warnings: DestinationWarning[];
  /** True when nothing blocks confirmation. */
  canConfirm: boolean;
  /** Suggest the minimal-disclosure template ("คุณมีนัดหมายสำคัญเวลา …"). */
  suggestMinimalDisclosure: boolean;
}

export type DestinationAvailability = 'available' | 'no-permission' | 'not-active';

/**
 * Whether the current user may choose this destination. Viewers cannot notify;
 * inactive destinations (pending, removed, disabled…) cannot be chosen at all.
 * Server-side enforcement (EP03) must repeat this check — the UI is not a boundary.
 */
export function destinationAvailability(
  d: Pick<DestinationOption, 'lifecycle' | 'viewerRole'>,
): DestinationAvailability {
  if (d.lifecycle !== 'active') return 'not-active';
  if (d.viewerRole === 'viewer') return 'no-permission';
  return 'available';
}

/** The safe default: notify only the creator privately. */
export function defaultDestinationIds(options: readonly DestinationOption[]): string[] {
  const self = options.find((o) => o.kind === 'private-self' && o.lifecycle === 'active');
  return self ? [self.id] : [];
}

export function evaluateDestinations(
  category: CategoryId,
  selected: readonly DestinationOption[],
): DestinationEvaluation {
  const warnings: DestinationWarning[] = [];
  const sensitive = CATEGORIES[category].sensitive;
  const groups = selected.filter((d) => d.kind === 'line-group');

  if (selected.length === 0) {
    warnings.push({
      code: 'no-destination',
      severity: 'block',
      messageTh: 'กรุณาเลือกปลายทางการแจ้งเตือนอย่างน้อย 1 รายการ',
    });
  }

  for (const d of selected) {
    if (d.lifecycle !== 'active') {
      warnings.push({
        code: 'destination-inactive',
        severity: 'block',
        destinationId: d.id,
        messageTh: `${d.displayName} ยังไม่พร้อมรับการแจ้งเตือน`,
      });
    }
  }

  for (const g of groups) {
    warnings.push({
      code: 'group-visible-to-all',
      severity: 'info',
      destinationId: g.id,
      messageTh: `ข้อความในกลุ่ม “${g.displayName}” สมาชิกปัจจุบันทุกคนจะเห็น`,
    });
    if (g.memberCount === null) {
      warnings.push({
        code: 'unknown-member-count',
        severity: 'caution',
        destinationId: g.id,
        messageTh: `ยังไม่ทราบจำนวนสมาชิกของ “${g.displayName}” จึงประเมินโควตาได้ไม่ครบ`,
      });
    } else if (g.memberCount > BROAD_GROUP_THRESHOLD) {
      warnings.push({
        code: 'broad-group',
        severity: 'caution',
        destinationId: g.id,
        messageTh: `“${g.displayName}” มีสมาชิก ${g.memberCount} คน โปรดตรวจสอบว่าทุกคนควรเห็นนัดนี้`,
      });
    }
    if (sensitive && g.workspaceKind === 'company') {
      warnings.push({
        code: 'sensitive-in-company-group',
        severity: 'caution',
        destinationId: g.id,
        messageTh: `นัดหมวด “${CATEGORIES[category].labelTh}” กำลังจะแจ้งในกลุ่มบริษัท โปรดตรวจสอบความเหมาะสม`,
      });
    }
  }

  if (sensitive && groups.length > 0) {
    warnings.push({
      code: 'sensitive-in-group',
      severity: 'caution',
      messageTh: 'แนะนำให้ใช้โหมดแจ้งแบบย่อ เพื่อไม่เปิดเผยรายละเอียดในกลุ่ม',
    });
  }

  const workspaceKinds = new Set(groups.map((g) => g.workspaceKind));
  if (workspaceKinds.size > 1) {
    warnings.push({
      code: 'mixed-workspaces',
      severity: 'info',
      messageTh: 'แต่ละกลุ่มจะได้รับข้อความแยกกัน และจะไม่เห็นว่ามีกลุ่มอื่นได้รับด้วย',
    });
  }

  if (groups.length > 0) {
    warnings.push({
      code: 'cannot-revoke',
      severity: 'info',
      messageTh: 'ข้อความที่ส่งเข้ากลุ่มแล้วไม่สามารถเรียกคืนหรือซ่อนจากสมาชิกได้',
    });
  }

  return {
    warnings,
    canConfirm: !warnings.some((w) => w.severity === 'block'),
    suggestMinimalDisclosure: sensitive && groups.length > 0,
  };
}

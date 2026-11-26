/**
 * EP00 MOCK FIXTURES — generic demonstration data only.
 * No real family, medical or employee information. Nothing here is persisted
 * or sent anywhere. Every screen that uses these values is labelled as simulated.
 */
import {
  addDaysToLocalDate,
  DEFAULT_TIMEZONE,
  toLocalDateString,
  type CategoryId,
  type DestinationOption,
  type QuotaSnapshot,
} from '@flow/shared';

export const MOCK_TIMEZONE = DEFAULT_TIMEZONE;

export const MOCK_DESTINATIONS: DestinationOption[] = [
  {
    id: 'dest-self',
    kind: 'private-self',
    displayName: 'แชทส่วนตัวกับ Sally',
    workspaceLabel: 'ส่วนตัว',
    workspaceKind: 'personal',
    memberCount: 1,
    lifecycle: 'active',
    viewerRole: 'system-owner',
  },
  {
    id: 'dest-family',
    kind: 'line-group',
    displayName: 'ครอบครัว (ตัวอย่าง)',
    workspaceLabel: 'ครอบครัว',
    workspaceKind: 'family',
    memberCount: 4,
    lifecycle: 'active',
    viewerRole: 'workspace-admin',
  },
  {
    id: 'dest-team',
    kind: 'line-group',
    displayName: 'ทีมงานบริษัท (ตัวอย่าง)',
    workspaceLabel: 'บริษัท',
    workspaceKind: 'company',
    memberCount: 18,
    lifecycle: 'active',
    viewerRole: 'workspace-admin',
  },
  {
    id: 'dest-exec',
    kind: 'line-group',
    displayName: 'ผู้บริหาร (ตัวอย่าง)',
    workspaceLabel: 'บริษัท',
    workspaceKind: 'company',
    memberCount: 5,
    lifecycle: 'active',
    viewerRole: 'member',
  },
  {
    id: 'dest-all-staff',
    kind: 'line-group',
    displayName: 'พนักงานทั้งหมด (ตัวอย่าง)',
    workspaceLabel: 'บริษัท',
    workspaceKind: 'company',
    memberCount: 42,
    lifecycle: 'active',
    viewerRole: 'viewer',
  },
  {
    id: 'dest-person-a',
    kind: 'individual',
    displayName: 'คุณมาลี (ตัวอย่าง)',
    workspaceLabel: 'ผู้รับรายบุคคล',
    workspaceKind: 'shared',
    memberCount: 1,
    lifecycle: 'active',
    viewerRole: 'member',
  },
  {
    id: 'dest-pending',
    kind: 'line-group',
    displayName: 'กลุ่มใหม่ (รอยืนยัน)',
    workspaceLabel: 'ยังไม่ผูกพื้นที่งาน',
    workspaceKind: 'shared',
    memberCount: null,
    lifecycle: 'pending-registration',
    viewerRole: 'system-owner',
  },
];

/** Planning assumption only (Thai free plan, unverified against the real account). */
export const MOCK_QUOTA: QuotaSnapshot = {
  monthlyLimit: 300,
  consumedThisMonth: 96,
  reservedThisMonth: 48,
  safetyReserve: 30,
};

export interface MockAppointment {
  id: string;
  title: string;
  category: CategoryId;
  localDate: string;
  localTime: string;
  allDay: boolean;
  location?: string;
  destinationId: string;
}

/** Generic appointments positioned relative to "today" so the dashboard always looks plausible. */
export function mockAppointments(now: Date): MockAppointment[] {
  const today = toLocalDateString(now, MOCK_TIMEZONE);
  const tomorrow = addDaysToLocalDate(today, 1);
  const in3 = addDaysToLocalDate(today, 3);
  return [
    {
      id: 'a1',
      title: 'ประชุมทีมประจำสัปดาห์',
      category: 'business',
      localDate: today,
      localTime: '09:30',
      allDay: false,
      location: 'ห้องประชุมใหญ่',
      destinationId: 'dest-team',
    },
    {
      id: 'a2',
      title: 'รับเอกสารที่สำนักงานเขต',
      category: 'personal',
      localDate: today,
      localTime: '13:00',
      allDay: false,
      destinationId: 'dest-self',
    },
    {
      id: 'a3',
      title: 'ตรวจสุขภาพประจำปี',
      category: 'health',
      localDate: today,
      localTime: '16:30',
      allDay: false,
      location: 'คลินิกตัวอย่าง',
      destinationId: 'dest-family',
    },
    {
      id: 'a4',
      title: 'เรียนออนไลน์ เรื่องระบบเครือข่าย',
      category: 'personal',
      localDate: today,
      localTime: '19:30',
      allDay: false,
      destinationId: 'dest-self',
    },
    {
      id: 'a5',
      title: 'วันเกิดสมาชิกครอบครัว',
      category: 'special',
      localDate: tomorrow,
      localTime: '00:00',
      allDay: true,
      destinationId: 'dest-family',
    },
    {
      id: 'a6',
      title: 'ส่งรายงานประจำเดือน',
      category: 'urgent',
      localDate: in3,
      localTime: '17:00',
      allDay: false,
      destinationId: 'dest-exec',
    },
  ];
}

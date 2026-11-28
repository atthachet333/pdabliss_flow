/**
 * Typed /api/v1 calls for the LIFF application. All authorization is enforced by the server;
 * the UI only hides what the server already refuses. No request is queued or replayed
 * offline: a network failure surfaces as an error the user can retry explicitly.
 */
import type {
  ActivityDto,
  AdminOverviewDto,
  FriendsDto,
  HealthDto,
  MemberColorId,
  NotificationOverviewDto,
  QuotaDto,
  SeriesScope,
  AppointmentDetailDto,
  AppointmentInputDraft,
  AppointmentSummaryDto,
  DestinationOptionDto,
  FlexPreviewModel,
  MeDto,
  PageDto,
  PreferencesDto,
  QuotaEstimate,
  WorkspaceKindDto,
  WorkspaceRoleDto,
  WorkspaceSummaryDto,
} from '@flow/shared';
import type { FlowApiClient } from '../auth/api-client';
import type { LineStatus } from '../auth/types';

export type Role = WorkspaceRoleDto;

export interface TodayDto {
  date: string;
  timeZone: string;
  today: AppointmentSummaryDto[];
  next: AppointmentSummaryDto | null;
  upcoming: AppointmentSummaryDto[];
  reminders: { scheduledNext7Days: number; deliveryEnabled: boolean };
}

export interface CalendarDto {
  from: string;
  to: string;
  items: AppointmentSummaryDto[];
  days: Record<string, number>;
  truncated: boolean;
}

export interface WorkspaceDetailDto {
  workspace: {
    id: string;
    name: string;
    kind: WorkspaceKindDto;
    version: number;
    createdAt: string;
  };
  myRole: Role;
  can: {
    edit: boolean;
    archive: boolean;
    manageMembers: boolean;
    leave: boolean;
    createAppointments: boolean;
  };
  members: {
    userId: string;
    displayName: string;
    role: Role;
    me: boolean;
    color: MemberColorId;
    customColor: boolean;
  }[];
  destinations: { id: string; label: string; status: string; audienceSize: number | null }[];
}

export interface AppointmentEventDto {
  type: string;
  fields: string[];
  actor: string | null;
  at: string;
}

export interface PreviewDto {
  preview: true;
  model: FlexPreviewModel;
  issues: string[];
  fireAt: string;
  fireAtLocal: string;
}

export interface EstimateDto {
  estimate: QuotaEstimate;
  quotaKnown: boolean;
  scheduledReminders: number;
}

export interface AdminUserDto {
  id: string;
  displayName: string;
  status: MeDto['user']['status'];
  globalRole: MeDto['user']['globalRole'];
  createdAt?: string;
  lastLoginAt?: string | null;
}

export interface AccessRequestDto {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  message: string | null;
  createdAt: string;
  decidedAt?: string | null;
  maskedLineId?: string | null;
  user: AdminUserDto | null;
  viaInvitation: boolean;
  target: { workspaceId: string; workspaceName: string; role: Role | null } | null;
}

export interface AdminUserDetailDto {
  user: AdminUserDto;
  maskedLineId?: string | null;
  openSessions?: number;
  statusChangedAt?: string | null;
  can: { administer: boolean; changeRole: boolean };
  memberships: { workspaceId: string; workspaceName: string; kind: WorkspaceKindDto; role: Role }[];
  history: { action: string; at: string; meta: Record<string, unknown> | null }[];
}

export interface InvitationDto {
  id: string;
  workspaceId: string;
  workspaceName: string;
  role: Role;
  note: string | null;
  state: 'valid' | 'used' | 'revoked' | 'expired';
  createdAt: string;
  expiresAt: string;
  redeemedAt: string | null;
}

export interface AdminDestinationDto {
  id: string;
  kind: 'GROUP' | 'PRIVATE_USER';
  label: string;
  status: 'PENDING' | 'ACTIVE' | 'DISABLED' | 'REMOVED';
  workspaceId: string | null;
  audienceSize: number | null;
  mine: boolean;
  grantCount: number;
}

export interface AuditDto {
  action: string;
  resourceType: string;
  actor: string;
  at: string;
  meta: Record<string, unknown> | null;
}

export interface AdminWorkspaceDto {
  id: string;
  name: string;
  kind: WorkspaceKindDto;
  memberCount: number;
  roles?: Record<Role, number>;
  createdAt?: string;
}

export interface AdminWorkspaceDetailDto {
  workspace: {
    id: string;
    name: string;
    kind: WorkspaceKindDto;
    status: string;
    createdAt: string;
  };
  members: {
    userId: string;
    displayName: string;
    status: AdminUserDto['status'];
    globalRole: AdminUserDto['globalRole'];
    role: Role;
    color: MemberColorId;
    since: string;
  }[];
  groups: { id: string; label: string; status: string; audienceSize: number | null }[];
  invitations: { active: number; total: number };
}

export interface AdminSummaryDto {
  pendingRequests: number;
  users: { active: number; pending: number; suspended: number };
  pendingGroups: number;
  activeGroups: number;
}

const enc = encodeURIComponent;
const qs = (params: Record<string, string | number | undefined | null>) => {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${enc(k)}=${enc(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
};

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export class FlowApp {
  constructor(private readonly c: FlowApiClient) {}

  me = () => this.c.request<MeDto>('/me');
  requestAccess = (message: string) =>
    this.c.request<{ state: 'pending' }>('/access-requests', {
      method: 'POST',
      body: message ? { message } : {},
    });
  savePreferences = (p: PreferencesDto) =>
    this.c.request<PreferencesDto>('/preferences', { method: 'PUT', body: p });
  lineStatus = (): Promise<LineStatus> => this.c.lineStatus();

  inspectInvitation = (token: string) =>
    this.c.request<{
      state: 'valid' | 'used' | 'revoked' | 'expired' | 'invalid';
      workspaceName?: string;
      role?: Role;
    }>('/invitations/inspect', { method: 'POST', body: { token } });
  redeemInvitation = (token: string) =>
    this.c.request<{ state: string }>('/invitations/redeem', { method: 'POST', body: { token } });

  // workspaces
  workspaces = () =>
    this.c.request<{ items: (WorkspaceSummaryDto & { memberCount: number })[] }>('/workspaces');
  workspace = (id: string) => this.c.request<WorkspaceDetailDto>(`/workspaces/${enc(id)}`);
  createWorkspace = (name: string, kind: 'FAMILY' | 'COMPANY' | 'CUSTOM') =>
    this.c.request<WorkspaceSummaryDto>('/workspaces', { method: 'POST', body: { name, kind } });
  updateWorkspace = (
    id: string,
    version: number,
    patch: { name?: string; kind?: 'FAMILY' | 'COMPANY' | 'CUSTOM' },
  ) =>
    this.c.request<WorkspaceSummaryDto>(`/workspaces/${enc(id)}`, {
      method: 'PATCH',
      body: { version, ...patch },
    });
  archiveWorkspace = (id: string, version: number) =>
    this.c.request(`/workspaces/${enc(id)}/archive`, { method: 'POST', body: { version } });
  candidates = (id: string) =>
    this.c.request<{ items: { id: string; displayName: string }[] }>(
      `/workspaces/${enc(id)}/candidates`,
    );
  addMember = (id: string, userId: string, role: Role) =>
    this.c.request(`/workspaces/${enc(id)}/members`, { method: 'POST', body: { userId, role } });
  changeMemberRole = (id: string, userId: string, role: Role) =>
    this.c.request(`/workspaces/${enc(id)}/members/${enc(userId)}`, {
      method: 'PATCH',
      body: { role },
    });
  removeMember = (id: string, userId: string) =>
    this.c.request(`/workspaces/${enc(id)}/members/${enc(userId)}`, { method: 'DELETE' });
  leaveWorkspace = (id: string) =>
    this.c.request(`/workspaces/${enc(id)}/leave`, { method: 'POST', body: {} });
  destinations = (workspaceId: string) =>
    this.c.request<{ items: DestinationOptionDto[] }>(
      `/workspaces/${enc(workspaceId)}/destinations`,
    );

  // appointments
  today = () => this.c.request<TodayDto>('/today');
  calendar = (
    from: string,
    to: string,
    f: { workspaceId?: string; category?: string; cancelled?: boolean } = {},
  ) =>
    this.c.request<CalendarDto>(
      `/calendar${qs({ from, to, workspaceId: f.workspaceId, category: f.category, cancelled: f.cancelled ? '1' : undefined })}`,
    );
  search = (p: {
    q?: string;
    workspaceId?: string;
    category?: string;
    status?: 'scheduled' | 'cancelled' | 'all';
    from?: string;
    to?: string;
    offset?: number;
  }) => this.c.request<PageDto<AppointmentSummaryDto>>(`/appointments${qs({ ...p, limit: 30 })}`);
  history = (scope: 'upcoming' | 'past' | 'cancelled', offset = 0) =>
    this.c.request<PageDto<AppointmentSummaryDto>>(`/history${qs({ scope, offset, limit: 30 })}`);
  appointment = (id: string) => this.c.request<AppointmentDetailDto>(`/appointments/${enc(id)}`);
  appointmentEvents = (id: string) =>
    this.c.request<{ items: AppointmentEventDto[] }>(`/appointments/${enc(id)}/history`);
  duplicateDraft = (id: string) =>
    this.c.request<AppointmentInputDraft & { workspaceId: string | null }>(
      `/appointments/${enc(id)}/duplicate`,
    );
  createAppointment = (input: AppointmentInputDraft, idempotencyKey: string) =>
    this.c.request<{ appointment: AppointmentDetailDto; replayed: boolean }>('/appointments', {
      method: 'POST',
      body: input,
      idempotencyKey,
    });
  updateAppointment = (
    id: string,
    version: number,
    input: AppointmentInputDraft,
    scope: SeriesScope = 'THIS',
  ) =>
    this.c.request<{ appointment: AppointmentDetailDto }>(`/appointments/${enc(id)}`, {
      method: 'PUT',
      body: { version, appointment: input, scope },
    });
  cancelAppointment = (id: string, version: number, scope: SeriesScope = 'THIS') =>
    this.c.request<{ appointment: AppointmentDetailDto | null }>(
      `/appointments/${enc(id)}/cancel`,
      { method: 'POST', body: { version, scope } },
    );
  setPayment = (id: string, version: number, status: 'PAID' | 'UNPAID') =>
    this.c.request<{ appointment: AppointmentDetailDto }>(`/appointments/${enc(id)}/payment`, {
      method: 'POST',
      body: { version, status },
    });
  setMyColor = (workspaceId: string, color: MemberColorId | null) =>
    this.c.request<{ color: MemberColorId; customColor: boolean }>(
      `/workspaces/${enc(workspaceId)}/my-color`,
      { method: 'PUT', body: { color } },
    );
  preview = (appointment: AppointmentInputDraft, ruleIndex: number, destinationId: string | null) =>
    this.c.request<PreviewDto>('/preview/reminder', {
      method: 'POST',
      body: { appointment, ruleIndex, destinationId },
    });
  estimate = (appointment: AppointmentInputDraft, signal?: AbortSignal) =>
    this.c.request<EstimateDto>('/preview/estimate', {
      method: 'POST',
      body: { appointment },
      ...(signal ? { signal } : {}),
    });

  // owner console
  adminSummary = () => this.c.request<AdminSummaryDto>('/admin/summary');
  accessRequests = (status: 'PENDING' | 'APPROVED' | 'REJECTED' = 'PENDING') =>
    this.c.request<{ items: AccessRequestDto[] }>(`/admin/access-requests${qs({ status })}`);
  approveRequest = (id: string, assignments: { workspaceId: string; role: Role }[]) =>
    this.c.request(`/admin/access-requests/${enc(id)}/approve`, {
      method: 'POST',
      body: { assignments },
    });
  rejectRequest = (id: string) =>
    this.c.request(`/admin/access-requests/${enc(id)}/reject`, { method: 'POST', body: {} });
  adminOverview = () => this.c.request<AdminOverviewDto>('/admin/overview');
  activity = (p: {
    from: string;
    to: string;
    status?: string;
    workspaceId?: string;
    offset?: number;
  }) => this.c.request<ActivityDto>(`/admin/activity${qs({ ...p, limit: 50 })}`);
  quota = () => this.c.request<QuotaDto>('/admin/quota');
  friends = (p: { q?: string; status?: string; offset?: number } = {}) =>
    this.c.request<FriendsDto>(`/admin/friends${qs({ ...p, limit: 50 })}`);
  health = () => this.c.request<HealthDto>('/admin/health');
  notificationOverview = () => this.c.request<NotificationOverviewDto>('/admin/notifications');
  adminWorkspace = (id: string) =>
    this.c.request<AdminWorkspaceDetailDto>(`/admin/workspaces/${enc(id)}`);
  reactivateUser = (id: string, assignments: { workspaceId: string; role: Role }[]) =>
    this.c.request(`/admin/users/${enc(id)}/status`, {
      method: 'POST',
      body: { action: 'reactivate', assignments },
    });
  users = (
    p: { status?: string; q?: string; role?: string; workspaceId?: string; offset?: number } = {},
  ) => this.c.request<PageDto<AdminUserDto>>(`/admin/users${qs({ ...p, limit: 30 })}`);
  user = (id: string) => this.c.request<AdminUserDetailDto>(`/admin/users/${enc(id)}`);
  setUserStatus = (id: string, action: 'suspend' | 'reinstate' | 'revoke' | 'reactivate') =>
    this.c.request(`/admin/users/${enc(id)}/status`, { method: 'POST', body: { action } });
  setGlobalRole = (id: string, globalRole: 'ADMIN' | 'USER') =>
    this.c.request(`/admin/users/${enc(id)}/role`, { method: 'POST', body: { globalRole } });
  setMembership = (id: string, workspaceId: string, role: Role | null) =>
    this.c.request(`/admin/users/${enc(id)}/memberships`, {
      method: 'PUT',
      body: { workspaceId, role },
    });
  adminWorkspaces = () =>
    this.c.request<{ items: AdminWorkspaceDto[]; personalCount?: number }>('/admin/workspaces');
  invitations = () => this.c.request<{ items: InvitationDto[] }>('/admin/invitations');
  createInvitation = (
    workspaceId: string,
    role: Role,
    expiresInHours: number,
    note: string | null,
  ) =>
    this.c.request<{ id: string; expiresAt: string; link: string }>('/admin/invitations', {
      method: 'POST',
      body: { workspaceId, role, expiresInHours, note },
    });
  revokeInvitation = (id: string) =>
    this.c.request(`/admin/invitations/${enc(id)}/revoke`, { method: 'POST', body: {} });
  adminDestinations = () => this.c.request<{ items: AdminDestinationDto[] }>('/admin/destinations');
  configureDestination = (
    id: string,
    patch: {
      label?: string;
      workspaceId?: string | null;
      status?: 'ACTIVE' | 'DISABLED';
      audienceSize?: number | null;
    },
  ) =>
    this.c.request<AdminDestinationDto>(`/admin/destinations/${enc(id)}`, {
      method: 'PATCH',
      body: patch,
    });
  setGrant = (id: string, userId: string, on: boolean) =>
    this.c.request(`/admin/destinations/${enc(id)}/grants/${enc(userId)}`, {
      method: on ? 'PUT' : 'DELETE',
    });
  audit = (offset = 0) =>
    this.c.request<PageDto<AuditDto>>(`/admin/audit${qs({ offset, limit: 50 })}`);
}

/**
 * Appointment-creation prototype state (pure, framework-free → unit-testable).
 * EP00: local only. No persistence, no LINE calls. "simulated" is the final step.
 */
import {
  addDaysToLocalDate,
  buildFlexPreview,
  CATEGORIES,
  defaultDestinationIds,
  destinationAvailability,
  estimateQuota,
  evaluateDestinations,
  isValidLocalDate,
  isValidLocalTime,
  planReminders,
  reminderAnchor,
  toLocalDateString,
  validateDraft,
  type CategoryId,
  type DestinationEvaluation,
  type DestinationOption,
  type DraftIssue,
  type FlexPreviewModel,
  type QuotaEstimate,
  type QuotaSnapshot,
  type ReminderPlan,
} from '@flow/shared';

export type DraftStep = 'edit' | 'review' | 'simulated';

export interface DraftState {
  title: string;
  category: CategoryId;
  localDate: string;
  localTime: string;
  allDay: boolean;
  location: string;
  destinationIds: string[];
  reminderOffsets: number[];
  minimalDisclosure: boolean;
  step: DraftStep;
  previewDestinationId: string | null;
}

export type DraftAction =
  | { type: 'set-title'; value: string }
  | { type: 'set-category'; value: CategoryId }
  | { type: 'set-date'; value: string }
  | { type: 'set-time'; value: string }
  | { type: 'set-all-day'; value: boolean }
  | { type: 'set-location'; value: string }
  | { type: 'toggle-destination'; id: string; options: readonly DestinationOption[] }
  | { type: 'only-me'; options: readonly DestinationOption[] }
  | { type: 'toggle-reminder'; offset: number }
  | { type: 'set-minimal-disclosure'; value: boolean }
  | { type: 'preview-destination'; id: string }
  | { type: 'go-review' }
  | { type: 'back-to-edit' }
  | { type: 'simulate-confirm' }
  | { type: 'reset'; state: DraftState };

export function initialDraft(
  now: Date,
  timeZone: string,
  options: readonly DestinationOption[],
): DraftState {
  const ids = defaultDestinationIds(options);
  return {
    title: '',
    category: 'personal',
    localDate: addDaysToLocalDate(toLocalDateString(now, timeZone), 1),
    localTime: '09:00',
    allDay: false,
    location: '',
    destinationIds: ids,
    reminderOffsets: [30],
    minimalDisclosure: false,
    step: 'edit',
    previewDestinationId: ids[0] ?? null,
  };
}

export function draftReducer(state: DraftState, action: DraftAction): DraftState {
  switch (action.type) {
    case 'set-title':
      return { ...state, title: action.value };
    case 'set-category':
      return { ...state, category: action.value };
    case 'set-date':
      return { ...state, localDate: action.value };
    case 'set-time':
      return { ...state, localTime: action.value };
    case 'set-all-day':
      return { ...state, allDay: action.value };
    case 'set-location':
      return { ...state, location: action.value };
    case 'toggle-destination': {
      const option = action.options.find((o) => o.id === action.id);
      if (!option || destinationAvailability(option) !== 'available') return state;
      const selected = state.destinationIds.includes(action.id);
      const destinationIds = selected
        ? state.destinationIds.filter((id) => id !== action.id)
        : [...state.destinationIds, action.id];
      const previewDestinationId = destinationIds.includes(state.previewDestinationId ?? '')
        ? state.previewDestinationId
        : (destinationIds[0] ?? null);
      return {
        ...state,
        destinationIds,
        previewDestinationId: selected ? previewDestinationId : action.id,
      };
    }
    case 'only-me': {
      const ids = defaultDestinationIds(action.options);
      return { ...state, destinationIds: ids, previewDestinationId: ids[0] ?? null };
    }
    case 'toggle-reminder': {
      const has = state.reminderOffsets.includes(action.offset);
      const reminderOffsets = has
        ? state.reminderOffsets.filter((o) => o !== action.offset)
        : [...state.reminderOffsets, action.offset].sort((a, b) => b - a);
      return { ...state, reminderOffsets };
    }
    case 'set-minimal-disclosure':
      return { ...state, minimalDisclosure: action.value };
    case 'preview-destination':
      return state.destinationIds.includes(action.id)
        ? { ...state, previewDestinationId: action.id }
        : state;
    case 'go-review':
      return { ...state, step: 'review' };
    case 'back-to-edit':
      return { ...state, step: 'edit' };
    case 'simulate-confirm':
      return state.step === 'review' ? { ...state, step: 'simulated' } : state;
    case 'reset':
      return action.state;
  }
}

export interface DraftContext {
  now: Date;
  timeZone: string;
  options: readonly DestinationOption[];
  quota: QuotaSnapshot;
}

export interface DraftPreview {
  destination: DestinationOption;
  model: FlexPreviewModel;
}

export interface DerivedDraft {
  issues: DraftIssue[];
  selected: DestinationOption[];
  evaluation: DestinationEvaluation;
  plan: ReminderPlan | null;
  quota: QuotaEstimate;
  previews: DraftPreview[];
  activePreview: DraftPreview | null;
  canReview: boolean;
}

export const TITLE_PLACEHOLDER = 'ชื่อนัดหมายของคุณ';

export function deriveDraft(state: DraftState, ctx: DraftContext): DerivedDraft {
  const validation = validateDraft({
    title: state.title,
    category: state.category,
    localDate: state.localDate,
    localTime: state.localTime,
    allDay: state.allDay,
    timeZone: ctx.timeZone,
    location: state.location || undefined,
    destinationIds: state.destinationIds,
    reminderOffsets: state.reminderOffsets,
    minimalDisclosure: state.minimalDisclosure,
  });
  const issues = validation.ok ? [] : validation.issues;

  const selected = state.destinationIds
    .map((id) => ctx.options.find((o) => o.id === id))
    .filter((o): o is DestinationOption => Boolean(o));
  const evaluation = evaluateDestinations(state.category, selected);

  const whenValid =
    isValidLocalDate(state.localDate) && (state.allDay || isValidLocalTime(state.localTime));
  const plan = whenValid
    ? planReminders({
        localDate: state.localDate,
        localTime: state.localTime,
        allDay: state.allDay,
        timeZone: ctx.timeZone,
        offsetsMinutes: state.reminderOffsets,
        now: ctx.now,
      })
    : null;

  const quota = estimateQuota(selected, plan?.scheduled.length ?? 0, ctx.quota);

  const previews: DraftPreview[] = [];
  if (whenValid) {
    const start = reminderAnchor({
      localDate: state.localDate,
      localTime: state.localTime,
      allDay: state.allDay,
      timeZone: ctx.timeZone,
    });
    const firstReminder = plan?.scheduled[0]?.offsetMinutes;
    for (const destination of selected) {
      previews.push({
        destination,
        model: buildFlexPreview({
          templateId: state.category,
          category: state.category,
          title: state.title.trim() || TITLE_PLACEHOLDER,
          localDate: state.localDate,
          allDay: state.allDay,
          start,
          timeZone: ctx.timeZone,
          ...(state.location.trim() ? { location: state.location } : {}),
          destination: { displayName: destination.displayName, kind: destination.kind },
          ...(firstReminder !== undefined ? { reminderOffsetMinutes: firstReminder } : {}),
          // Minimal disclosure applies to group destinations only; private chats keep details.
          minimalDisclosure: state.minimalDisclosure && destination.kind === 'line-group',
          now: ctx.now,
        }),
      });
    }
  }
  const activePreview =
    previews.find((p) => p.destination.id === state.previewDestinationId) ?? previews[0] ?? null;

  const canReview = issues.length === 0 && evaluation.canConfirm && quota.status !== 'exceeds';

  return { issues, selected, evaluation, plan, quota, previews, activePreview, canReview };
}

export function categoryLabel(id: CategoryId): string {
  return CATEGORIES[id].labelTh;
}

/**
 * Visual preview of a LINE Flex Message built from the shared FlexPreviewModel.
 * Only constructs that Flex Messages support are used (boxes, text, separators,
 * icons, buttons). Buttons here are inert previews — they never perform actions.
 */
import type { FlexPreviewModel } from '@flow/shared';
import { brandArt, sallyRaster } from '../brand/assets';
import {
  Ban,
  Bell,
  CalendarClock,
  CircleCheck,
  ListChecks,
  Lock,
  MapPin,
  PencilLine,
  Users,
  type LucideIcon,
} from './icons';
import { CATEGORY_ICON } from './ui';

const HEADER_ICON: Record<FlexPreviewModel['headerIcon'], LucideIcon> = {
  family: CATEGORY_ICON.family,
  business: CATEGORY_ICON.business,
  personal: CATEGORY_ICON.personal,
  health: CATEGORY_ICON.health,
  special: CATEGORY_ICON.special,
  urgent: CATEGORY_ICON.urgent,
  changed: PencilLine,
  cancelled: Ban,
  summary: ListChecks,
  saved: CircleCheck,
};

export function FlexBubble({ model }: { model: FlexPreviewModel }) {
  const HeaderIcon = HEADER_ICON[model.headerIcon];
  const cancelled = model.templateId === 'cancelled';
  return (
    <article
      className="flex-bubble"
      data-theme={model.theme}
      aria-label={`ตัวอย่างข้อความ: ${model.headerLabel}`}
    >
      <header className="flex-bubble__header">
        <HeaderIcon aria-hidden />
        <span>{model.headerLabel}</span>
        <img src={brandArt.flowWordmarkIvory} alt="FLOW" className="flex-bubble__mark" />
      </header>
      <div className="flex-bubble__body">
        <p className="flex-bubble__sally">{model.sallyLine}</p>
        <h4 className={`flex-bubble__title${cancelled ? ' is-cancelled' : ''}`}>{model.title}</h4>

        {model.templateId === 'daily-summary' ? (
          <ul className="flex-bubble__list">
            {(model.summaryItems ?? []).length === 0 ? (
              <li className="flex-bubble__empty">ไม่มีนัดหมายในวันนี้</li>
            ) : (
              (model.summaryItems ?? []).map((item) => (
                <li key={`${item.timeText}-${item.title}`} data-theme={item.category}>
                  <span className="f-num flex-bubble__list-time">{item.timeText}</span>
                  <span className="flex-bubble__list-dot" aria-hidden />
                  <span>{item.title}</span>
                </li>
              ))
            )}
          </ul>
        ) : (
          <>
            <div className="flex-bubble__when">
              <span className={`flex-bubble__time f-num${cancelled ? ' is-cancelled' : ''}`}>
                {model.timeText}
              </span>
              <span className="flex-bubble__date">{model.dateText}</span>
            </div>
            {model.previousWhenText ? (
              <p className="flex-bubble__row flex-bubble__previous">
                <CalendarClock aria-hidden />
                <span>
                  เดิม <s>{model.previousWhenText}</s>
                </span>
              </p>
            ) : null}
            {model.timingContext ? (
              <p className="flex-bubble__timing">
                <Bell aria-hidden />
                {model.timingContext}
              </p>
            ) : null}
            {model.location ? (
              <p className="flex-bubble__row">
                <MapPin aria-hidden />
                <span>{model.location}</span>
              </p>
            ) : null}
            {model.description ? <p className="flex-bubble__desc">{model.description}</p> : null}
          </>
        )}

        {model.destinationText ? (
          <p className="flex-bubble__row flex-bubble__dest">
            {model.minimalDisclosure ? <Lock aria-hidden /> : <Users aria-hidden />}
            <span>{model.destinationText}</span>
          </p>
        ) : null}
      </div>
      <footer className="flex-bubble__footer">
        <span className="flex-bubble__btn flex-bubble__btn--primary" aria-hidden>
          {model.primaryAction.label}
        </span>
        {model.secondaryAction ? (
          <span className="flex-bubble__btn" aria-hidden>
            {model.secondaryAction.label}
          </span>
        ) : null}
        {model.showSignature ? (
          <p className="flex-bubble__sig">Designed &amp; Engineered by PDA BLISS</p>
        ) : null}
      </footer>
    </article>
  );
}

/** LINE-like chat context around a bubble: Sally's avatar and name. */
export function ChatPreview({ model, label }: { model: FlexPreviewModel; label?: string }) {
  return (
    <figure className="chat-preview">
      <div className="chat-preview__row">
        <img src={sallyRaster.avatar128} alt="" className="chat-preview__avatar" aria-hidden />
        <div className="chat-preview__stack">
          <span className="chat-preview__name">Sally · FLOW</span>
          <FlexBubble model={model} />
        </div>
      </div>
      <figcaption className="chat-preview__caption">
        <span className="f-proto">ตัวอย่าง · ไม่ได้ส่งจริง</span>
        {label ? <span className="f-hint">{label}</span> : null}
      </figcaption>
    </figure>
  );
}

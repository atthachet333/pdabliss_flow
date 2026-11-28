/** Status line for the quota (ADM08) and health (ADM09) refresh actions. */
import { Notice } from '../../components/ui';
import type { RefreshState } from './refresh';
import { preciseText } from './refresh-options';

export { HEALTH_REFRESH, preciseText, QUOTA_REFRESH } from './refresh-options';

export function RefreshStatus<T>({ r, busyText }: { r: RefreshState<T>; busyText: string }) {
  return (
    <div className="adm-refresh" role="status" aria-live="polite">
      {r.phase === 'refreshing' ? (
        <p className="adm-refresh__busy">
          <span className="adm-spinner" aria-hidden />
          {busyText}
        </p>
      ) : r.feedback ? (
        <Notice
          tone={
            r.feedback.tone === 'success'
              ? 'success'
              : r.feedback.tone === 'caution'
                ? 'caution'
                : 'block'
          }
        >
          {r.feedback.text}
        </Notice>
      ) : null}
      {r.checkedAt ? (
        <p className="adm-fine f-num" data-checked-at={r.checkedAt}>
          ตรวจล่าสุดเมื่อ {preciseText(r.checkedAt)}
          {r.stale ? ' · ข้อมูลที่แสดงเป็นข้อมูลเก่า' : ''}
        </p>
      ) : null}
    </div>
  );
}

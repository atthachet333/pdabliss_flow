import { CATEGORY_IDS, type CategoryId } from '@flow/shared';
import { CategoryBadge } from '../../components/ui';
import { KIND_TEXT, useApp } from '../core';

/** Workspace chips (All + each workspace). Filtering only narrows what the server returned. */
export function WorkspaceFilter() {
  const { me, workspaceId, setWorkspaceId } = useApp();
  if (me.workspaces.length < 2) return null;
  return (
    <div className="chips" role="group" aria-label="เลือกกลุ่ม">
      <button
        type="button"
        className="f-chip"
        aria-pressed={workspaceId === 'all'}
        onClick={() => setWorkspaceId('all')}
      >
        ทุกกลุ่ม
      </button>
      {me.workspaces.map((w) => (
        <button
          key={w.id}
          type="button"
          className="f-chip"
          aria-pressed={workspaceId === w.id}
          onClick={() => setWorkspaceId(w.id)}
          title={KIND_TEXT[w.kind]}
        >
          <span className="f-name chip-name">{w.name}</span>
        </button>
      ))}
    </div>
  );
}

export function CategoryFilter({
  value,
  onChange,
}: {
  value: CategoryId[];
  onChange: (v: CategoryId[]) => void;
}) {
  return (
    <div className="chips" role="group" aria-label="กรองตามหมวด">
      {CATEGORY_IDS.map((c) => {
        const on = value.includes(c);
        return (
          <button
            key={c}
            type="button"
            className="chip-cat"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== c) : [...value, c])}
          >
            <CategoryBadge category={c} solid={on} />
          </button>
        );
      })}
    </div>
  );
}

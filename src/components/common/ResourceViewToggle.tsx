import { useRef, useCallback } from 'react';
import { cn } from '../../lib/utils';

export type ResourceView = 'group' | 'list';

interface ResourceViewToggleProps {
  view: ResourceView;
  onChange: (view: ResourceView) => void;
  groupLabel: string;
  listLabel: string;
}

const VIEWS: ResourceView[] = ['group', 'list'];

/**
 * 分组 / 列表视图切换（Phase 6 §7 a11y：role=tablist / role=tab / aria-selected，
 * 方向键在 tab 间导航，Enter/Space 激活）。
 */
export function ResourceViewToggle({
  view,
  onChange,
  groupLabel,
  listLabel,
}: ResourceViewToggleProps) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const labels: Record<ResourceView, string> = {
    group: groupLabel,
    list: listLabel,
  };

  const focusTab = useCallback((index: number) => {
    tabRefs.current[index]?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const idx = VIEWS.indexOf(view);
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        const next = (idx + 1) % VIEWS.length;
        onChange(VIEWS[next]);
        focusTab(next);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = (idx - 1 + VIEWS.length) % VIEWS.length;
        onChange(VIEWS[prev]);
        focusTab(prev);
      } else if (e.key === 'Home') {
        e.preventDefault();
        onChange(VIEWS[0]);
        focusTab(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        onChange(VIEWS[VIEWS.length - 1]);
        focusTab(VIEWS.length - 1);
      }
    },
    [view, onChange, focusTab]
  );

  return (
    <div
      role="tablist"
      aria-label="view-toggle"
      className="flex shrink-0 items-center rounded-lg border border-border bg-muted/50 p-0.5"
      onKeyDown={handleKeyDown}
    >
      {VIEWS.map((v, i) => (
        <button
          key={v}
          ref={(el) => {
            tabRefs.current[i] = el;
          }}
          role="tab"
          type="button"
          aria-selected={view === v}
          tabIndex={view === v ? 0 : -1}
          className={cn(
            'rounded-md px-3 py-1 text-xs font-medium transition-colors',
            view === v
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
          onClick={() => onChange(v)}
        >
          {labels[v]}
        </button>
      ))}
    </div>
  );
}

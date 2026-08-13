import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../lib/utils';
import { ChevronDown, ChevronRight, Check } from 'lucide-react';
import type { Tag } from '../types';
import { groupResourcesByTag } from '../lib/resourceLibrary';
import { BOUNDED_STEP, useBoundedReveal } from '../lib/useBoundedReveal';

const UNTAGGED_KEY = 'untagged';

interface ResourceCollectionProps<T extends { id: string; tags?: Tag[] }> {
  /** 已经过搜索/标签筛选的结果集合 */
  items: T[];
  tags: Tag[];
  view: 'group' | 'list';
  batchMode: boolean;
  selectedIds: Set<string>;
  untaggedLabel: string;
  /** 「显示更多」按钮文案，含 {{count}} 占位符（未渲染项数） */
  showMoreLabel: string;
  onToggleSelect: (id: string) => void;
  onOpenDetail: (item: T) => void;
  /** 卡片/行内容（模块专属） */
  renderItem: (item: T) => React.ReactNode;
  emptyLabel?: React.ReactNode;
  /** 外部「全部展开/收起」控件（筛选行）驱动；true = 全部分组折叠。undefined = 不受外部控制 */
  collapsedAll?: boolean;
}

/**
 * 资源集合渲染（Phase 6 §3.3 / §7 / 决策 7）：
 * - 分组视图：未分类置顶、多标签资源在各分组重复出现（同一对象，不复制）、单组折叠；
 *   「全部展开/收起」由外部筛选行控件（collapsedAll）驱动，内容区不再重复渲染切换按钮；
 * - 列表视图：高密度单列表；
 * - 批量模式：显示选择控件，点击切换选中；否则点击打开详情；
 * - 键盘访问：Tab 聚焦卡片，Enter/Space 打开详情或切换选中。
 */
export function ResourceCollection<T extends { id: string; tags?: Tag[] }>({
  items,
  tags,
  view,
  batchMode,
  selectedIds,
  untaggedLabel,
  showMoreLabel,
  onToggleSelect,
  onOpenDetail,
  renderItem,
  emptyLabel,
  collapsedAll,
}: ResourceCollectionProps<T>) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [revealByGroup, setRevealByGroup] = useState<Record<string, number>>(
    {}
  );
  const { revealed, hasMore, revealMore } = useBoundedReveal(items.length);

  const groups = useMemo(() => groupResourcesByTag(items, tags), [items, tags]);

  const prevCollapsedAll = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    if (
      typeof collapsedAll === 'boolean' &&
      collapsedAll !== prevCollapsedAll.current
    ) {
      prevCollapsedAll.current = collapsedAll;
      setCollapsed(
        collapsedAll ? new Set(groups.map((g) => groupKey(g.tag))) : new Set()
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsedAll, groups]);

  if (items.length === 0) return <>{emptyLabel ?? null}</>;

  const groupKey = (tag: Tag | null) => (tag ? `tag-${tag.id}` : UNTAGGED_KEY);

  const formatShowMore = (remaining: number) =>
    showMoreLabel.replace('{{count}}', String(remaining));

  const revealGroup = (key: string) =>
    setRevealByGroup((prev) => ({
      ...prev,
      [key]: (prev[key] ?? BOUNDED_STEP) + BOUNDED_STEP,
    }));

  const toggleGroup = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleActivate = (item: T) => {
    if (batchMode) onToggleSelect(item.id);
    else onOpenDetail(item);
  };

  const itemShell = (item: T, row: boolean) => {
    const selected = selectedIds.has(item.id);
    return (
      <div
        key={item.id}
        data-testid="resource-item"
        role={batchMode ? 'checkbox' : 'button'}
        tabIndex={0}
        aria-checked={batchMode ? selected : undefined}
        className={cn(
          'relative rounded-lg border text-left transition-all resource-card',
          row ? 'flex w-full items-center gap-3 px-3 py-2.5' : 'p-4',
          batchMode && selected
            ? 'border-primary/50 bg-primary/5'
            : 'border-border bg-card',
          'cursor-pointer'
        )}
        onClick={() => handleActivate(item)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleActivate(item);
          }
        }}
      >
        {batchMode && (
          <span
            aria-hidden="true"
            className={cn(
              'flex h-4 w-4 items-center justify-center rounded border shrink-0',
              row ? 'self-center' : 'absolute left-3 top-3 z-10',
              selected
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background'
            )}
          >
            {selected && <Check className="h-3 w-3" />}
          </span>
        )}
        <div className={cn('min-w-0 flex-1', batchMode && !row && 'pl-6')}>
          {renderItem(item)}
        </div>
      </div>
    );
  };

  if (view === 'list') {
    return (
      <div className="space-y-1.5">
        {items.slice(0, revealed).map((item) => itemShell(item, true))}
        {hasMore && (
          <button
            data-testid="show-more"
            className="flex w-full items-center justify-center gap-1 rounded-md border border-border py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={revealMore}
          >
            {formatShowMore(items.length - revealed)}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => {
        const key = groupKey(group.tag);
        const isCollapsed = collapsed.has(key);
        if (group.items.length === 0) return null;
        const revealLimit = revealByGroup[key] ?? BOUNDED_STEP;
        const shownItems = group.items.slice(0, revealLimit);
        const groupHasMore = shownItems.length < group.items.length;
        return (
          <section key={key} aria-label={group.tag?.name || untaggedLabel}>
            <button
              className="flex w-full items-center gap-1.5 rounded-md px-1 py-1.5 text-left text-sm font-semibold text-foreground hover:bg-accent transition-colors"
              aria-expanded={!isCollapsed}
              onClick={() => toggleGroup(key)}
            >
              {isCollapsed ? (
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">
                {group.tag?.name || untaggedLabel}
              </span>
              <span className="shrink-0 text-xs font-normal text-muted-foreground">
                {group.items.length}
              </span>
            </button>
            {!isCollapsed && (
              <div
                className="mt-2 grid gap-3"
                style={{
                  gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                }}
              >
                {shownItems.map((item) => itemShell(item, false))}
                {groupHasMore && (
                  <button
                    data-testid="show-more"
                    className="col-span-full flex w-full items-center justify-center gap-1 rounded-md border border-border py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    onClick={() => revealGroup(key)}
                  >
                    {formatShowMore(group.items.length - shownItems.length)}
                  </button>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

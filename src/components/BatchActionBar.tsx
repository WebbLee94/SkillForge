import { cn } from '../lib/utils';
import { Eraser, LogOut, Send, Tags, Trash2, X } from 'lucide-react';

interface BatchActionBarProps {
  /** 批量模式开关是否开启；关闭时不渲染任何内容（默认隐藏选择控件） */
  enabled: boolean;
  selectedCount: number;
  selectedLabel: string;
  /** armed 紧凑引导文案（勾选资源后操作） */
  guideLabel: string;
  exitLabel: string;
  /** 管理所选标签（模块专属文案：技能标签 / 规则标签） */
  manageTagsLabel: string;
  goDistributeLabel: string;
  deleteLabel: string;
  /** 清空所选（保持批量模式开启，回到 armed 状态） */
  clearLabel: string;
  onExit: () => void;
  onGoDistribute: () => void;
  onManageTags: () => void;
  onDelete: () => void;
  onClear: () => void;
}

/**
 * 显式批量模式操作栏（Phase 6 §3.7，Task 5 统一底部粘性样式）：
 * - armed（开启、0 选中）：紧凑引导 + 退出，不渲染禁用的动作按钮；
 * - selected（≥1 选中）：动作顺序为管理所选标签 → 批量删除 → 清空 → 去分发 → 退出选择。
 */
export function BatchActionBar({
  enabled,
  selectedCount,
  selectedLabel,
  guideLabel,
  exitLabel,
  manageTagsLabel,
  goDistributeLabel,
  deleteLabel,
  clearLabel,
  onExit,
  onGoDistribute,
  onManageTags,
  onDelete,
  onClear,
}: BatchActionBarProps) {
  if (!enabled) return null;

  const selected = selectedCount > 0;

  return (
    <div
      data-testid="batch-action-bar"
      className="sticky bottom-0 z-40 bg-background pt-2"
    >
      <div
        data-testid="batch-action-bar-inner"
        className="bg-accent rounded-lg border border-border px-3 py-2"
      >
        {selected ? (
          <div className="flex flex-wrap items-center gap-3">
            <span
              className="text-sm font-medium text-foreground"
              aria-live="polite"
            >
              {selectedLabel}
            </span>
            <button
              className={cn(
                'flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm',
                'font-medium text-foreground hover:bg-accent transition-colors'
              )}
              onClick={onManageTags}
            >
              <Tags className="h-3.5 w-3.5" />
              {manageTagsLabel}
            </button>
            <button
              className={cn(
                'flex items-center gap-1.5 rounded-md bg-error/10 px-3 py-1.5 text-sm font-medium',
                'text-error hover:bg-error/20 transition-colors'
              )}
              onClick={onDelete}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {deleteLabel}
            </button>
            <button
              className={cn(
                'flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm',
                'font-medium text-foreground hover:bg-accent transition-colors'
              )}
              onClick={onClear}
            >
              <Eraser className="h-3.5 w-3.5" />
              {clearLabel}
            </button>
            <button
              className={cn(
                'flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium',
                'text-primary-foreground hover:bg-primary/90 transition-colors'
              )}
              onClick={onGoDistribute}
            >
              <Send className="h-3.5 w-3.5" />
              {goDistributeLabel}
            </button>
            <span className="flex-1" />
            <button
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              onClick={onExit}
            >
              <X className="h-3.5 w-3.5" />
              {exitLabel}
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">{guideLabel}</span>
            <button
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              onClick={onExit}
            >
              <LogOut className="h-3.5 w-3.5" />
              {exitLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

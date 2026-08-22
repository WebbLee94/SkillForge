import { cn } from '../../lib/utils';
import { Eraser, LogOut, Trash2, X } from 'lucide-react';

interface ProjectBatchBarProps {
  /** 批量模式开关是否开启；关闭时不渲染任何内容（默认隐藏选择控件） */
  enabled: boolean;
  selectedCount: number;
  selectedLabel: string;
  /** armed 紧凑引导文案（勾选项目后操作） */
  guideLabel: string;
  deleteLabel: string;
  clearLabel: string;
  exitLabel: string;
  onDelete: () => void;
  onClear: () => void;
  onExit: () => void;
}

/**
 * 项目批量操作紧凑栏（Phase 7）：
 * - armed（开启、0 选中）：引导文案 + 退出，不渲染动作按钮；
 * - selected（≥1 选中）：数量 + 批量删除 / 清空选择 / 退出。
 */
export function ProjectBatchBar({
  enabled,
  selectedCount,
  selectedLabel,
  guideLabel,
  deleteLabel,
  clearLabel,
  exitLabel,
  onDelete,
  onClear,
  onExit,
}: ProjectBatchBarProps) {
  if (!enabled) return null;

  const selected = selectedCount > 0;

  return (
    <div
      data-testid="project-batch-bar"
      className="sticky bottom-0 z-40 bg-background pt-2"
    >
      <div
        data-testid="project-batch-bar-inner"
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
                'flex items-center gap-1.5 rounded-md bg-error/10 px-3 py-1.5 text-sm font-medium',
                'text-error hover:bg-error/20 transition-colors'
              )}
              onClick={onDelete}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {deleteLabel}
            </button>
            <button
              className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent transition-colors"
              onClick={onClear}
            >
              <Eraser className="h-3.5 w-3.5" />
              {clearLabel}
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

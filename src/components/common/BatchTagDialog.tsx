import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { X } from 'lucide-react';
import type { Tag } from '../../types';
import { useDialogA11y } from '../../hooks/useDialogA11y';

interface BatchTagDialogProps {
  open: boolean;
  allTags: Tag[];
  /** 所有已选资源共同拥有的标签（交集），作为初始勾选 */
  initialTagIds: number[];
  title: string;
  applyLabel: string;
  onApply: (added: number[], removed: number[]) => Promise<void>;
  onClose: () => void;
}

/**
 * 批量「管理所选标签」（Phase 6 §3.7 动作矩阵）。
 * 勾选 = 为所有已选资源分配标签；取消已勾选 = 从所有已选资源移除该标签。
 * 确认后以 added / removed 标签 id 交给父级执行。
 */
export function BatchTagDialog({
  open,
  allTags,
  initialTagIds,
  title,
  applyLabel,
  onApply,
  onClose,
}: BatchTagDialogProps) {
  const { t } = useTranslation('common');
  const [checked, setChecked] = useState<Set<number>>(
    () => new Set(initialTagIds)
  );
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (open) setChecked(new Set(initialTagIds));
  }, [open, initialTagIds]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const dialogRef = useDialogA11y(open);

  if (!open) return null;

  const toggle = (tagId: number) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  };

  const handleApply = async () => {
    if (applying) return;
    setApplying(true);
    const initial = new Set(initialTagIds);
    const added = [...checked].filter((id) => !initial.has(id));
    const removed = initialTagIds.filter((id) => !checked.has(id));
    try {
      await onApply(added, removed);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="batch-tag-title"
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    >
      <div className="w-[400px] rounded-lg border border-border bg-card p-6 shadow-xl animate-fade-in">
        <div className="flex items-center justify-between mb-4">
          <h2
            id="batch-tag-title"
            className="text-lg font-semibold text-foreground"
          >
            {title}
          </h2>
          <button
            className="text-muted-foreground hover:text-foreground transition-colors"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[320px] space-y-1 overflow-y-auto">
          {allTags.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t('messages.noData')}
            </p>
          ) : (
            allTags.map((tag) => (
              <label
                key={tag.id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors"
              >
                <input
                  type="checkbox"
                  checked={checked.has(tag.id)}
                  onChange={() => toggle(tag.id)}
                  className="h-4 w-4 rounded border-border"
                />
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={tag.color ? { backgroundColor: tag.color } : undefined}
                />
                <span className="text-foreground">{tag.name}</span>
              </label>
            ))
          )}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors"
            onClick={onClose}
          >
            {t('actions.cancel')}
          </button>
          <button
            className={cn(
              'rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors',
              applying && 'pointer-events-none opacity-60'
            )}
            onClick={handleApply}
          >
            {applyLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';
import {
  X,
  Plus,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from 'lucide-react';
import type {
  ImportItemStatus,
  ImportResultStatus,
} from '../lib/resourceLibrary';
import { useDialogA11y } from '../hooks/useDialogA11y';
import { useBoundedReveal } from '../lib/useBoundedReveal';

export interface ImportItem {
  key: string;
  name: string;
  path: string;
  format?: string;
  status: ImportItemStatus;
  reason?: string;
  result?: ImportResultStatus;
}

interface ResourceImportDialogProps {
  open: boolean;
  title: string;
  items: ImportItem[];
  importing: boolean;
  itemKindLabel: string;
  appendLabel: string;
  confirmLabel: string;
  cancelLabel: string;
  onAppend: () => void;
  onRemoveItem: (key: string) => void;
  onRetryItem: (key: string) => Promise<void>;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

const STATUS_BADGE: Record<ImportItemStatus, string> = {
  valid: 'bg-success/10 text-success',
  skip: 'bg-warning/10 text-warning',
  error: 'bg-error/10 text-error',
};

const RESULT_BADGE: Record<ImportResultStatus, string> = {
  success: 'bg-success/10 text-success',
  failed: 'bg-error/10 text-error',
  skipped: 'bg-muted text-muted-foreground',
};

/**
 * 多选导入预览/结果对话框（Phase 6 §3.8，技能目录与规则文件共享）：
 * - 预览阶段逐项 valid / skip / error（附原因）；有效项可移除；skip/error 项可忽略或重试；
 * - 确认后进入结果阶段，按项计数 成功 / 跳过 / 失败；失败项可重试或忽略。
 * 状态数据由父页面持有，本组件仅负责渲染与回调。
 */
export function ResourceImportDialog({
  open,
  title,
  items,
  importing,
  itemKindLabel,
  appendLabel,
  confirmLabel,
  cancelLabel,
  onAppend,
  onRemoveItem,
  onRetryItem,
  onConfirm,
  onCancel,
}: ResourceImportDialogProps) {
  const { t } = useTranslation('common');

  const { revealed, hasMore, revealMore } = useBoundedReveal(items.length);

  const hasResults = useMemo(
    () => items.some((i) => i.result !== undefined),
    [items]
  );

  const counts = useMemo(() => {
    const success = items.filter((i) => i.result === 'success').length;
    const failed = items.filter((i) => i.result === 'failed').length;
    const skipped = items.filter((i) => i.result === 'skipped').length;
    return { success, failed, skipped };
  }, [items]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onCancel]);

  const dialogRef = useDialogA11y(open);

  if (!open) return null;

  const renderItemActions = (item: ImportItem) => {
    if (hasResults) {
      if (item.result !== 'failed') return null;
      return (
        <div className="flex items-center gap-2">
          <button
            className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            onClick={() => onRetryItem(item.key)}
          >
            <RotateCcw className="h-3 w-3" />
            {t('import.retry')}
          </button>
          <button
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => onRemoveItem(item.key)}
          >
            {t('import.ignore')}
          </button>
        </div>
      );
    }
    if (item.status === 'valid') {
      return (
        <button
          aria-label="remove-item"
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          onClick={() => onRemoveItem(item.key)}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      );
    }
    return (
      <div className="flex items-center gap-2">
        <button
          className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          onClick={() => onRetryItem(item.key)}
        >
          <RotateCcw className="h-3 w-3" />
          {t('import.retry')}
        </button>
        <button
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={() => onRemoveItem(item.key)}
        >
          {t('import.ignore')}
        </button>
      </div>
    );
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="resource-import-title"
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    >
      <div className="flex max-h-[80vh] w-[520px] flex-col rounded-lg border border-border bg-card shadow-xl animate-fade-in">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2
            id="resource-import-title"
            className="text-lg font-semibold text-foreground"
          >
            {title}
          </h2>
          <button
            className="text-muted-foreground hover:text-foreground transition-colors"
            onClick={onCancel}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t('import.noItems')}
            </p>
          ) : (
            <>
              {items.slice(0, revealed).map((item) => (
                <div
                  key={item.key}
                  data-testid="import-item"
                  className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 p-3"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {hasResults ? (
                      <span
                        className={cn(
                          'shrink-0 rounded px-1.5 py-0.5 text-xs font-medium',
                          RESULT_BADGE[item.result || 'skipped']
                        )}
                      >
                        {item.result === 'success' && (
                          <CheckCircle2 className="mr-0.5 inline h-3 w-3" />
                        )}
                        {item.result === 'failed' && (
                          <XCircle className="mr-0.5 inline h-3 w-3" />
                        )}
                        {item.result === 'skipped' && (
                          <AlertTriangle className="mr-0.5 inline h-3 w-3" />
                        )}
                        {t(`import.result.${item.result || 'skipped'}`)}
                      </span>
                    ) : (
                      <span
                        className={cn(
                          'shrink-0 rounded px-1.5 py-0.5 text-xs font-medium',
                          STATUS_BADGE[item.status]
                        )}
                      >
                        {t(`import.status.${item.status}`)}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {item.name}
                      </p>
                      {item.format && (
                        <span className="text-xs text-muted-foreground">
                          .{item.format}
                        </span>
                      )}
                      {!hasResults && item.reason && (
                        <p className="truncate text-xs text-muted-foreground">
                          {t(`import.reason.${item.reason}`)}
                        </p>
                      )}
                    </div>
                  </div>
                  {renderItemActions(item)}
                </div>
              ))}
              {hasMore && (
                <button
                  data-testid="show-more"
                  className="flex w-full items-center justify-center gap-1 rounded-md border border-border py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  onClick={revealMore}
                >
                  {t('import.showMore', { count: items.length - revealed })}
                </button>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border p-4">
          {hasResults ? (
            <div className="flex items-center gap-3 text-sm">
              <span className="text-success">{counts.success}</span>
              <span className="text-muted-foreground">
                {t('import.result.success')}
              </span>
              <span className="text-error">{counts.failed}</span>
              <span className="text-muted-foreground">
                {t('import.result.failed')}
              </span>
              <span className="text-muted-foreground">{counts.skipped}</span>
              <span className="text-muted-foreground">
                {t('import.result.skipped')}
              </span>
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">
              {items.length} {itemKindLabel}
            </span>
          )}
          <div className="flex gap-2">
            {!hasResults && (
              <button
                className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
                onClick={onAppend}
              >
                <Plus className="h-3.5 w-3.5" />
                {appendLabel}
              </button>
            )}
            {hasResults ? (
              <button
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                onClick={onCancel}
              >
                {t('actions.close')}
              </button>
            ) : (
              <>
                <button
                  className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors"
                  onClick={onCancel}
                >
                  {cancelLabel}
                </button>
                <button
                  className={cn(
                    'rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors',
                    (importing || items.length === 0) &&
                      'pointer-events-none opacity-50'
                  )}
                  onClick={() => onConfirm()}
                >
                  {importing ? t('status.importing') : confirmLabel}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

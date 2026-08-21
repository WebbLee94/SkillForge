import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { CheckCircle2, RotateCcw, AlertTriangle, X, XCircle } from 'lucide-react';
import type { ImportItem } from './ResourceImportDialog';

const RESULT_BADGE = {
  success: 'bg-success/10 text-success',
  failed: 'bg-error/10 text-error',
  skipped: 'bg-muted text-muted-foreground',
} as const;

const STATUS_BADGE = {
  valid: 'bg-success/10 text-success',
  invalid: 'bg-error/10 text-error',
  duplicate: 'bg-warning/10 text-warning',
} as const;

interface ResourceImportDialogListProps {
  readonly items: readonly ImportItem[];
  readonly hasResults: boolean;
  readonly revealed: number;
  readonly hasMore: boolean;
  readonly onRemoveItem: (key: string) => void;
  readonly onRetryItem: (key: string) => void;
  readonly revealMore: () => void;
}

export function ResourceImportDialogList({
  items,
  hasResults,
  revealed,
  hasMore,
  onRemoveItem,
  onRetryItem,
  revealMore,
}: ResourceImportDialogListProps) {
  const { t } = useTranslation('common');

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
                          RESULT_BADGE[(item.result || 'skipped') as keyof typeof RESULT_BADGE]
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
                  STATUS_BADGE[item.status as keyof typeof STATUS_BADGE]
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
                <span className="text-xs text-muted-foreground">.{item.format}</span>
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
  );
}

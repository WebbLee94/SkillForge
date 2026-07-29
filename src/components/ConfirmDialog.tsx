import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';
import { X } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary';
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog = memo(function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant = 'primary',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation('common');

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[400px] rounded-lg border border-border bg-card p-6 shadow-xl animate-fade-in">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <button
            onClick={onCancel}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="text-sm text-muted-foreground mb-6">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
            onClick={onCancel}
          >
            {cancelLabel || t('actions.cancel')}
          </button>
          <button
            className={cn(
              'rounded-lg px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90',
              variant === 'danger' && 'bg-error',
              variant === 'primary' && 'bg-primary'
            )}
            onClick={onConfirm}
          >
            {confirmLabel || t('actions.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
});

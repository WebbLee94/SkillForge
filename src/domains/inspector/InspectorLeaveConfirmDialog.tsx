import { cn } from '../../lib/utils';

interface InspectorLeaveConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  stayLabel: string;
  discardLabel: string;
  saveLabel: string;
  saving: boolean;
  onStay: () => void;
  onDiscard: () => void;
  onSaveAndClose: () => void;
  dialogRef: React.RefObject<HTMLDivElement | null>;
}

export function InspectorLeaveConfirmDialog({
  open,
  title,
  message,
  stayLabel,
  discardLabel,
  saveLabel,
  saving,
  onStay,
  onDiscard,
  onSaveAndClose,
  dialogRef,
}: InspectorLeaveConfirmDialogProps) {
  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="inspector-leave-title"
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    >
      <div className="w-[400px] rounded-lg border border-border bg-card p-6 shadow-xl animate-fade-in">
        <h2 id="inspector-leave-title" className="text-lg font-semibold text-foreground">
          {title}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
            onClick={onStay}
          >
            {stayLabel}
          </button>
          <button
            className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
            onClick={onDiscard}
          >
            {discardLabel}
          </button>
          <button
            className={cn(
              'rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90',
              saving && 'pointer-events-none opacity-60'
            )}
            onClick={onSaveAndClose}
          >
            {saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

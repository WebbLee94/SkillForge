import { X } from 'lucide-react';

interface SceneInvalidRefItem {
  readonly key: string;
  readonly label: string;
}

interface SceneInvalidRefsDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly hint: string;
  readonly cleanupLabel: string;
  readonly useValidLabel: string;
  readonly cancelLabel: string;
  readonly invalidRefs: readonly SceneInvalidRefItem[];
  readonly onClose: () => void;
  readonly onCleanup: () => void;
  readonly onUseValid: () => void;
}

export function SceneInvalidRefsDialog({
  open,
  title,
  hint,
  cleanupLabel,
  useValidLabel,
  cancelLabel,
  invalidRefs,
  onClose,
  onCleanup,
  onUseValid,
}: SceneInvalidRefsDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className="w-[420px] rounded-lg border border-border bg-card p-6 shadow-xl animate-fade-in"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{hint}</p>
        <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-muted-foreground">
          {invalidRefs.map((item) => (
            <li key={item.key}>{item.label}</li>
          ))}
        </ul>
        <div className="mt-6 flex justify-end gap-2">
          <button
            className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
            onClick={onCleanup}
          >
            {cleanupLabel}
          </button>
          <button
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            onClick={onUseValid}
          >
            {useValidLabel}
          </button>
          <button
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
            onClick={onClose}
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

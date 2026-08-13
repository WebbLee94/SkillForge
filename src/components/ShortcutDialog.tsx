import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Check, Minus } from 'lucide-react';
import { cn } from '../lib/utils';

/** 常用快捷键清单。implemented=false 的快捷键仅作展示，不绑定行为。 */
const SHORTCUTS = [
  { keys: ['⌘', 'K'], labelKey: 'shortcuts.search', implemented: false },
  { keys: ['⌘', 'N'], labelKey: 'shortcuts.create', implemented: false },
  { keys: ['Esc'], labelKey: 'shortcuts.closeDialog', implemented: true },
] as const;

interface ShortcutDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ShortcutDialog({ open, onClose }: ShortcutDialogProps) {
  const { t } = useTranslation('common');
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className="w-[400px] rounded-lg border border-border bg-card p-6 shadow-xl animate-fade-in"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">
            {t('shortcuts.title')}
          </h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <ul className="space-y-2">
          {SHORTCUTS.map((s) => (
            <li
              key={s.labelKey}
              className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
            >
              <div className="flex items-center gap-2">
                {s.keys.map((k) => (
                  <kbd
                    key={k}
                    className="rounded border border-border bg-accent px-1.5 py-0.5 text-xs font-medium text-foreground"
                  >
                    {k}
                  </kbd>
                ))}
                <span className="text-sm text-foreground">{t(s.labelKey)}</span>
              </div>
              <span
                className={cn(
                  'flex items-center gap-1 text-xs',
                  s.implemented ? 'text-green-600' : 'text-muted-foreground'
                )}
              >
                {s.implemented ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <Minus className="h-3 w-3" />
                )}
                {s.implemented
                  ? t('shortcuts.implemented')
                  : t('shortcuts.notImplemented')}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-muted-foreground">
          {t('shortcuts.hint')}
        </p>
        <div className="mt-4 flex justify-end">
          <button
            className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
            onClick={onClose}
          >
            {t('actions.close')}
          </button>
        </div>
      </div>
    </div>
  );
}

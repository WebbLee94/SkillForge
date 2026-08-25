import { memo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { X, FolderOpen } from 'lucide-react';

interface AddProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (data: { name: string; path: string }) => void;
}

export const AddProjectDialog = memo(function AddProjectDialog({
  open,
  onClose,
  onConfirm,
}: AddProjectDialogProps) {
  const { t } = useTranslation('distribution');
  const { t: tc } = useTranslation('common');

  const [name, setName] = useState('');
  const [path, setPath] = useState('');

  const handleConfirm = useCallback(() => {
    if (!name.trim() || !path.trim()) return;
    onConfirm({ name: name.trim(), path: path.trim() });
    setName('');
    setPath('');
  }, [name, path, onConfirm]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50">
      <div className="w-[480px] rounded-lg border border-border bg-card p-6 shadow-xl animate-fade-in">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">
            {t('addProjectDialog.title')}
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              {t('projectPath')}
            </label>
            <div className="flex gap-2">
              <input type="text" value={path} onChange={(e) => setPath(e.target.value)}
                placeholder={t('addProjectDialog.selectFolder')}
                className={cn('flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm',
                  'focus:outline-none focus:ring-2 focus:ring-ring')} />
              <button className="flex items-center gap-1 rounded-lg bg-secondary px-3 py-2 text-sm text-secondary-foreground hover:bg-secondary/80"
                onClick={async () => {
                  try {
                    const { open } = await import('@tauri-apps/plugin-dialog');
                    const selected = await open({ directory: true, multiple: false });
                    if (selected && typeof selected === 'string') {
                      setPath(selected);
                      if (!name) setName(selected.split('/').pop() || '');
                    }
                  } catch (e) {
                    console.error('dialog open failed:', e);
                  }
                }}>
                <FolderOpen className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              {t('projectName')}
            </label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder={t('projectNamePlaceholder')}
              className={cn('w-full rounded-lg border border-input bg-background px-3 py-2 text-sm',
                'focus:outline-none focus:ring-2 focus:ring-ring')} />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose}
              className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80">
              {tc('actions.cancel')}
            </button>
            <button onClick={handleConfirm} disabled={!name.trim() || !path.trim()}
              className={cn('rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90',
                (!name.trim() || !path.trim()) && 'opacity-50 pointer-events-none')}>
              {t('addProjectDialog.confirm')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

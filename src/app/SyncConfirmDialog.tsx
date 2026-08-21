import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../stores/appStore';
import { X, AlertTriangle, Plus, Minus, RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';

export const SyncConfirmDialog = memo(function SyncConfirmDialog() {
  const { t: tc } = useTranslation('common');
  const pending = useAppStore((s) => s.pendingSyncConfirm);
  const resolveConfirm = useAppStore((s) => s.resolveSyncConfirm);
  const pendingRemovalConfirmation = useAppStore((s) => s.pendingRemovalConfirmation);

  if (!pending || !resolveConfirm) return null;

  const { platforms } = pending;
  const hasActualRemovals = platforms.some(
    (platform) =>
      platform.skills_to_remove.length > 0 ||
      platform.rules_to_remove.length > 0
  );

  const totalRemove = platforms.reduce(
    (s, p) => s + p.skills_to_remove.length + p.rules_to_remove.length,
    0
  );
  const totalAdd = platforms.reduce(
    (s, p) => s + p.skills_to_add.length + p.rules_to_add.length,
    0
  );
  const totalUpdate = platforms.reduce(
    (s, p) => s + p.skills_to_update.length + p.rules_to_update.length,
    0
  );

  const handleCancel = () => {
    resolveConfirm(false);
  };

  const handleConfirm = () => {
    resolveConfirm(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[520px] max-h-[80vh] overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-xl animate-fade-in">
        <div className="flex items-center justify-between mb-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            {hasActualRemovals ? (
              <AlertTriangle className="h-5 w-5 text-warning" />
            ) : (
              <RefreshCw className="h-5 w-5 text-primary" />
            )}
            {tc('syncConfirm.title')}
          </h2>
          <button
            onClick={handleCancel}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mb-3 text-sm text-muted-foreground">
          {hasActualRemovals ? tc('syncConfirm.warning') : tc('syncConfirm.changes')}
        </p>

        <div className="space-y-3 mb-4">
          {platforms.map((p) => (
            <div
              key={p.platform_id}
              className="rounded-lg border border-border bg-muted/30 p-3"
            >
              <div className="text-sm font-medium text-foreground mb-2">
                {p.platform_name}
              </div>

              {p.skills_to_add.length > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-success mb-1">
                  <Plus className="h-3 w-3 shrink-0" />
                  {tc('syncConfirm.addSkills', {
                    count: p.skills_to_add.length,
                  })}
                </div>
              )}

              {p.skills_to_update.length > 0 && (
                <div
                  className="flex items-center gap-1.5 text-xs text-foreground mb-1"
                  data-testid="update-skills"
                >
                  <RefreshCw className="h-3 w-3 shrink-0" />
                  {tc('syncConfirm.updateSkills', {
                    count: p.skills_to_update.length,
                  })}
                </div>
              )}

              {p.skills_to_remove.length > 0 && (
                <div
                  className="flex items-center gap-1.5 text-xs text-warning mb-1"
                  data-testid="remove-skills"
                >
                  <Minus className="h-3 w-3 shrink-0" />
                  {tc('syncConfirm.removeSkills', {
                    count: p.skills_to_remove.length,
                  })}
                  <span className="text-muted-foreground ml-1 truncate max-w-[200px]">
                    {p.skills_to_remove.slice(0, 5).join(', ')}
                    {p.skills_to_remove.length > 5 && ' ...'}
                  </span>
                </div>
              )}

              {p.rules_to_add.length > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-success mb-1">
                  <Plus className="h-3 w-3 shrink-0" />
                  {tc('syncConfirm.addRules', { count: p.rules_to_add.length })}
                </div>
              )}

              {p.rules_to_update.length > 0 && (
                <div
                  className="flex items-center gap-1.5 text-xs text-foreground mb-1"
                  data-testid="update-rules"
                >
                  <RefreshCw className="h-3 w-3 shrink-0" />
                  {tc('syncConfirm.updateRules', {
                    count: p.rules_to_update.length,
                  })}
                </div>
              )}

              {p.rules_to_remove.length > 0 && (
                <div
                  className="flex items-center gap-1.5 text-xs text-warning"
                  data-testid="remove-rules"
                >
                  <Minus className="h-3 w-3 shrink-0" />
                  {tc('syncConfirm.removeRules', {
                    count: p.rules_to_remove.length,
                  })}
                  <span className="text-muted-foreground ml-1 truncate max-w-[200px]">
                    {p.rules_to_remove.slice(0, 5).join(', ')}
                    {p.rules_to_remove.length > 5 && ' ...'}
                  </span>
                </div>
              )}

              {p.skills_to_add.length === 0 &&
                p.skills_to_update.length === 0 &&
                p.skills_to_remove.length === 0 &&
                p.rules_to_add.length === 0 &&
                p.rules_to_update.length === 0 &&
                p.rules_to_remove.length === 0 && (
                  <div className="text-xs text-muted-foreground italic">
                    {tc('syncConfirm.noChanges')}
                  </div>
                )}
            </div>
          ))}
        </div>

        {(totalAdd > 0 || totalUpdate > 0 || totalRemove > 0) && (
          <p className="mb-4 text-xs text-muted-foreground">
            {tc('syncConfirm.summary', {
              add: totalAdd,
              update: totalUpdate,
              remove: totalRemove,
            })}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
            onClick={handleCancel}
          >
            {tc('actions.cancel')}
          </button>
          <button
            className={cn(
              'rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90'
            )}
            onClick={handleConfirm}
          >
            {pendingRemovalConfirmation && hasActualRemovals
              ? tc('syncConfirm.confirmRemoval', { count: totalRemove })
              : tc('syncConfirm.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
});

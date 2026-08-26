import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { X, Download } from 'lucide-react';
import { getPlatformIcon } from '../../components/icons/PlatformIcons';
import type { PlatformScanResult } from '../../types';

interface ImportPreviewDialogProps {
  open: boolean;
  platforms: PlatformScanResult[];
  totalNew: number;
  totalSkipped: number;
  importing: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export const ImportPreviewDialog = memo(function ImportPreviewDialog({
  open,
  platforms,
  totalNew,
  totalSkipped,
  importing,
  onClose,
  onConfirm,
}: ImportPreviewDialogProps) {
  const { t: tc } = useTranslation('common');

  if (!open) return null;

  const newSkills = platforms.reduce((s, p) => s + p.new_skills.length, 0);
  const newRules = platforms.reduce((s, p) => s + p.new_rules.length, 0);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50">
      <div className="w-[540px] max-h-[80vh] overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-xl animate-fade-in">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">
            {tc('import.previewTitle')}
          </h2>
          <button
            onClick={onClose}
            disabled={importing}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {platforms.length > 0 ? (
          <>
            <div className="space-y-3 mb-4">
              {platforms.map((p) => {
                const PlatformIcon = getPlatformIcon(p.platform_id);
                return (
                  <div
                    key={p.platform_id}
                    className="rounded-lg border border-border bg-muted/30 p-3"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      {PlatformIcon && <PlatformIcon className="h-4 w-4" />}
                      <span className="text-sm font-medium text-foreground">
                        {p.platform_name}
                      </span>
                    </div>
                    <div className="flex gap-4 text-xs text-muted-foreground">
                      {p.new_skills.length > 0 && (
                        <span className="text-success">
                          +{p.new_skills.length} {tc('import.newSkills')}
                        </span>
                      )}
                      {p.new_rules.length > 0 && (
                        <span className="text-success">
                          +{p.new_rules.length} {tc('import.newRules')}
                        </span>
                      )}
                      {(p.existing_skills > 0 || p.existing_rules > 0) && (
                        <span>
                          {p.existing_skills + p.existing_rules}{' '}
                          {tc('import.existing')}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <p className="mb-4 text-xs text-muted-foreground">
              {tc('import.summary', {
                skills: newSkills,
                rules: newRules,
                skipped: totalSkipped,
              })}
            </p>
          </>
        ) : (
          <p className="mb-4 text-sm text-muted-foreground">
            {tc('import.noDiscoverable')}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
            onClick={onClose}
            disabled={importing}
          >
            {tc('actions.cancel')}
          </button>
          {totalNew > 0 && (
            <button
              className={cn(
                'rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90',
                importing && 'opacity-50 pointer-events-none'
              )}
              onClick={onConfirm}
              disabled={importing}
            >
              {importing ? (
                <span className="flex items-center gap-2">
                  <Download className="h-4 w-4 animate-pulse" />
                  {tc('import.importing')}
                </span>
              ) : (
                tc('import.confirmImport', { count: totalNew })
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

import { Film, Package, Trash2 } from 'lucide-react';

interface SceneDetailActionsProps {
  readonly useForDistributionLabel: string;
  readonly configureLabel: string;
  readonly deleteLabel: string;
  readonly onUseForDistribution: () => void;
  readonly onConfigure: () => void;
  readonly onDelete: () => void;
}

export function SceneDetailActions({
  useForDistributionLabel,
  configureLabel,
  deleteLabel,
  onUseForDistribution,
  onConfigure,
  onDelete,
}: SceneDetailActionsProps) {
  return (
    <div className="mt-4 flex flex-row flex-wrap items-center gap-2" data-testid="scene-actions">
      <button
        className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        onClick={onUseForDistribution}
      >
        <Film className="h-4 w-4" />
        {useForDistributionLabel}
      </button>
      <button
        className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-accent/40"
        onClick={onConfigure}
      >
        <Package className="h-4 w-4" />
        {configureLabel}
      </button>
      <button
        className="flex items-center gap-1 rounded-lg border border-error/30 px-2 py-1.5 text-sm text-error transition-colors hover:bg-error/10"
        onClick={onDelete}
      >
        <Trash2 className="h-4 w-4" />
        {deleteLabel}
      </button>
    </div>
  );
}

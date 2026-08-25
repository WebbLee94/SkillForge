import { CheckSquare, Plus } from 'lucide-react';

interface ProjectDistributionToolbarProps {
  readonly title: string;
  readonly subtitle: string;
  readonly batchEnabled: boolean;
  readonly batchSelectLabel: string;
  readonly exitSelectLabel: string;
  readonly addProjectLabel: string;
  readonly onToggleBatch: () => void;
  readonly onAddProject: () => void;
}

export function ProjectDistributionToolbar({
  title,
  subtitle,
  batchEnabled,
  batchSelectLabel,
  exitSelectLabel,
  addProjectLabel,
  onToggleBatch,
  onAddProject,
}: ProjectDistributionToolbarProps) {
  return (
    <div className="page-toolbar flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="page-title mb-1 text-foreground">{title}</h1>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <div
        data-testid="project-page-actions"
        className="flex shrink-0 items-center gap-2"
      >
        <button
          aria-label="batchMode"
          onClick={onToggleBatch}
          className={`inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2.5 text-sm font-medium text-foreground hover:bg-accent transition-colors ${
            batchEnabled ? 'border-primary/30 bg-primary/10' : ''
          }`}
        >
          <CheckSquare className="h-4 w-4" />
          {batchEnabled ? exitSelectLabel : batchSelectLabel}
        </button>
        <button
          onClick={onAddProject}
          className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> {addProjectLabel}
        </button>
      </div>
    </div>
  );
}

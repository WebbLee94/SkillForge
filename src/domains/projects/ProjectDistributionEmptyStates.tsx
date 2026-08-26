import { Folder, OctagonX, Settings } from 'lucide-react';

interface ProjectDistributionEmptyProjectsStateProps {
  readonly title: string;
  readonly hint: string;
}

interface ProjectDistributionNoPlatformsStateProps {
  readonly title: string;
  readonly hint: string;
  readonly actionLabel: string;
  readonly onGoToSettings: () => void;
}

export function ProjectDistributionEmptyProjectsState({
  title,
  hint,
}: ProjectDistributionEmptyProjectsStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Folder className="mb-4 h-10 w-10 text-muted-foreground" />
      <h2 className="mb-2 text-lg font-semibold text-foreground">{title}</h2>
      <p className="mb-6 max-w-md text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}

export function ProjectDistributionNoPlatformsState({
  title,
  hint,
  actionLabel,
  onGoToSettings,
}: ProjectDistributionNoPlatformsStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <OctagonX className="mb-4 h-10 w-10 text-muted-foreground" />
      <h2 className="mb-2 text-lg font-semibold text-foreground">{title}</h2>
      <p className="mb-6 max-w-md text-sm text-muted-foreground">{hint}</p>
      <button
        onClick={onGoToSettings}
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        <Settings className="h-4 w-4" /> {actionLabel}
      </button>
    </div>
  );
}

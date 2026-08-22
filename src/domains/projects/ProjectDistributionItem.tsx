import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, FolderOpen, Send } from 'lucide-react';
import { sanitizePath } from '../../lib/utils';
import { ipc } from '../../lib/ipc';
import type { Platform, PlatformEntryCount, Project } from '../../types';

interface ProjectDistributionItemProps {
  project: Project;
  enabledPlatforms: readonly Platform[];
  stats: Record<string, PlatformEntryCount> | undefined;
  batchEnabled: boolean;
  isSelected: boolean;
  editing: boolean;
  editNameValue: string;
  onSelectToggle: () => void;
  onEditStart: () => void;
  onEditNameChange: (value: string) => void;
  onEditCommit: () => void;
  onEditCancel: () => void;
  onGoDistribute: () => void;
  onRevealFallback: () => void;
  onRevealFailed: () => void;
}

function isMacOS() {
  return (
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '')
  );
}

function ProjectStatsRow({
  enabledPlatforms,
  stats,
  t,
}: {
  enabledPlatforms: readonly Platform[];
  stats: Record<string, PlatformEntryCount> | undefined;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const rows = enabledPlatforms
    .map((platform) => {
      const entry = stats?.[platform.id];
      return {
        platform,
        skills: entry?.skills ?? 0,
        rules: entry?.rules ?? 0,
        dirExists: entry?.dir_exists ?? false,
      };
    })
    .filter((r) => r.dirExists && (r.skills > 0 || r.rules > 0));

  if (rows.length === 0) {
    return (
      <div className="mt-1 text-xs text-muted-foreground" data-testid="project-stats-empty">
        {t('projects.statsEmpty')}
      </div>
    );
  }

  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {rows.map((r) => (
        <span
          key={r.platform.id}
          data-testid={`project-stats-chip-${r.platform.id}`}
          title={t('projectPlatformStatsFull', {
            platform: r.platform.name,
            skills: r.skills,
            rules: r.rules,
          })}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground hover:border-primary/40"
        >
          {t('projectPlatformStatsShort', {
            platform: r.platform.name,
            skills: r.skills,
            rules: r.rules,
          })}
        </span>
      ))}
    </div>
  );
}

export const ProjectDistributionItem = memo(function ProjectDistributionItem({
  project,
  enabledPlatforms,
  stats,
  batchEnabled,
  isSelected,
  editing,
  editNameValue,
  onSelectToggle,
  onEditStart,
  onEditNameChange,
  onEditCommit,
  onEditCancel,
  onGoDistribute,
  onRevealFallback,
  onRevealFailed,
}: ProjectDistributionItemProps) {
  const { t } = useTranslation(['distribution', 'common']);

  return (
    <li
      data-testid={`project-card-${project.id}`}
      className="group/card rounded-lg border border-border bg-card p-3"
    >
      <div className="flex items-center gap-3">
        {batchEnabled && (
          <input
            type="checkbox"
            data-testid={`batch-check-${project.id}`}
            aria-label={`select ${project.name}`}
            checked={isSelected}
            onChange={onSelectToggle}
            className="h-4 w-4 shrink-0"
          />
        )}
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              type="text"
              data-testid="rename-input"
              value={editNameValue}
              onChange={(e) => onEditNameChange(e.target.value)}
              onBlur={onEditCommit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onEditCommit();
                if (e.key === 'Escape') onEditCancel();
              }}
              autoFocus
              className="w-full rounded border border-input bg-background px-2 py-1 text-sm"
            />
          ) : (
            <div
              data-testid={`project-name-zone-${project.id}`}
              className="group flex items-center gap-2"
            >
              <span className="truncate font-medium">{project.name}</span>
              <button
                aria-label="renameProject"
                data-testid={`project-rename-${project.id}`}
                onClick={onEditStart}
                className="shrink-0 rounded-md border border-border p-1 text-xs text-muted-foreground action-reveal hover:bg-accent hover:text-foreground"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          <div data-testid={`project-path-zone-${project.id}`} className="group flex items-center gap-2">
            <div className="truncate text-xs text-muted-foreground">{sanitizePath(project.path)}</div>
            <button
              aria-label={isMacOS() ? t('ws.revealMac') : t('ws.revealWin')}
              title={isMacOS() ? t('ws.revealMac') : t('ws.revealWin')}
              data-testid={`project-reveal-${project.id}`}
              onClick={async () => {
                try {
                  const res = await ipc.revealPath(project.path, false);
                  if (res.fallback) onRevealFallback();
                } catch {
                  onRevealFailed();
                }
              }}
              className="shrink-0 rounded-md border border-border p-1 text-xs text-muted-foreground action-reveal hover:bg-accent hover:text-foreground"
            >
              <FolderOpen className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <button
          data-testid={`go-distribute-${project.id}`}
          onClick={onGoDistribute}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
        >
          <Send className="h-3.5 w-3.5" />
          {t('goDistributeInWorkspace')}
        </button>
      </div>

      <ProjectStatsRow enabledPlatforms={enabledPlatforms} stats={stats} t={t} />
    </li>
  );
});

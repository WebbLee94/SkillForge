import { getPlatformIcon } from '../../components/icons/PlatformIcons';
import type { PlatformEntryCount } from '../../types';
import type { Platform } from '../../types';

interface DashboardQuickEntryProps {
  platforms: readonly Platform[];
  liveCounts: Record<string, PlatformEntryCount>;
  onChooseTarget: (platformId: string) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export function DashboardQuickEntry({
  platforms,
  liveCounts,
  onChooseTarget,
  t,
}: DashboardQuickEntryProps) {
  if (platforms.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t('messages.noData')}</p>
    );
  }

  return (
    <div className="divide-y divide-border rounded-lg border border-border">
      {platforms.map((platform) => {
        const cnt = liveCounts[platform.id];
        const skills = cnt?.skills ?? 0;
        const rules = cnt?.rules ?? 0;
        const Icon = getPlatformIcon(platform.id);

        return (
          <div
            key={platform.id}
            className="flex items-center justify-between gap-3 px-4 py-2.5"
          >
            <div className="flex min-w-0 items-center gap-3">
              <Icon className="h-5 w-5 shrink-0" />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">
                  {platform.name}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t('dashboard.quickEntry.skillRuleCount', { skills, rules })}
                </div>
              </div>
            </div>
            <button
              className="shrink-0 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-accent/50"
              onClick={() => onChooseTarget(platform.id)}
            >
              {t('dashboard.quickEntry.chooseTarget')}
            </button>
          </div>
        );
      })}
    </div>
  );
}

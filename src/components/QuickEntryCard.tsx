import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';
import { getPlatformIcon } from './icons/PlatformIcons';
import type { Platform, PlatformEntryCount } from '../types';

interface QuickEntryCardProps {
  platforms: Platform[];
  counts: Record<string, PlatformEntryCount>;
  onChooseTarget: (platformId: string) => void;
}

/** 快捷入口：仅列已开启平台，显示技能 N · 规则 N 摘要与「选择为目标」。 */
export function QuickEntryCard({
  platforms,
  counts,
  onChooseTarget,
}: QuickEntryCardProps) {
  const { t } = useTranslation('common');

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-foreground">
          {t('dashboard.quickEntry.title')}
        </h2>
        <Globe className="h-4 w-4 text-primary" />
      </div>
      {platforms.length > 0 ? (
        <div className="divide-y divide-border rounded-lg border border-border">
          {platforms.map((p) => {
            const cnt = counts[p.id];
            const skills = cnt?.skills ?? 0;
            const rules = cnt?.rules ?? 0;
            const Icon = getPlatformIcon(p.id);
            return (
              <div
                key={p.id}
                className="flex items-center justify-between gap-3 px-4 py-2.5"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Icon className="h-5 w-5 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">
                      {p.name}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t('dashboard.quickEntry.skillRuleCount', {
                        skills,
                        rules,
                      })}
                    </div>
                  </div>
                </div>
                <button
                  className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary/50 hover:bg-accent/50 transition-colors shrink-0"
                  onClick={() => onChooseTarget(p.id)}
                >
                  {t('dashboard.quickEntry.chooseTarget')}
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t('messages.noData')}</p>
      )}
    </div>
  );
}

import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { TooltipPortal } from '../../components/common/TooltipPortal';
import { getPlatformIcon } from '../../components/icons/PlatformIcons';
import { cn } from '../../lib/utils';
import { Clipboard } from 'lucide-react';
import type {
  Platform,
  PlatformCapabilities,
  PlatformEntryCount,
} from '../../types';

interface PlatformsPanelProps {
  readonly platforms: readonly Platform[];
  readonly platformsLoading: boolean;
  readonly capabilitiesMap: Readonly<Record<string, PlatformCapabilities>>;
  readonly countsMap: Readonly<Record<string, PlatformEntryCount>>;
  readonly togglingId: string | null;
  readonly tooltipPlatformId: string | null;
  readonly pinnedPlatformId: string | null;
  readonly onTogglePlatform: (platform: Platform) => void;
  readonly onCopyPath: (path: string) => void;
  readonly onShowTooltip: (platformId: string) => void;
  readonly onHideTooltip: (platformId: string) => void;
  readonly onPinTooltip: (platformId: string) => void;
  readonly onUnpinTooltip: (platformId: string) => void;
  readonly onClearTooltipCloseDelay: () => void;
  readonly onScheduleTooltipClose: (platformId: string) => void;
  readonly triggerRefs: React.RefObject<Map<string, HTMLButtonElement | null>>;
}

export function PlatformsPanel({
  platforms,
  platformsLoading,
  capabilitiesMap,
  countsMap,
  togglingId,
  tooltipPlatformId,
  pinnedPlatformId,
  onTogglePlatform,
  onCopyPath,
  onShowTooltip,
  onHideTooltip,
  onPinTooltip,
  onUnpinTooltip,
  onClearTooltipCloseDelay,
  onScheduleTooltipClose,
  triggerRefs,
}: PlatformsPanelProps) {
  const { t } = useTranslation('settings');

  return (
    <div data-testid="platform-table-wrap" className="max-w-[1180px] space-y-3 pt-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">
          {t('settings:platforms.title')}
        </h3>
      </div>

      {platformsLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                  {t('settings:platforms.columns.name')}
                </th>
                <th className="px-4 py-2.5 text-center font-medium text-muted-foreground">
                  {t('settings:platforms.columns.capabilities')}
                </th>
                <th className="w-20 px-4 py-2.5 text-center font-medium text-muted-foreground">
                  {t('settings:platforms.columns.status')}
                </th>
              </tr>
            </thead>
            <tbody>
              {platforms.map((platform) => {
                const IconComp = getPlatformIcon(platform.id);
                const isToggling = togglingId === platform.id;
                const caps = capabilitiesMap[platform.id];
                const cnt = countsMap[platform.id];
                return (
                  <tr key={platform.id} className="border-b border-border last:border-0">
                    <td className={cn('px-4 py-3', !platform.enabled && 'opacity-60')}>
                      <div className="flex items-center gap-3">
                        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/60">
                          <IconComp className="h-5 w-5 text-muted-foreground" />
                          <span
                            className={cn(
                              'absolute -right-0.5 -top-0.1 h-2 w-2 rounded-full border-2 border-background',
                              platform.enabled ? 'bg-success' : 'bg-muted'
                            )}
                          />
                        </span>
                        <div className="min-w-0">
                          <div className="font-medium text-foreground">{platform.name}</div>
                          {platform.enabled && cnt ? (
                            <div className="text-xs text-muted-foreground">
                              {t('settings:platforms.countsFormat', {
                                skills: cnt.skills,
                                rules: cnt.rules,
                              })}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-2 text-center">
                      {(() => {
                        if (!caps)
                          return <span className="text-xs text-muted-foreground">-</span>;
                        const capabilityRows = [
                          ['S', caps.skills_global, platform.paths?.global_skills_dir],
                          ['S', caps.skills_project, platform.paths?.project_skills_pattern],
                          ['R', caps.rules_global, platform.paths?.global_rules_dir],
                          ['R', caps.rules_project, platform.paths?.project_rules_pattern],
                        ] as const;
                        const capabilityLabels = [
                          t('settings:platforms.capLabels.skillsGlobal'),
                          t('settings:platforms.capLabels.skillsProject'),
                          t('settings:platforms.capLabels.rulesGlobal'),
                          t('settings:platforms.capLabels.rulesProject'),
                        ];
                        const triggerRef = {
                          current: triggerRefs.current.get(platform.id) ?? null,
                        };
                        return (
                          <div className="relative">
                            <button
                              type="button"
                              ref={(el) => {
                                triggerRefs.current.set(platform.id, el);
                              }}
                              aria-label={t('settings:platforms.capLabels.openTooltip', {
                                name: platform.name,
                              })}
                              className="inline-flex items-center gap-1 rounded-md px-0.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-ring"
                              onFocus={() => onShowTooltip(platform.id)}
                              onBlur={(e) => {
                                if (pinnedPlatformId === platform.id) return;
                                const next = e.relatedTarget as HTMLElement | null;
                                if (next?.closest('[data-tooltip-panel]')) return;
                                onHideTooltip(platform.id);
                              }}
                              onMouseEnter={() => {
                                onClearTooltipCloseDelay();
                                onShowTooltip(platform.id);
                              }}
                              onMouseLeave={() => onScheduleTooltipClose(platform.id)}
                              onClick={() => {
                                if (pinnedPlatformId === platform.id) {
                                  onUnpinTooltip(platform.id);
                                  onHideTooltip(platform.id);
                                } else {
                                  onPinTooltip(platform.id);
                                  onShowTooltip(platform.id);
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') {
                                  onUnpinTooltip(platform.id);
                                  onHideTooltip(platform.id);
                                }
                              }}
                            >
                              {capabilityRows.map((row, i) => {
                                const supported = row[1] === true && !!row[2];
                                return (
                                  <span
                                    key={`${i}-${row[0]}`}
                                    title={capabilityLabels[i]}
                                    className={cn(
                                      'flex h-5 w-5 items-center justify-center rounded text-[11px] font-medium',
                                      supported
                                        ? 'bg-success/10 text-success'
                                        : 'bg-muted text-muted-foreground'
                                    )}
                                  >
                                    {row[0]}
                                  </span>
                                );
                              })}
                            </button>
                            <TooltipPortal
                              open={
                                tooltipPlatformId === platform.id ||
                                pinnedPlatformId === platform.id
                              }
                              triggerRef={triggerRef}
                              onMouseEnter={onClearTooltipCloseDelay}
                              onMouseLeave={() => onScheduleTooltipClose(platform.id)}
                              onBlur={(e) => {
                                if (pinnedPlatformId === platform.id) return;
                                const next = e.relatedTarget as HTMLElement | null;
                                if (triggerRefs.current.get(platform.id) === next)
                                  return;
                                if (next?.closest('[data-tooltip-panel]')) return;
                                onHideTooltip(platform.id);
                              }}
                            >
                              <div className="text-xs">
                                <div className="mb-2 font-medium text-foreground">
                                  {t('settings:platforms.capLabels.tooltipTitle', {
                                    name: platform.name,
                                  })}
                                </div>
                                <div
                                  data-testid="platform-path-tooltip"
                                  className="grid grid-cols-[76px_minmax(0,1fr)] gap-x-4 gap-y-1"
                                >
                                  {capabilityRows.map((row, i) => {
                                    const supported = row[1] === true && !!row[2];
                                    return (
                                      <Fragment key={`${i}-${row[0]}`}>
                                        <span className="text-muted-foreground">
                                          {capabilityLabels[i]}
                                        </span>
                                        {supported ? (
                                          <span className="flex min-w-0 items-center gap-1.5">
                                            <span className="min-w-0 font-mono text-foreground [overflow-wrap:anywhere]">
                                              {row[2]}
                                            </span>
                                            <button
                                              type="button"
                                              className="shrink-0 text-muted-foreground hover:text-primary"
                                              onClick={() => onCopyPath(row[2] as string)}
                                              title={t('settings:platforms.capLabels.copyPath')}
                                            >
                                              <Clipboard className="h-3 w-3" />
                                            </button>
                                          </span>
                                        ) : (
                                          <span className="text-muted-foreground/50">
                                            {t('settings:platforms.capLabels.notSupported')}
                                          </span>
                                        )}
                                      </Fragment>
                                    );
                                  })}
                                </div>
                              </div>
                            </TooltipPortal>
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => onTogglePlatform(platform)}
                        disabled={isToggling}
                        className={cn(
                          'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                          platform.enabled ? 'bg-primary' : 'bg-muted',
                          isToggling && 'cursor-wait'
                        )}
                        role="switch"
                        aria-checked={platform.enabled}
                        title={
                          platform.enabled
                            ? t('settings:platforms.actions.disable')
                            : t('settings:platforms.actions.enable')
                        }
                      >
                        <span
                          className={cn(
                            'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow ring-0 transition-transform duration-200 ease-in-out',
                            platform.enabled ? 'translate-x-4' : 'translate-x-0'
                          )}
                        />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground/70 px-1">
        {t('settings:platforms.hint')}
      </p>
    </div>
  );
}

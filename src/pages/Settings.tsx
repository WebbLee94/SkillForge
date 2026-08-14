import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { ipc } from '../lib/ipc';
import { cn } from '../lib/utils';
import { SELECT_CLASSES } from '../lib/ui-tokens';
import { ExternalLink, Database, FolderOpen, Clipboard } from 'lucide-react';
import { TooltipPortal } from '../components/TooltipPortal';
import { getPlatformIcon } from '../components/icons/PlatformIcons';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { useAppStore } from '../stores/appStore';
import { useTheme } from '../hooks/useTheme';
import type {
  Platform,
  PlatformCapabilities,
  PlatformEntryCount,
} from '../types';

type SettingsTab = 'general' | 'platforms';

const APP_VERSION = '1.1.0';
const GITHUB_URL = 'https://github.com/WebbLee94/SkillForge';
const LANG_STORAGE_KEY = 'skillforge-lang';
const AUTO_UPDATE_STORAGE_KEY = 'skillforge-auto-check-updates';

function resolveSystemLanguage(): string {
  const browserLang = navigator.language || 'zh-CN';
  if (browserLang.startsWith('zh')) return 'zh-CN';
  return 'en-US';
}

function getStoredLanguage(): string {
  const stored = localStorage.getItem(LANG_STORAGE_KEY);
  if (stored === 'system') return 'system';
  if (stored === 'zh-CN' || stored === 'en-US') return stored;
  return 'system';
}

export function Settings() {
  const { t, i18n } = useTranslation(['common', 'settings']);
  const addToast = useAppStore((s) => s.addToast);
  const { isDark, setTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [autoCheckUpdates, setAutoCheckUpdates] = useState<boolean>(() => {
    try {
      return localStorage.getItem(AUTO_UPDATE_STORAGE_KEY) !== 'false';
    } catch {
      return true;
    }
  });
  const [dataDir, setDataDir] = useState('~/.skillforge/');
  const [rawDataDir, setRawDataDir] = useState<string | null>(null);
  const [dbSize, setDbSize] = useState<string | null>(null);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [platformsLoading, setPlatformsLoading] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [capabilitiesMap, setCapabilitiesMap] = useState<
    Record<string, PlatformCapabilities>
  >({});
  const [countsMap, setCountsMap] = useState<
    Record<string, PlatformEntryCount>
  >({});
  const [tooltipPlatformId, setTooltipPlatformId] = useState<string | null>(
    null
  );
  const [pinnedPlatformId, setPinnedPlatformId] = useState<string | null>(null);
  const closeDelayRef = useRef<number | null>(null);
  const triggerRefs = useRef(new Map<string, HTMLButtonElement | null>());

  const clearTooltipCloseDelay = useCallback(() => {
    if (closeDelayRef.current !== null) {
      window.clearTimeout(closeDelayRef.current);
      closeDelayRef.current = null;
    }
  }, []);

  const scheduleTooltipClose = useCallback(
    (id: string) => {
      clearTooltipCloseDelay();
      closeDelayRef.current = window.setTimeout(() => {
        closeDelayRef.current = null;
        setTooltipPlatformId((cur) => (cur === id ? null : cur));
      }, 150);
    },
    [clearTooltipCloseDelay]
  );

  useEffect(() => {
    return () => {
      if (closeDelayRef.current !== null) {
        window.clearTimeout(closeDelayRef.current);
      }
    };
  }, []);

  // Resolve the effective language for the <select> value
  const effectiveLang = (() => {
    const stored = getStoredLanguage();
    if (stored === 'system') return 'system';
    return i18n.language;
  })();

  useEffect(() => {
    ipc
      .getAppConfig()
      .then((config) => {
        setRawDataDir(config.data_dir);
        // T9: Replace absolute home path with ~
        const homeDir = config.data_dir.split('/.skillforge')[0];
        setDataDir(config.data_dir.replace(homeDir, '~'));
      })
      .catch(() => {
        // fallback to default
      });
  }, []);

  useEffect(() => {
    ipc
      .getDbSize()
      .then((size) => {
        setDbSize(size);
      })
      .catch(() => {
        setDbSize(null);
      });
  }, []);

  useEffect(() => {
    if (activeTab === 'platforms') {
      setPlatformsLoading(true);
      ipc
        .listPlatforms()
        .then((list) => {
          setPlatforms(list);
          setPlatformsLoading(false);
        })
        .catch(() => {
          setPlatformsLoading(false);
        });
    }
  }, [activeTab]);

  useEffect(() => {
    const fetchCaps = async () => {
      const map: Record<string, PlatformCapabilities> = {};
      for (const p of platforms) {
        try {
          map[p.id] = await ipc.getCapabilities(p.id);
        } catch (e) {
          console.error('getCapabilities failed:', e);
        }
      }
      setCapabilitiesMap(map);
    };
    if (platforms.length > 0) fetchCaps();
  }, [platforms]);

  useEffect(() => {
    if (platforms.length === 0) return;
    let cancelled = false;
    Promise.all(
      platforms.map((p) => ipc.countPlatformEntries(p.id).catch(() => null))
    ).then((results) => {
      if (cancelled) return;
      const next: Record<string, PlatformEntryCount> = {};
      for (const r of results) {
        if (r) next[r.platform_id] = r;
      }
      setCountsMap(next);
    });
    return () => {
      cancelled = true;
    };
  }, [platforms]);

  const handleLanguageChange = useCallback(
    (lng: string) => {
      localStorage.setItem(LANG_STORAGE_KEY, lng);
      if (lng === 'system') {
        i18n.changeLanguage(resolveSystemLanguage());
      } else {
        i18n.changeLanguage(lng);
      }
    },
    [i18n]
  );

  const handleAutoCheckChange = useCallback((checked: boolean) => {
    setAutoCheckUpdates(checked);
    try {
      localStorage.setItem(AUTO_UPDATE_STORAGE_KEY, String(checked));
    } catch {
      /* storage unavailable — preference applies for this session only */
    }
  }, []);

  const handleTogglePlatform = useCallback(async (platform: Platform) => {
    setTogglingId(platform.id);
    try {
      await ipc.togglePlatformEnabled(platform.id, !platform.enabled);
      const list = await ipc.listPlatforms();
      setPlatforms(list);
    } catch (e) {
      console.error('togglePlatformEnabled failed:', e);
    } finally {
      setTogglingId(null);
    }
  }, []);

  const tabs: { key: SettingsTab; label: string }[] = [
    { key: 'general', label: t('settings:tabs.general') },
    { key: 'platforms', label: t('settings:tabs.platforms') },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-border py-1.5">
        <h1 className="text-xl font-semibold text-foreground">
          {t('settings:title')}
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('settings:subtitle')}
        </p>
      </div>

      {/* Top chips */}
      <div className="shrink-0 border-b border-border py-2">
        <div role="tablist" className="flex items-center gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={activeTab === tab.key}
              className={cn(
                'rounded-full px-4 py-1.5 text-sm transition-colors',
                activeTab === tab.key
                  ? 'bg-accent font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
              )}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Single column content */}
      <div className="flex-1 overflow-y-auto pt-3">
        {activeTab === 'general' && (
          <div
            data-testid="general-content"
            className="max-w-[1180px] space-y-3 pt-3"
          >
            {/* Language */}
            <div
              data-testid="general-card"
              className="rounded-lg border border-border bg-card p-4"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-foreground">
                    {t('settings:general.language.title')}
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t('settings:general.language.desc')}
                  </p>
                </div>
                <select
                  data-testid="settings-lang"
                  value={effectiveLang}
                  onChange={(e) => handleLanguageChange(e.target.value)}
                  className={cn(SELECT_CLASSES, 'w-36')}
                >
                  <option value="system">
                    {t('settings:general.languageSystem')}
                  </option>
                  <option value="zh-CN">简体中文</option>
                  <option value="en-US">English</option>
                </select>
              </div>
            </div>

            {/* Dark mode */}
            <div
              data-testid="general-card"
              className="rounded-lg border border-border bg-card p-4"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-foreground">
                    {t('settings:general.darkMode.title')}
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t('settings:general.darkMode.desc')}
                  </p>
                  <p
                    data-testid="dark-mode-current"
                    className="mt-0.5 text-xs text-muted-foreground"
                  >
                    {t('settings:general.darkMode.current', {
                      mode: isDark
                        ? t('settings:general.darkMode.modeDark')
                        : t('settings:general.darkMode.modeLight'),
                    })}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isDark}
                  aria-label={t('settings:general.darkMode.title')}
                  onClick={() => setTheme(isDark ? 'light' : 'dark')}
                  className={cn(
                    'relative h-5 w-9 shrink-0 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                    isDark ? 'bg-primary' : 'bg-muted'
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-0.5 h-4 w-4 rounded-full bg-background shadow transition-transform',
                      isDark ? 'translate-x-4' : 'translate-x-0.5'
                    )}
                  />
                </button>
              </div>
            </div>

            {/* Update */}
            <div
              data-testid="general-card"
              className="rounded-lg border border-border bg-card p-4"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-foreground">
                    {t('settings:general.update.title')}
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t('settings:general.update.desc')}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    className="flex items-center gap-1.5 rounded-lg bg-muted px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-accent"
                    onClick={() => addToast(t('topbar.notImplemented'), 'info')}
                  >
                    {t('settings:general.update.checkButton')}
                  </button>
                  <input
                    type="checkbox"
                    role="switch"
                    aria-checked={autoCheckUpdates}
                    checked={autoCheckUpdates}
                    onChange={(e) => handleAutoCheckChange(e.target.checked)}
                    aria-label={t('settings:general.update.autoCheckLabel')}
                    className="h-4 w-4"
                  />
                </div>
              </div>
            </div>

            {/* Data directory + DB size */}
            <div
              data-testid="general-card"
              className="rounded-lg border border-border bg-card p-4"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-foreground">
                    {t('settings:general.dataDir.title')}
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t('settings:general.dataDir.desc')}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
                    <Database className="h-3 w-3" />
                    <span>
                      {dbSize ?? t('settings:general.dbSizeCalculating')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5 text-sm text-foreground">
                    <button
                      className="text-muted-foreground hover:text-primary transition-colors"
                      onClick={() => rawDataDir && revealItemInDir(rawDataDir)}
                      title={t(
                        'settings:platforms.capLabels.openInFileManager'
                      )}
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                    </button>
                    <span className="font-mono text-xs">{dataDir}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Version & community */}
            <div
              data-testid="general-card"
              className="rounded-lg border border-border bg-card p-4"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-foreground">
                    {t('settings:general.community.title')}
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t('settings:general.community.desc', {
                      version: APP_VERSION,
                    })}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="rounded-lg bg-muted px-3 py-1.5 text-xs font-mono text-foreground">
                    v{APP_VERSION}
                  </span>
                  <a
                    href={GITHUB_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 rounded-lg bg-muted px-3 py-1.5 text-xs text-primary hover:bg-accent transition-colors"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {GITHUB_URL.replace('https://', '')}
                  </a>
                </div>
              </div>
              <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
                {t('settings:general.distribution.desc')}
              </p>
            </div>
          </div>
        )}

        {activeTab === 'platforms' && (
          <div
            data-testid="platform-table-wrap"
            className="max-w-[1180px] space-y-3 pt-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-foreground">
                {t('settings:platforms.title')}
              </h3>
            </div>

            {/* Platform table */}
            {platformsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-12 animate-pulse rounded-lg bg-muted"
                  />
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
                        <tr
                          key={platform.id}
                          className="border-b border-border last:border-0"
                        >
                          <td
                            className={cn(
                              'px-4 py-3',
                              !platform.enabled && 'opacity-60'
                            )}
                          >
                            <div className="flex items-center gap-3">
                              <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/60">
                                <IconComp className="h-5 w-5 text-muted-foreground" />
                                <span
                                  className={cn(
                                    'absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border-2 border-background',
                                    platform.enabled ? 'bg-success' : 'bg-muted'
                                  )}
                                />
                              </span>
                              <div className="min-w-0">
                                <div className="font-medium text-foreground">
                                  {platform.name}
                                </div>
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
                          <td className="px-4 py-3 text-center">
                            {(() => {
                              if (!caps)
                                return (
                                  <span className="text-xs text-muted-foreground">
                                    -
                                  </span>
                                );
                              const capabilityRows = [
                                [
                                  'S',
                                  caps.skills_global,
                                  platform.paths?.global_skills_dir,
                                ],
                                [
                                  'S',
                                  caps.skills_project,
                                  platform.paths?.project_skills_pattern,
                                ],
                                [
                                  'R',
                                  caps.rules_global,
                                  platform.paths?.global_rules_dir,
                                ],
                                [
                                  'R',
                                  caps.rules_project,
                                  platform.paths?.project_rules_pattern,
                                ],
                              ] as const;
                              const capabilityLabels = [
                                t('settings:platforms.capLabels.skillsGlobal'),
                                t('settings:platforms.capLabels.skillsProject'),
                                t('settings:platforms.capLabels.rulesGlobal'),
                                t('settings:platforms.capLabels.rulesProject'),
                              ];
                              const triggerRef = {
                                current:
                                  triggerRefs.current.get(platform.id) ?? null,
                              };
                              return (
                                <div className="relative">
                                  <button
                                    type="button"
                                    ref={(el) => {
                                      triggerRefs.current.set(platform.id, el);
                                    }}
                                    aria-label={t(
                                      'settings:platforms.capLabels.openTooltip',
                                      { name: platform.name }
                                    )}
                                    className="inline-flex items-center gap-1 rounded-md px-0.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-ring"
                                    onFocus={() =>
                                      setTooltipPlatformId(platform.id)
                                    }
                                    onBlur={(e) => {
                                      if (pinnedPlatformId === platform.id)
                                        return;
                                      const next = e.relatedTarget as HTMLElement | null;
                                      if (next?.closest('[data-tooltip-panel]'))
                                        return;
                                      setTooltipPlatformId(null);
                                    }}
                                    onMouseEnter={() => {
                                      clearTooltipCloseDelay();
                                      setTooltipPlatformId(platform.id);
                                    }}
                                    onMouseLeave={() =>
                                      scheduleTooltipClose(platform.id)
                                    }
                                    onClick={() => {
                                      if (pinnedPlatformId === platform.id) {
                                        setPinnedPlatformId(null);
                                        setTooltipPlatformId(null);
                                      } else {
                                        setPinnedPlatformId(platform.id);
                                        setTooltipPlatformId(platform.id);
                                      }
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Escape') {
                                        setTooltipPlatformId(null);
                                        setPinnedPlatformId(null);
                                      }
                                    }}
                                  >
                                    {capabilityRows.map((row, i) => {
                                      const supported =
                                        row[1] === true && !!row[2];
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
                                    onMouseEnter={clearTooltipCloseDelay}
                                    onMouseLeave={() =>
                                      scheduleTooltipClose(platform.id)
                                    }
                                    onBlur={(e) => {
                                      if (pinnedPlatformId === platform.id)
                                        return;
                                      const next = e.relatedTarget as HTMLElement | null;
                                      if (triggerRefs.current.get(platform.id) === next)
                                        return;
                                      if (next?.closest('[data-tooltip-panel]'))
                                        return;
                                      setTooltipPlatformId(null);
                                    }}
                                  >
                                    <div className="text-xs">
                                      <div className="mb-2 font-medium text-foreground">
                                        {t(
                                          'settings:platforms.capLabels.tooltipTitle',
                                          { name: platform.name }
                                        )}
                                      </div>
                                      <div
                                        data-testid="platform-path-tooltip"
                                        className="grid grid-cols-[76px_minmax(0,1fr)] gap-x-4 gap-y-1"
                                      >
                                        {capabilityRows.map((row, i) => {
                                          const supported =
                                            row[1] === true && !!row[2];
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
                                                    onClick={() => {
                                                      navigator.clipboard.writeText(
                                                        row[2] as string
                                                      );
                                                      addToast(
                                                        t(
                                                          'settings:platforms.capLabels.copied'
                                                        ),
                                                        'success'
                                                      );
                                                    }}
                                                    title={t(
                                                      'settings:platforms.capLabels.copyPath'
                                                    )}
                                                  >
                                                    <Clipboard className="h-3 w-3" />
                                                  </button>
                                                </span>
                                              ) : (
                                                <span className="text-muted-foreground/50">
                                                  {t(
                                                    'settings:platforms.capLabels.notSupported'
                                                  )}
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
                              onClick={() => handleTogglePlatform(platform)}
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
                                  platform.enabled
                                    ? 'translate-x-4'
                                    : 'translate-x-0'
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

            {/* Hint */}
            <p className="text-xs text-muted-foreground/70 px-1">
              {t('settings:platforms.hint')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

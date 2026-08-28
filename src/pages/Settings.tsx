import {
  Suspense,
  lazy,
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ipc } from '../lib/ipc';
import { getSystemLanguageForSettings } from '../lib/i18n';
import { cn } from '../lib/utils';
import { SELECT_CLASSES } from '../lib/ui-tokens';
import {
  ExternalLink,
  Database,
  FolderOpen,
  Sun,
  Moon,
  RefreshCw,
} from 'lucide-react';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { useAppStore } from '../stores/appStore';
import { useTheme } from '../hooks/useTheme';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
const PlatformsPanel = lazy(
  () => import('../domains/settings/PlatformsPanel.lazy')
);
import type {
  Platform,
  PlatformCapabilities,
  PlatformEntryCount,
} from '../types';
import { version } from '../../package.json';

type SettingsTab = 'general' | 'platforms';

const GITHUB_URL = 'https://github.com/WebbLee94/SkillForge';
const LANG_STORAGE_KEY = 'skillforge-lang';

async function resolveSystemLanguage(): Promise<string> {
  return getSystemLanguageForSettings();
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
  const [checkingUpdate, setCheckingUpdate] = useState(false);
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
    if (activeTab !== 'platforms' || platforms.length === 0) return;

    let cancelled = false;

    const fetchCaps = async () => {
      const results = await Promise.all(
        platforms.map(async (platform) => {
          try {
            return [
              platform.id,
              await ipc.getCapabilities(platform.id),
            ] as const;
          } catch (error) {
            console.error('getCapabilities failed:', error);
            return null;
          }
        })
      );

      if (cancelled) return;

      const map: Record<string, PlatformCapabilities> = {};
      for (const result of results) {
        if (result) {
          const [platformId, capabilities] = result;
          map[platformId] = capabilities;
        }
      }
      setCapabilitiesMap(map);
    };

    void fetchCaps();

    return () => {
      cancelled = true;
    };
  }, [activeTab, platforms]);

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
    async (lng: string) => {
      localStorage.setItem(LANG_STORAGE_KEY, lng);
      if (lng === 'system') {
        await i18n.changeLanguage(await resolveSystemLanguage());
      } else {
        await i18n.changeLanguage(lng);
      }
    },
    [i18n]
  );

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

  const handleCopyPath = useCallback(
    (path: string) => {
      navigator.clipboard.writeText(path);
      addToast(t('settings:platforms.capLabels.copied'), 'success');
    },
    [addToast, t]
  );

  const handleCheckUpdate = useCallback(async () => {
    if (checkingUpdate) return;

    setCheckingUpdate(true);
    try {
      const update = await check();
      if (!update?.available) {
        addToast(t('settings:general.update.latest'), 'success');
        return;
      }

      const shouldInstall = window.confirm(
        t('settings:general.update.availablePrompt', {
          version: update.version,
        })
      );

      if (!shouldInstall) {
        return;
      }

      await update.downloadAndInstall();
      addToast(t('settings:general.update.installing'), 'success');
      await relaunch();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      addToast(t('settings:general.update.failed', { reason }), 'error');
    } finally {
      setCheckingUpdate(false);
    }
  }, [addToast, checkingUpdate, t]);

  const handleShowTooltip = useCallback((platformId: string) => {
    setTooltipPlatformId(platformId);
  }, []);

  const handleHideTooltip = useCallback((platformId: string) => {
    setTooltipPlatformId((cur) => (cur === platformId ? null : cur));
  }, []);

  const handlePinTooltip = useCallback((platformId: string) => {
    setPinnedPlatformId(platformId);
  }, []);

  const handleUnpinTooltip = useCallback((platformId: string) => {
    setPinnedPlatformId((cur) => (cur === platformId ? null : cur));
  }, []);

  const tabs: { key: SettingsTab; label: string }[] = [
    { key: 'general', label: t('settings:tabs.general') },
    { key: 'platforms', label: t('settings:tabs.platforms') },
  ];

  return (
    <div
      data-testid="dashboard-page"
      className="flex h-full flex-col overflow-y-auto"
    >
      <div className="border-b border-border pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="page-title text-foreground">
              {t('settings:title')}
            </h1>
            <p className="text-xs text-muted-foreground">
              {t('settings:subtitle')}
            </p>
          </div>
        </div>
      </div>

      {/* Top chips */}
      <div className="shrink-0 border-b border-border mt-3 py-1.5">
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
                    {t('settings:general.languageSystemBrowser')}
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
                      'absolute top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-white shadow transition-transform',
                      isDark ? 'translate-x-4' : 'translate-x-0.5'
                    )}
                  >
                    {isDark ? (
                      <Moon className="h-2.5 w-2.5 text-foreground" />
                    ) : (
                      <Sun className="h-2.5 w-2.5 text-foreground" />
                    )}
                  </span>
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
                  <span className="rounded-lg bg-muted px-3 py-1.5 text-xs font-mono text-foreground">
                    {`v${version}`}
                  </span>
                  <button
                    className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => void handleCheckUpdate()}
                    disabled={checkingUpdate}
                  >
                    <RefreshCw className={cn('h-3.5 w-3.5', checkingUpdate && 'animate-spin')} />
                    {t('settings:general.update.checkButton')}
                  </button>
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
                    {t('settings:general.community.desc')}
                  </p>
                </div>
                <div className="flex items-center gap-3">
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
              <p className="mt-2 text-xs text-muted-foreground">
                {t('settings:general.distribution.desc')}
              </p>
            </div>
          </div>
        )}

        {activeTab === 'platforms' && (
          <Suspense fallback={null}>
            <PlatformsPanel
              platforms={platforms}
              platformsLoading={platformsLoading}
              capabilitiesMap={capabilitiesMap}
              countsMap={countsMap}
              togglingId={togglingId}
              tooltipPlatformId={tooltipPlatformId}
              pinnedPlatformId={pinnedPlatformId}
              onTogglePlatform={handleTogglePlatform}
              onCopyPath={handleCopyPath}
              onShowTooltip={handleShowTooltip}
              onHideTooltip={handleHideTooltip}
              onPinTooltip={handlePinTooltip}
              onUnpinTooltip={handleUnpinTooltip}
              onClearTooltipCloseDelay={clearTooltipCloseDelay}
              onScheduleTooltipClose={scheduleTooltipClose}
              triggerRefs={triggerRefs}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}

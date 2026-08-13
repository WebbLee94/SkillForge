import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../stores/appStore';
import { cn } from '../lib/utils';
import {
  Package,
  Film,
  FolderOpen,
  Plus,
  Globe,
} from 'lucide-react';
import { getPlatformIcon } from '../components/icons/PlatformIcons';
import { ImportPreviewDialog } from '../components/ImportPreviewDialog';
import { WatcherNotification } from '../components/WatcherNotification';
import { WelcomeGuideCard } from '../components/WelcomeGuideCard';
import { ipc } from '../lib/ipc';
import type { PlatformScanResult, PlatformEntryCount } from '../types';

const FIRST_LAUNCH_DISMISSED_KEY = 'skillforge-import-guide-dismissed';

export function Dashboard() {
  const { t } = useTranslation('common');
  const dashboardStats = useAppStore((s) => s.dashboardStats);
  const platforms = useAppStore((s) => s.platforms);
  const fetchDashboardStats = useAppStore((s) => s.fetchDashboardStats);
  const fetchPlatforms = useAppStore((s) => s.fetchPlatforms);
  const scanForImport = useAppStore((s) => s.scanForImport);
  const importScanned = useAppStore((s) => s.importScanned);
  const setActiveNav = useAppStore((s) => s.setActiveNav);

  const [showImportPreview, setShowImportPreview] = useState(false);
  const [importResult, setImportResult] = useState<PlatformScanResult[]>([]);
  const [totalNew, setTotalNew] = useState(0);
  const [totalSkipped, setTotalSkipped] = useState(0);
  const [importing, setImporting] = useState(false);
  const [showGuideCard, setShowGuideCard] = useState(false);
  const [liveCounts, setLiveCounts] = useState<
    Record<string, PlatformEntryCount>
  >({});

  const enabledPlatforms = platforms.filter((p) => p.enabled);
  const enabledIds = enabledPlatforms.map((p) => p.id).join(',');
  const skillCount = dashboardStats?.skill_count ?? 0;
  const ruleCount = dashboardStats?.rule_count ?? 0;

  // Fetch live filesystem counts (same data source as GlobalDistribution)
  useEffect(() => {
    const ids = enabledPlatforms.map((p) => p.id);
    if (ids.length === 0) return;
    let cancelled = false;
    Promise.all(
      ids.map((id) => ipc.countPlatformEntries(id).catch(() => null))
    ).then((results) => {
      if (cancelled) return;
      const next: Record<string, PlatformEntryCount> = {};
      for (const r of results) {
        if (r) next[r.platform_id] = r;
      }
      setLiveCounts(next);
    });
    return () => {
      cancelled = true;
    };
  }, [enabledIds]);

  // Load data then check first-launch — reads persisted dismiss flag; the guide
  // stays visible until dismissed, regardless of skill/platform data state.
  useEffect(() => {
    const init = async () => {
      await fetchDashboardStats();
      await fetchPlatforms();

      const dismissed =
        localStorage.getItem(FIRST_LAUNCH_DISMISSED_KEY) === 'true';
      if (!dismissed) {
        setShowGuideCard(true);
      }
    };
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDismissGuide = useCallback(() => {
    localStorage.setItem(FIRST_LAUNCH_DISMISSED_KEY, 'true');
    setShowGuideCard(false);
  }, []);

  const handleScan = useCallback(async () => {
    const result = await scanForImport();
    if (result) {
      const platformsWithContent = result.platforms.filter(
        (p) => p.new_skills.length > 0 || p.new_rules.length > 0
      );
      setImportResult(platformsWithContent);
      setTotalNew(result.total_new_skills + result.total_new_rules);
      setTotalSkipped(
        result.total_existing_skills + result.total_existing_rules
      );
      setShowImportPreview(true);
    }
  }, [scanForImport]);

  const handleConfirmImport = useCallback(async () => {
    setImporting(true);
    const allSkills = importResult.flatMap((p) => p.new_skills);
    const allRules = importResult.flatMap((p) => p.new_rules);
    await importScanned(allSkills, allRules);
    setImporting(false);
    setShowImportPreview(false);
    fetchDashboardStats();
    handleDismissGuide();
  }, [importResult, importScanned, fetchDashboardStats, handleDismissGuide]);

  const statCards = [
    {
      label: t('dashboard.stats.resources'),
      value: `${skillCount} / ${ruleCount}`,
      subtitle: t('dashboard.stats.resourcesSubtitle', {
        skills: skillCount,
        rules: ruleCount,
      }),
      icon: <Package className="h-5 w-5" />,
      color: 'text-primary',
      bgColor: 'bg-primary/10',
      navKey: 'skills',
    },
    {
      label: t('dashboard.stats.scenes'),
      value: dashboardStats?.user_scene_count ?? 0,
      subtitle: t('dashboard.stats.scenesSubtitle'),
      icon: <Film className="h-5 w-5" />,
      color: 'text-indigo-600 dark:text-indigo-400',
      bgColor: 'bg-indigo-100 dark:bg-indigo-950',
      navKey: 'scenes',
    },
    {
      label: t('dashboard.stats.projects'),
      value: dashboardStats?.project_count ?? 0,
      subtitle: t('dashboard.stats.projectsSubtitle'),
      icon: <FolderOpen className="h-5 w-5" />,
      color: 'text-blue-600 dark:text-blue-400',
      bgColor: 'bg-blue-100 dark:bg-blue-950',
      navKey: 'projectDistribution',
    },
    {
      label: t('dashboard.stats.platforms'),
      value: `${enabledPlatforms.length} / ${platforms.length}`,
      subtitle: t('dashboard.stats.platformsSubtitle', {
        enabled: enabledPlatforms.length,
        total: platforms.length,
      }),
      icon: <Globe className="h-5 w-5" />,
      color: 'text-violet-600 dark:text-violet-400',
      bgColor: 'bg-violet-100 dark:bg-violet-950',
      navKey: 'settings',
    },
  ];

  return (
    <div
      data-testid="dashboard-page"
      className="flex h-full flex-col overflow-y-auto"
    >
      {/* Header row: title + subtitle on left, primary one-click import on right */}
      <div className="page-toolbar flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="page-title mb-1 text-foreground">
            {t('nav.dashboard')}
          </h1>
          <p className="text-xs text-muted-foreground">
            {t('dashboard.subtitle')}
          </p>
        </div>
        <button
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          onClick={handleScan}
        >
          <Plus className="h-4 w-4" />
          {t('import.scanTitle')}
        </button>
      </div>

      <WatcherNotification />

      {/* Welcome guide card — first launch; contains the 3-step stepper */}
      {showGuideCard && (
        <WelcomeGuideCard
          onDismiss={handleDismissGuide}
          onNavigate={setActiveNav}
        />
      )}

      {/* Stat Cards */}
      <div
        data-testid="dashboard-stats-grid"
        className="mb-3 grid grid-cols-4 gap-3"
      >
        {statCards.map((card) => (
          <button
            key={card.navKey}
            className={cn(
              'flex items-center gap-4 rounded-lg border border-border bg-card p-4',
              'hover:shadow-md transition-shadow text-left'
            )}
            onClick={() => setActiveNav(card.navKey)}
          >
            <div
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-lg',
                card.bgColor,
                card.color
              )}
            >
              {card.icon}
            </div>
            <div>
              <div className="text-sm text-muted-foreground">{card.label}</div>
              <div className="text-2xl font-bold text-foreground">
                {card.value}
              </div>
              <div className="text-xs text-muted-foreground">
                {card.subtitle}
              </div>
            </div>
          </button>
        ))}
      </div>

      <div>
        {/* Quick entry — enabled platforms only */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground">
              {t('dashboard.quickEntry.title')}
            </h2>
            <Globe className="h-4 w-4 text-primary" />
          </div>
          {enabledPlatforms.length > 0 ? (
            <div className="divide-y divide-border rounded-lg border border-border">
              {enabledPlatforms.map((p) => {
                const cnt = liveCounts[p.id];
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
                      onClick={() => {
                        useAppStore
                          .getState()
                          .setGlobalDistSelectedPlatform(p.id);
                        setActiveNav('globalDistribution');
                      }}
                    >
                      {t('dashboard.quickEntry.chooseTarget')}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('messages.noData')}
            </p>
          )}
        </div>
      </div>

      <ImportPreviewDialog
        open={showImportPreview}
        platforms={importResult}
        totalNew={totalNew}
        totalSkipped={totalSkipped}
        importing={importing}
        onClose={() => setShowImportPreview(false)}
        onConfirm={handleConfirmImport}
      />
    </div>
  );
}

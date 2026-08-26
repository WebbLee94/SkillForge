import { Suspense, lazy, useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../stores/appStore';
import { Package, Film, FolderOpen, Plus, Globe } from 'lucide-react';
const ImportPreviewDialog = lazy(
  () => import('../domains/resources/ImportPreviewDialog.lazy')
);
import { DashboardQuickEntry } from '../domains/dashboard/DashboardQuickEntry';
import { DashboardStatsGrid } from '../domains/dashboard/DashboardStatsGrid';
import { WatcherNotification } from '../domains/dashboard/WatcherNotification';
import { WelcomeGuideCard } from '../domains/dashboard/WelcomeGuideCard';
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
      subtitle: t('dashboard.stats.resourcesSubtitle'),
      icon: <Package className="h-5 w-5" />,
      color: 'text-blue-600 dark:text-blue-400',
      bgColor: 'bg-blue-100 dark:bg-blue-950',
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
      subtitle: t('dashboard.stats.platformsSubtitle'),
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

      <div className="mt-[20px] h-full flex-col">
        <WatcherNotification />

        {/* Stat Cards */}
        <DashboardStatsGrid cards={statCards} onNavigate={setActiveNav} />

        {/* Welcome guide card — first launch; contains the 3-step stepper */}
        {showGuideCard && (
          <WelcomeGuideCard
            onDismiss={handleDismissGuide}
            onNavigate={setActiveNav}
          />
        )}

        <div>
          {/* Quick entry — enabled platforms only */}
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-foreground">
                {t('dashboard.quickEntry.title')}
              </h2>
              <Globe className="h-4 w-4 text-primary" />
            </div>
            <DashboardQuickEntry
              platforms={enabledPlatforms}
              liveCounts={liveCounts}
              t={t}
              onChooseTarget={(platformId) => {
                useAppStore
                  .getState()
                  .setGlobalDistSelectedPlatform(platformId);
                setActiveNav('globalDistribution');
              }}
            />
          </div>
        </div>

        <Suspense fallback={null}>
          <ImportPreviewDialog
            open={showImportPreview}
            platforms={importResult}
            totalNew={totalNew}
            totalSkipped={totalSkipped}
            importing={importing}
            onClose={() => setShowImportPreview(false)}
            onConfirm={handleConfirmImport}
          />
        </Suspense>
      </div>
    </div>
  );
}

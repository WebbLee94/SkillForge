import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../stores/appStore';
import { cn } from '../lib/utils';
import { formatDate } from '../lib/utils';
import {
  Package,
  FileText,
  Film,
  FolderOpen,
  Download,
  Plus,
  RefreshCw,
  Globe,
  HelpCircle,
  Sparkles,
} from 'lucide-react';
import { getPlatformIcon } from '../components/icons/PlatformIcons';
import { ImportPreviewDialog } from '../components/ImportPreviewDialog';
import { WatcherNotification } from '../components/WatcherNotification';
import type { PlatformScanResult } from '../types';

const FIRST_LAUNCH_DISMISSED_KEY = 'skillforge-import-guide-dismissed';

export function Dashboard() {
  const { t } = useTranslation('common');
  const dashboardStats = useAppStore((s) => s.dashboardStats);
  const globalDistStatus = useAppStore((s) => s.globalDistStatus);
  const platforms = useAppStore((s) => s.platforms);
  const fetchDashboardStats = useAppStore((s) => s.fetchDashboardStats);
  const fetchRecentActivity = useAppStore((s) => s.fetchRecentActivity);
  const fetchGlobalDistStatus = useAppStore((s) => s.fetchGlobalDistStatus);
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

  // Load data then check first-launch — uses direct store read to avoid React dep issues
  useEffect(() => {
    const init = async () => {
      await fetchDashboardStats();
      await fetchPlatforms();
      fetchRecentActivity();
      fetchGlobalDistStatus();

      const state = useAppStore.getState();
      const enabledCount = (state.platforms || []).filter(
        (p) => p.enabled
      ).length;
      const skillCount = state.dashboardStats?.skill_count ?? 0;
      console.log('[firstLaunch]', {
        skillCount,
        enabledCount,
        platformCount: state.platforms.length,
      });
      if (skillCount === 0 && enabledCount > 0) {
        // Always show guide when no skills exist, regardless of previous dismiss
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
      label: t('nav.projectDistribution'),
      value: dashboardStats?.project_count ?? 0,
      icon: <FolderOpen className="h-5 w-5" />,
      color: 'text-error',
      bgColor: 'bg-error/10',
      navKey: 'projectDistribution',
    },
    {
      label: t('nav.scenes'),
      value: dashboardStats?.user_scene_count ?? 0,
      icon: <Film className="h-5 w-5" />,
      color: 'text-warning',
      bgColor: 'bg-warning/10',
      navKey: 'scenes',
    },
    {
      label: t('nav.skills'),
      value: dashboardStats?.skill_count ?? 0,
      icon: <Package className="h-5 w-5" />,
      color: 'text-primary',
      bgColor: 'bg-primary/10',
      navKey: 'skills',
    },
    {
      label: t('nav.rules'),
      value: dashboardStats?.rule_count ?? 0,
      icon: <FileText className="h-5 w-5" />,
      color: 'text-success',
      bgColor: 'bg-success/10',
      navKey: 'rules',
    },
  ];

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      <h1 className="mb-6 text-2xl font-bold text-foreground">
        {t('nav.dashboard')}
      </h1>

      <WatcherNotification />

      {/* First-launch guide card */}
      {showGuideCard && (
        <div className="mb-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-start gap-3">
            <Sparkles className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-foreground">
                {t('import.firstLaunchTitle')}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('import.firstLaunchDesc', {
                  count: platforms.filter((p) => p.enabled).length,
                })}
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                  onClick={handleScan}
                >
                  {t('import.firstLaunchAction')}
                </button>
                <button
                  className="rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80"
                  onClick={handleDismissGuide}
                >
                  {t('import.firstLaunchDismiss')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-4">
        <div className="relative inline-flex items-center group">
          <button
            className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
            onClick={handleScan}
          >
            <Download className="h-3.5 w-3.5" />
            {t('import.scanTitle')}
          </button>
          <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help ml-1.5" />
          <span className="absolute left-0 bottom-full mb-2 z-50 hidden group-hover:block whitespace-nowrap rounded-lg border border-border bg-popover px-3 py-2 shadow-lg text-xs text-foreground">
            {t('import.scanTooltip')}
          </span>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="mb-6 grid grid-cols-4 gap-4">
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
              <div className="text-2xl font-bold text-foreground">
                {card.value}
              </div>
              <div className="text-sm text-muted-foreground">{card.label}</div>
            </div>
          </button>
        ))}
      </div>

      <div>
        {/* Global Distribution Status (full width) */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground">
              {t('dashboard.globalDistStatus')}
            </h2>
            <Globe className="h-4 w-4 text-primary" />
          </div>
          {globalDistStatus ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {t('dashboard.currentScene')}
                </span>
                <span className="text-sm font-medium text-foreground">
                  {globalDistStatus.scene_name || t('dashboard.notConfigured')}
                </span>
              </div>
              {!globalDistStatus.scene_id && (
                <button
                  className="flex w-full items-center justify-center gap-2 rounded-md bg-primary/10 px-3 py-2 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
                  onClick={() => setActiveNav('globalDistribution')}
                >
                  <Globe className="h-3.5 w-3.5" />
                  {t('dashboard.configureGlobalScene')}
                </button>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {t('dashboard.skillRuleCount')}
                </span>
                <span className="text-sm font-medium text-foreground">
                  {globalDistStatus.skill_count} / {globalDistStatus.rule_count}
                </span>
              </div>
              {globalDistStatus.platforms.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {globalDistStatus.platforms.map((p) => {
                    const PlatformIcon = getPlatformIcon(p.platform_id);
                    // Display synced_skill_count / synced_rule_count
                    const skillProgress = `${p.synced_skill_count ?? 0}/${p.synced_rule_count ?? 0}`;
                    const tooltipText = `已同步技能: ${p.synced_skill_count ?? 0} / 已同步规则: ${p.synced_rule_count ?? 0}`;
                    return (
                      <button
                        key={p.platform_id}
                        className="flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs hover:bg-muted transition-colors"
                        onClick={() => setActiveNav('globalDistribution')}
                        title={tooltipText}
                      >
                        {PlatformIcon && (
                          <PlatformIcon className="h-3.5 w-3.5" />
                        )}
                        <span className="font-medium text-foreground">
                          {p.platform_name}
                        </span>
                        <span className="text-muted-foreground">
                          {skillProgress}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              {globalDistStatus.last_synced_at && (
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-muted-foreground">
                    {t('distribution:lastSynced')}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(globalDistStatus.last_synced_at)}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('messages.noData')}
            </p>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="mt-6 flex gap-3">
        <button
          className={cn(
            'flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5',
            'text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors'
          )}
          onClick={() => setActiveNav('skills')}
        >
          <Download className="h-4 w-4" />
          {t('actions.import')} {t('nav.skills')}
        </button>
        <button
          className={cn(
            'flex items-center gap-2 rounded-lg bg-secondary px-4 py-2.5',
            'text-sm font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors'
          )}
          onClick={() => setActiveNav('scenes')}
        >
          <Plus className="h-4 w-4" />
          {t('actions.create')} {t('nav.scenes')}
        </button>
        <button
          className={cn(
            'flex items-center gap-2 rounded-lg bg-secondary px-4 py-2.5',
            'text-sm font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors'
          )}
          onClick={() => setActiveNav('globalDistribution')}
        >
          <RefreshCw className="h-4 w-4" />
          {t('actions.syncAll')}
        </button>
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

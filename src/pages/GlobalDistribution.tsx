import { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../stores/appStore';
import { ipc } from '../lib/ipc';
import { cn } from '../lib/utils';
import {
  Globe,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Clock,
  AlertTriangle,
  FolderOpen,
  HelpCircle,
} from 'lucide-react';
import { getPlatformIcon } from '../components/icons/PlatformIcons';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { SyncStatus } from '../types';

const statusIconMap: Record<SyncStatus, React.ReactNode> = {
  synced: <CheckCircle className="h-4 w-4 text-success" />,
  outdated: <AlertTriangle className="h-4 w-4 text-warning" />,
  partial: <AlertTriangle className="h-4 w-4 text-warning" />,
  error: <AlertCircle className="h-4 w-4 text-error" />,
  pending: <Clock className="h-4 w-4 text-muted-foreground" />,
};

const statusBgMap: Record<SyncStatus, string> = {
  synced: 'border-success/20',
  outdated: 'border-warning/20',
  partial: 'border-warning/20',
  error: 'border-error/20',
  pending: 'border-border',
};

const statusLabelMap: Record<SyncStatus, string> = {
  synced: 'status.synced',
  outdated: 'status.outdated',
  partial: 'status.partial',
  error: 'status.error',
  pending: 'status.pending',
};

export function GlobalDistribution() {
  const { t } = useTranslation('distribution');
  const { t: tc } = useTranslation('common');
  const scenes = useAppStore((s) => s.scenes);
  const syncStatus = useAppStore((s) => s.syncStatus);
  const currentScene = useAppStore((s) => s.currentScene);
  const currentSceneDetail = useAppStore((s) => s.currentSceneDetail);
  const globalDistStatus = useAppStore((s) => s.globalDistStatus);
  const fetchScenes = useAppStore((s) => s.fetchScenes);
  const fetchSyncStatus = useAppStore((s) => s.fetchSyncStatus);
  const fetchPlatforms = useAppStore((s) => s.fetchPlatforms);
  const setCurrentScene = useAppStore((s) => s.setCurrentScene);
  const fetchSceneDetail = useAppStore((s) => s.fetchSceneDetail);
  const syncScene = useAppStore((s) => s.syncScene);
  const fetchGlobalDistStatus = useAppStore((s) => s.fetchGlobalDistStatus);
  const addToast = useAppStore((s) => s.addToast);

  const [pendingSceneId, setPendingSceneId] = useState<string | null>(null);

  // T3: Include system scenes in the selector
  const selectableScenes = useMemo(() => scenes, [scenes]);

  const allPlatformIds = useMemo(
    () => syncStatus?.platforms.map((p) => p.platform_id) || [],
    [syncStatus?.platforms]
  );

  // Custom override toggle (not persisted)
  const [customOverride, setCustomOverride] = useState(false);
  const [selectedPlatformIds, setSelectedPlatformIds] = useState<string[]>([]);

  // Scene-bound platform IDs for filtering
  const [scenePlatformIds, setScenePlatformIds] = useState<string[]>([]);

  // Reset custom override and fetch scene platforms when scene changes
  useEffect(() => {
    setCustomOverride(false);
    setSelectedPlatformIds([]);
    if (currentScene?.id) {
      // __all_skills__ system scene: use all enabled platforms
      if (currentScene.is_system) {
        ipc
          .listPlatforms()
          .then((platforms) => {
            setScenePlatformIds(
              platforms.filter((p) => p.enabled).map((p) => p.id)
            );
          })
          .catch(() => setScenePlatformIds([]));
      } else {
        ipc
          .getScenePlatforms(currentScene.id)
          .then(setScenePlatformIds)
          .catch(() => setScenePlatformIds([]));
      }
    } else {
      setScenePlatformIds([]);
    }
  }, [currentScene?.id]);

  // Filtered platforms: scene-bound by default, all when custom override is on
  const filteredPlatforms = useMemo(() => {
    if (customOverride) {
      // When override is on, show selected platforms (or all if none selected)
      const ids =
        selectedPlatformIds.length > 0 ? selectedPlatformIds : allPlatformIds;
      return (syncStatus?.platforms || []).filter((p) =>
        ids.includes(p.platform_id)
      );
    }
    if (scenePlatformIds.length === 0) return [];
    return (syncStatus?.platforms || []).filter((p) =>
      scenePlatformIds.includes(p.platform_id)
    );
  }, [
    customOverride,
    selectedPlatformIds,
    allPlatformIds,
    syncStatus?.platforms,
    scenePlatformIds,
  ]);

  // T3: Default to global scene from globalDistStatus
  useEffect(() => {
    if (globalDistStatus?.scene_id && !currentScene) {
      const scene = scenes.find((s) => s.id === globalDistStatus.scene_id);
      if (scene) setCurrentScene(scene);
    }
  }, [globalDistStatus?.scene_id, scenes, setCurrentScene]);

  useEffect(() => {
    fetchScenes();
    fetchSyncStatus();
    fetchPlatforms();
    fetchGlobalDistStatus();
  }, [fetchScenes, fetchSyncStatus, fetchPlatforms, fetchGlobalDistStatus]);

  useEffect(() => {
    if (currentScene) {
      fetchSceneDetail(currentScene.id);
    }
  }, [currentScene, fetchSceneDetail]);

  // T3: Scene switch with confirmation
  const executeSceneChange = async () => {
    if (!pendingSceneId) return;
    try {
      await ipc.switchGlobalScene(pendingSceneId);
      const scene = scenes.find((s) => s.id === pendingSceneId);
      if (scene) setCurrentScene(scene);
      await fetchGlobalDistStatus();
      await fetchSyncStatus();
      addToast(tc('messages.switchSceneSuccess'), 'success');
    } catch (e) {
      addToast(tc('messages.switchSceneFailed'), 'error');
    }
    setPendingSceneId(null);
  };

  const handleSceneChange = (newSceneId: string) => {
    if (!newSceneId) return;
    if (currentScene?.id === newSceneId) return;
    setPendingSceneId(newSceneId);
  };

  // Sync uses scene platforms (null) by default, or custom override
  const handleSyncPlatform = async (platformId: string) => {
    if (!currentScene) return;
    await syncScene(currentScene.id, [platformId], 'global');
  };

  const handleSyncAll = async () => {
    if (!currentScene) return;
    const platforms = customOverride ? selectedPlatformIds : null;
    await syncScene(currentScene.id, platforms, 'global');
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {t('globalTitle')}
            <span className="relative ml-2 inline-flex items-center group/help">
              <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
              <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 z-50 hidden group-hover/help:block opacity-100 whitespace-nowrap rounded-lg border border-border bg-popover px-3 py-2 shadow-lg text-xs text-foreground">
                {t('syncStrategyHint')}
              </span>
            </span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('globalSubtitle')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            className={cn(
              'flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5',
              'text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors',
              !currentScene && 'opacity-50 pointer-events-none'
            )}
            onClick={handleSyncAll}
          >
            <RefreshCw className="h-4 w-4" />
            {t('syncCurrentScene')}
          </button>
        </div>
      </div>

      {/* T3: Scene Selector - no "all skills" option, defaults to global scene */}
      <div className="mb-6">
        <label className="mb-1.5 block text-sm font-medium text-foreground">
          {t('selectScene')}
        </label>
        <div className="flex items-center gap-3">
          <select
            value={currentScene?.id || ''}
            onChange={(e) => handleSceneChange(e.target.value)}
            className="w-full max-w-[400px] rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="" disabled>
              {t('selectScenePlaceholder')}
            </option>
            {selectableScenes.map((scene) => (
              <option key={scene.id} value={scene.id}>
                {scene.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Scene Summary */}
      {currentSceneDetail && (
        <div className="mb-6 rounded-lg border border-border bg-card p-4">
          <h3 className="mb-2 text-sm font-semibold text-foreground">
            {t('sceneSummary')}
          </h3>
          <div className="flex gap-6">
            <span className="text-sm text-muted-foreground">
              {t('skillCount', { count: currentSceneDetail.skills.length })}
            </span>
            <span className="text-sm text-muted-foreground">
              {t('ruleCount', { count: currentSceneDetail.rules.length })}
            </span>
          </div>
        </div>
      )}

      {/* Custom Override Toggle */}
      <div className="mb-4">
        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={customOverride}
            onChange={(e) => {
              setCustomOverride(e.target.checked);
              if (e.target.checked) setSelectedPlatformIds(allPlatformIds);
            }}
            className="rounded border-border"
          />
          {t('customOverridePlatforms')}
        </label>
      </div>

      {/* Platform Grid - filtered by scene-bound platforms, or all platforms when custom override is on */}
      {(customOverride ? syncStatus?.platforms || [] : filteredPlatforms)
        .length > 0 ? (
        <div className="grid grid-cols-2 gap-4">
          {(customOverride
            ? syncStatus?.platforms || []
            : filteredPlatforms
          ).map((platform) => {
            const ps = (platform.status || 'pending') as SyncStatus;
            const isSelected = selectedPlatformIds.includes(
              platform.platform_id
            );
            const isDimmed = customOverride && !isSelected;
            return (
              <div
                key={platform.platform_id}
                className={cn(
                  'relative rounded-lg border bg-card p-4 transition-opacity',
                  statusBgMap[ps] || 'border-border',
                  isDimmed && 'opacity-50'
                )}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    {(() => {
                      const PlatformIcon = getPlatformIcon(
                        platform.platform_id
                      );
                      return PlatformIcon ? (
                        <PlatformIcon className="h-5 w-5" />
                      ) : (
                        <Globe className="h-5 w-5 text-primary" />
                      );
                    })()}
                    <span className="text-sm font-semibold text-foreground">
                      {platform.platform_name}
                    </span>
                  </div>
                  {customOverride ? (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => {
                        setSelectedPlatformIds((prev) =>
                          e.target.checked
                            ? [...prev, platform.platform_id]
                            : prev.filter((id) => id !== platform.platform_id)
                        );
                      }}
                      className="rounded border-border"
                    />
                  ) : (
                    statusIconMap[ps] || statusIconMap.pending
                  )}
                </div>
                <div className="mb-3">
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                    <span>{t('syncProgress')}</span>
                    <span>
                      {(() => {
                        const pdi = globalDistStatus?.platforms.find(
                          (p) => p.platform_id === platform.platform_id
                        );
                        if (pdi) {
                          return `${pdi.synced_skill_count ?? 0}/${pdi.synced_rule_count ?? 0}`;
                        }
                        return `${platform.synced_count}/${platform.total_count}`;
                      })()}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all',
                        ps === 'synced'
                          ? 'bg-success'
                          : ps === 'error'
                            ? 'bg-error'
                            : ps === 'outdated'
                              ? 'bg-warning'
                              : 'bg-primary'
                      )}
                      style={{
                        width: (() => {
                          const pdi = globalDistStatus?.platforms.find(
                            (p) => p.platform_id === platform.platform_id
                          );
                          if (pdi && (pdi.scene_skill_count ?? 0) > 0) {
                            return `${((pdi.synced_skill_count ?? 0) / pdi.scene_skill_count!) * 100}%`;
                          }
                          return platform.total_count > 0
                            ? `${(platform.synced_count / platform.total_count) * 100}%`
                            : '0%';
                        })(),
                      }}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-xs font-medium',
                      ps === 'synced' && 'bg-success/10 text-success',
                      ps === 'outdated' && 'bg-warning/10 text-warning',
                      ps === 'error' && 'bg-error/10 text-error',
                      ps === 'pending' && 'bg-muted/50 text-muted-foreground',
                      ps === 'partial' && 'bg-warning/10 text-warning'
                    )}
                  >
                    {tc(statusLabelMap[ps] || 'status.pending')}
                  </span>
                  <button
                    className={cn(
                      'flex items-center gap-1 rounded-md bg-secondary px-2.5 py-1',
                      'text-xs font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors'
                    )}
                    onClick={() => handleSyncPlatform(platform.platform_id)}
                  >
                    <RefreshCw className="h-3 w-3" />
                    {t('syncNow')}
                  </button>
                </div>
                {/* Platform global path: icon triggers reveal, text is copyable */}
                {(() => {
                  const platformInfo = globalDistStatus?.platforms.find(
                    (p) => p.platform_id === platform.platform_id
                  );
                  if (!platformInfo?.skills_dir) return null;
                  const skillsDir = platformInfo.skills_dir;
                  const parts = skillsDir.split('/');
                  const globalDir = parts.slice(0, -1).join('/') || skillsDir;
                  return (
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <button
                        className="shrink-0 rounded p-0.5 hover:bg-muted transition-colors"
                        onClick={() => {
                          const resolved = platformInfo.skills_dir_resolved;
                          if (resolved) {
                            const rparts = resolved.split('/');
                            const parent =
                              rparts.slice(0, -1).join('/') || resolved;
                            revealItemInDir(parent);
                          }
                        }}
                        title={tc('actions.openInFileManager')}
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                      </button>
                      <span
                        className="truncate cursor-copy hover:text-foreground transition-colors"
                        onClick={() => navigator.clipboard.writeText(globalDir)}
                        title={tc('actions.copy')}
                      >
                        {globalDir}
                      </span>
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      ) : currentScene ? (
        <div className="flex flex-col items-center justify-center py-12">
          <Globe className="mb-3 h-12 w-12 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">
            {t('noPlatformForScene')}
          </p>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12">
          <Globe className="mb-3 h-12 w-12 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">{t('emptyGlobal')}</p>
        </div>
      )}

      <ConfirmDialog
        open={pendingSceneId !== null}
        title={tc('messages.confirm')}
        message={t('confirmSwitchScene')}
        confirmLabel={t('diffConfirm.confirm')}
        onConfirm={executeSceneChange}
        onCancel={() => setPendingSceneId(null)}
      />
    </div>
  );
}

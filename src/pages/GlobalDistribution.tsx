import { useEffect, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../stores/appStore";
import { ipc } from "../lib/ipc";
import { cn } from "../lib/utils";
import { formatDate } from "../lib/utils";
import {
  Globe, RefreshCw, CheckCircle, AlertCircle, Clock, AlertTriangle,
  ShieldCheck, Package, FileText, X, Zap, History,
} from "lucide-react";
import type { SyncStatus, VerifyReport, DriftedItem, SyncLog } from "../types";

const statusIconMap: Record<SyncStatus, React.ReactNode> = {
  synced: <CheckCircle className="h-4 w-4 text-success" />,
  outdated: <AlertTriangle className="h-4 w-4 text-warning" />,
  partial: <AlertTriangle className="h-4 w-4 text-warning" />,
  error: <AlertCircle className="h-4 w-4 text-error" />,
  pending: <Clock className="h-4 w-4 text-muted-foreground" />,
};

const statusBgMap: Record<SyncStatus, string> = {
  synced: "border-success/20",
  outdated: "border-warning/20",
  partial: "border-warning/20",
  error: "border-error/20",
  pending: "border-border",
};

const statusLabelMap: Record<SyncStatus, string> = {
  synced: "status.synced",
  outdated: "status.outdated",
  partial: "status.partial",
  error: "status.error",
  pending: "status.pending",
};

export function GlobalDistribution() {
  const { t } = useTranslation("distribution");
  const { t: tc } = useTranslation("common");
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

  // T6: Verify & Repair state
  const [verifyReport, setVerifyReport] = useState<VerifyReport | null>(null);
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [verifying, setVerifying] = useState(false);

  // T14: Recent activity for distribution history
  const [recentLogs, setRecentLogs] = useState<SyncLog[]>([]);

  // T3: Filter out system scenes (__all_skills__)
  const userScenes = useMemo(
    () => scenes.filter((s) => !s.is_system),
    [scenes],
  );

  const allPlatformIds = useMemo(
    () => syncStatus?.platforms.map((p) => p.platform_id) || [],
    [syncStatus?.platforms],
  );

  // T3: Default to global scene from globalDistStatus
  useEffect(() => {
    if (globalDistStatus?.scene_id && !currentScene) {
      const scene = scenes.find((s) => s.id === globalDistStatus.scene_id);
      if (scene) setCurrentScene(scene);
    }
  }, [globalDistStatus?.scene_id, scenes, currentScene, setCurrentScene]);

  useEffect(() => {
    fetchScenes();
    fetchSyncStatus();
    fetchPlatforms();
    fetchGlobalDistStatus();
    // T14: Fetch recent activity for distribution history
    ipc.getRecentActivity(5).then(setRecentLogs).catch(() => {});
  }, [fetchScenes, fetchSyncStatus, fetchPlatforms, fetchGlobalDistStatus]);

  useEffect(() => {
    if (currentScene) {
      fetchSceneDetail(currentScene.id);
    }
  }, [currentScene, fetchSceneDetail]);

  // T3: Scene switch with confirmation
  const handleSceneChange = async (newSceneId: string) => {
    if (!newSceneId) return;
    if (currentScene?.id === newSceneId) return;

    const confirmed = window.confirm("切换全局场景将重新分发技能和规则，是否继续？");
    if (!confirmed) return;

    try {
      await ipc.switchGlobalScene(newSceneId);
      const scene = scenes.find((s) => s.id === newSceneId);
      if (scene) setCurrentScene(scene);
      await fetchGlobalDistStatus();
      await fetchSyncStatus();
      addToast("切换全局场景成功", "success");
    } catch (e) {
      console.error("Failed to switch global scene:", e);
      addToast("切换全局场景失败", "error");
    }
  };

  // T4: Sync uses ALL platforms
  const handleSyncPlatform = async (platformId: string) => {
    if (!currentScene) return;
    await syncScene(currentScene.id, [platformId], "global");
  };

  const handleSyncAll = async () => {
    if (!currentScene) return;
    await syncScene(currentScene.id, allPlatformIds, "global");
  };

  // T6: Verify & Repair
  const handleVerify = async () => {
    if (!currentScene) return;
    setVerifying(true);
    try {
      const report = await ipc.verifyDistribution(currentScene.id, "global");
      setVerifyReport(report);
      setShowVerifyModal(true);
    } catch (e) {
      console.error("Failed to verify distribution:", e);
      addToast("验证同步失败", "error");
    } finally {
      setVerifying(false);
    }
  };

  const handleRepair = async (item: DriftedItem) => {
    try {
      await ipc.repairDrift(item.item_type, item.item_id, item.platform_id, "from_db");
      addToast("修复成功", "success");
      // Refresh verify report
      if (currentScene) {
        const report = await ipc.verifyDistribution(currentScene.id, "global");
        setVerifyReport(report);
      }
    } catch (e) {
      console.error("Failed to repair drift:", e);
      addToast("修复失败", "error");
    }
  };

  const handleRepairAll = async () => {
    if (!verifyReport) return;
    try {
      for (const item of verifyReport.drifted) {
        await ipc.repairDrift(item.item_type, item.item_id, item.platform_id, "from_db");
      }
      addToast("全部修复成功", "success");
      if (currentScene) {
        const report = await ipc.verifyDistribution(currentScene.id, "global");
        setVerifyReport(report);
      }
    } catch (e) {
      console.error("Failed to repair all drifts:", e);
      addToast("批量修复失败", "error");
    }
  };

  // T14: Quick distribute all skills (__all_skills__ virtual scene)
  const handleQuickDistributeAll = async () => {
    const allSkillsScene = scenes.find((s) => s.is_system);
    if (!allSkillsScene) {
      addToast("未找到全部技能虚拟场景", "error");
      return;
    }
    try {
      addToast("正在快速分发全部技能...", "info");
      await syncScene(allSkillsScene.id, allPlatformIds, "global");
      // Refresh recent logs
      const logs = await ipc.getRecentActivity(5);
      setRecentLogs(logs);
    } catch (e) {
      console.error("Failed to quick distribute all skills:", e);
      addToast("快速分发失败", "error");
    }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("globalTitle")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("globalSubtitle")}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            className={cn(
              "flex items-center gap-2 rounded-lg border border-border px-3 py-2.5",
              "text-sm font-medium text-foreground hover:bg-accent transition-colors",
              !currentScene && "opacity-50 pointer-events-none",
            )}
            onClick={handleVerify}
            disabled={!currentScene || verifying}
          >
            <ShieldCheck className="h-4 w-4" />
            {verifying ? "验证中..." : "验证同步"}
          </button>
          <button
            className={cn(
              "flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5",
              "text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors",
              !currentScene && "opacity-50 pointer-events-none",
            )}
            onClick={handleSyncAll}
          >
            <RefreshCw className="h-4 w-4" />
            {tc("actions.syncAll")}
          </button>
        </div>
      </div>

      {/* T3: Scene Selector - no "all skills" option, defaults to global scene */}
      <div className="mb-6">
        <label className="mb-1.5 block text-sm font-medium text-foreground">{t("selectScene")}</label>
        <div className="flex items-center gap-3">
          <select
            value={currentScene?.id || ""}
            onChange={(e) => handleSceneChange(e.target.value)}
            className="w-full max-w-[400px] rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="" disabled>请选择场景</option>
            {userScenes.map((scene) => (
              <option key={scene.id} value={scene.id}>{scene.name}</option>
            ))}
          </select>
          <button
            className={cn(
              "flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2",
              "text-sm font-medium text-warning hover:bg-warning/10 transition-colors",
              allPlatformIds.length === 0 && "opacity-50 pointer-events-none",
            )}
            onClick={handleQuickDistributeAll}
            title="将全部技能快速分发到所有平台（不改变当前全局场景）"
          >
            <Zap className="h-4 w-4" />
            快速分发全部
          </button>
        </div>
      </div>

      {/* Scene Summary */}
      {currentSceneDetail && (
        <div className="mb-6 rounded-lg border border-border bg-card p-4">
          <h3 className="mb-2 text-sm font-semibold text-foreground">{t("sceneSummary")}</h3>
          <div className="flex gap-6">
            <span className="text-sm text-muted-foreground">
              {t("skillCount", { count: currentSceneDetail.skills.length })}
            </span>
            <span className="text-sm text-muted-foreground">
              {t("ruleCount", { count: currentSceneDetail.rules.length })}
            </span>
          </div>
        </div>
      )}

      {/* T4: Platform Grid - read-only status indicators, no checkboxes */}
      <div className="grid grid-cols-2 gap-4">
        {syncStatus?.platforms.map((platform) => {
          const ps = (platform.status || "pending") as SyncStatus;
          return (
          <div
            key={platform.platform_id}
            className={cn(
              "rounded-lg border bg-card p-4",
              statusBgMap[ps] || "border-border",
            )}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                {ps === "synced" ? (
                  <CheckCircle className="h-4 w-4 text-success" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-muted-foreground" />
                )}
                <Globe className="h-5 w-5 text-primary" />
                <span className="text-sm font-semibold text-foreground">{platform.platform_name}</span>
              </div>
              {statusIconMap[ps] || statusIconMap.pending}
            </div>
            <div className="mb-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                <span>{t("syncProgress")}</span>
                <span>{platform.synced_count}/{platform.total_count}</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    ps === "synced" ? "bg-success" :
                    ps === "error" ? "bg-error" :
                    ps === "outdated" ? "bg-warning" : "bg-primary",
                  )}
                  style={{
                    width: platform.total_count > 0
                      ? `${(platform.synced_count / platform.total_count) * 100}%`
                      : "0%",
                  }}
                />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className={cn(
                "rounded-full px-2 py-0.5 text-xs font-medium",
                ps === "synced" && "bg-success/10 text-success",
                ps === "outdated" && "bg-warning/10 text-warning",
                ps === "error" && "bg-error/10 text-error",
                ps === "pending" && "bg-muted/50 text-muted-foreground",
                ps === "partial" && "bg-warning/10 text-warning",
              )}>
                {tc(statusLabelMap[ps] || "status.pending")}
              </span>
              <button
                className={cn(
                  "flex items-center gap-1 rounded-md bg-secondary px-2.5 py-1",
                  "text-xs font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors",
                )}
                onClick={() => handleSyncPlatform(platform.platform_id)}
              >
                <RefreshCw className="h-3 w-3" />
                {t("syncNow")}
              </button>
            </div>
          </div>
          );
        })}
      </div>

      {(!syncStatus?.platforms || syncStatus.platforms.length === 0) && (
        <div className="flex flex-col items-center justify-center py-12">
          <Globe className="mb-3 h-12 w-12 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">{t("emptyGlobal")}</p>
        </div>
      )}

      {/* T14: Recent Distribution History */}
      {recentLogs.length > 0 && (
        <div className="mt-6 rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <History className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">最近分发</h3>
          </div>
          <div className="space-y-2">
            {recentLogs.map((log) => (
              <div key={log.id} className="flex items-center justify-between rounded-md px-3 py-2 bg-muted/30">
                <div className="flex items-center gap-2 min-w-0">
                  {log.target_type === "skill" ? (
                    <Package className="h-3.5 w-3.5 text-primary shrink-0" />
                  ) : (
                    <FileText className="h-3.5 w-3.5 text-primary shrink-0" />
                  )}
                  <span className="text-sm text-foreground truncate">{log.target_id}</span>
                  {log.platform_id && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground shrink-0">
                      {log.platform_id}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-medium",
                    log.status === "success" && "bg-success/10 text-success",
                    log.status === "error" && "bg-error/10 text-error",
                    log.status !== "success" && log.status !== "error" && "bg-muted/50 text-muted-foreground",
                  )}>
                    {log.status === "success" ? "成功" : log.status === "error" ? "失败" : log.status}
                  </span>
                  <span className="text-xs text-muted-foreground">{formatDate(log.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* T6: Verify & Repair Modal */}
      {showVerifyModal && verifyReport && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50">
          <div className="w-[560px] max-h-[80vh] rounded-lg border border-border bg-card p-6 shadow-xl animate-fade-in flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">同步验证报告</h2>
              <button onClick={() => setShowVerifyModal(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex gap-4 mb-4">
              <div className="flex items-center gap-2 rounded-md bg-success/10 px-3 py-1.5">
                <CheckCircle className="h-4 w-4 text-success" />
                <span className="text-sm font-medium text-success">已同步 ({verifyReport.ok} 项)</span>
              </div>
              {verifyReport.drifted.length > 0 && (
                <div className="flex items-center gap-2 rounded-md bg-warning/10 px-3 py-1.5">
                  <AlertTriangle className="h-4 w-4 text-warning" />
                  <span className="text-sm font-medium text-warning">有漂移 ({verifyReport.drifted.length} 项)</span>
                </div>
              )}
            </div>

            {verifyReport.drifted.length > 0 && (
              <div className="flex-1 overflow-y-auto space-y-2 mb-4">
                {verifyReport.drifted.map((item, idx) => (
                  <div key={idx} className="rounded-md border border-warning/20 bg-warning/5 p-3">
                    <div className="flex items-start gap-2 mb-2">
                      {item.item_type === "skill" ? (
                        <Package className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                      ) : (
                        <FileText className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">{item.item_id}</span>
                          <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{item.platform_id}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{item.issue}</p>
                      </div>
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button
                        className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                        onClick={() => handleRepair(item)}
                      >
                        从 DB 覆盖
                      </button>
                      <button
                        className="rounded-md bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground hover:bg-secondary/80"
                        onClick={() => {
                          setVerifyReport((prev) => prev ? {
                            ...prev,
                            drifted: prev.drifted.filter((_, i) => i !== idx),
                          } : null);
                        }}
                      >
                        忽略
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {verifyReport.drifted.length > 0 && (
              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <button
                  className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
                  onClick={() => setShowVerifyModal(false)}
                >
                  关闭
                </button>
                <button
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                  onClick={handleRepairAll}
                >
                  全部从 DB 覆盖
                </button>
              </div>
            )}

            {verifyReport.drifted.length === 0 && (
              <div className="flex justify-end pt-2">
                <button
                  className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
                  onClick={() => setShowVerifyModal(false)}
                >
                  关闭
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

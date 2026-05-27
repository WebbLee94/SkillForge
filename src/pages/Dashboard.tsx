import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../stores/appStore";
import { cn } from "../lib/utils";
import { formatDate } from "../lib/utils";
import { Package, FileText, Film, FolderOpen, Download, Plus, RefreshCw, Globe } from "lucide-react";
import { getPlatformIcon } from "../components/icons/PlatformIcons";

export function Dashboard() {
  const { t } = useTranslation("common");
  const dashboardStats = useAppStore((s) => s.dashboardStats);
  const globalDistStatus = useAppStore((s) => s.globalDistStatus);
  const fetchDashboardStats = useAppStore((s) => s.fetchDashboardStats);
  const fetchRecentActivity = useAppStore((s) => s.fetchRecentActivity);
  const fetchGlobalDistStatus = useAppStore((s) => s.fetchGlobalDistStatus);
  const setActiveNav = useAppStore((s) => s.setActiveNav);

  useEffect(() => {
    fetchDashboardStats();
    fetchRecentActivity();
    fetchGlobalDistStatus();
  }, [fetchDashboardStats, fetchRecentActivity, fetchGlobalDistStatus]);

  const statCards = [
    {
      label: t("nav.skills"),
      value: dashboardStats?.skill_count ?? 0,
      icon: <Package className="h-5 w-5" />,
      color: "text-primary",
      bgColor: "bg-primary/10",
      navKey: "skills",
    },
    {
      label: t("nav.rules"),
      value: dashboardStats?.rule_count ?? 0,
      icon: <FileText className="h-5 w-5" />,
      color: "text-success",
      bgColor: "bg-success/10",
      navKey: "rules",
    },
    {
      label: t("nav.scenes"),
      value: dashboardStats?.user_scene_count ?? 0,
      icon: <Film className="h-5 w-5" />,
      color: "text-warning",
      bgColor: "bg-warning/10",
      navKey: "scenes",
    },
    {
      label: t("nav.projectDistribution"),
      value: dashboardStats?.project_count ?? 0,
      icon: <FolderOpen className="h-5 w-5" />,
      color: "text-error",
      bgColor: "bg-error/10",
      navKey: "projectDistribution",
    },
  ];

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      <h1 className="mb-6 text-2xl font-bold text-foreground">{t("nav.dashboard")}</h1>

      {/* Stat Cards */}
      <div className="mb-6 grid grid-cols-4 gap-4">
        {statCards.map((card) => (
          <button
            key={card.navKey}
            className={cn(
              "flex items-center gap-4 rounded-lg border border-border bg-card p-4",
              "hover:shadow-md transition-shadow text-left",
            )}
            onClick={() => setActiveNav(card.navKey)}
          >
            <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg", card.bgColor, card.color)}>
              {card.icon}
            </div>
            <div>
              <div className="text-2xl font-bold text-foreground">{card.value}</div>
              <div className="text-sm text-muted-foreground">{card.label}</div>
            </div>
          </button>
        ))}
      </div>

      <div>
        {/* Global Distribution Status (full width) */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground">{t("dashboard.globalDistStatus")}</h2>
            <Globe className="h-4 w-4 text-primary" />
          </div>
          {globalDistStatus ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{t("dashboard.currentScene")}</span>
                <span className="text-sm font-medium text-foreground">
                  {globalDistStatus.scene_name || t("dashboard.notConfigured")}
                </span>
              </div>
              {!globalDistStatus.scene_id && (
                <button
                  className="flex w-full items-center justify-center gap-2 rounded-md bg-primary/10 px-3 py-2 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
                  onClick={() => setActiveNav("globalDistribution")}
                >
                  <Globe className="h-3.5 w-3.5" />
                  {t("dashboard.configureGlobalScene")}
                </button>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{t("dashboard.skillRuleCount")}</span>
                <span className="text-sm font-medium text-foreground">
                  {globalDistStatus.skill_count} / {globalDistStatus.rule_count}
                </span>
              </div>
              {globalDistStatus.platforms.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {globalDistStatus.platforms.map((p) => {
                    const allSynced = p.synced_count === p.total_count && p.total_count > 0;
                    const hasError = p.synced_count === 0 && p.total_count > 0;
                    const dotColor = allSynced ? "bg-success" : hasError ? "bg-error" : "bg-warning";
                    const PlatformIcon = getPlatformIcon(p.platform_id);
                    return (
                      <button
                        key={p.platform_id}
                        className="flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs hover:bg-muted transition-colors"
                        onClick={() => setActiveNav("globalDistribution")}
                      >
                        {PlatformIcon && <PlatformIcon className="h-3.5 w-3.5" />}
                        <span className={cn("h-1.5 w-1.5 rounded-full", dotColor)} />
                        <span className="font-medium text-foreground">{p.platform_name}</span>
                        <span className="text-muted-foreground">{p.synced_count}/{p.total_count}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {globalDistStatus.last_synced_at && (
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-muted-foreground">{t("distribution:lastSynced")}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(globalDistStatus.last_synced_at)}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("messages.noData")}</p>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="mt-6 flex gap-3">
        <button
          className={cn(
            "flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5",
            "text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors",
          )}
          onClick={() => setActiveNav("skills")}
        >
          <Download className="h-4 w-4" />
          {t("actions.import")} {t("nav.skills")}
        </button>
        <button
          className={cn(
            "flex items-center gap-2 rounded-lg bg-secondary px-4 py-2.5",
            "text-sm font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors",
          )}
          onClick={() => setActiveNav("scenes")}
        >
          <Plus className="h-4 w-4" />
          {t("actions.create")} {t("nav.scenes")}
        </button>
        <button
          className={cn(
            "flex items-center gap-2 rounded-lg bg-secondary px-4 py-2.5",
            "text-sm font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors",
          )}
          onClick={() => setActiveNav("globalDistribution")}
        >
          <RefreshCw className="h-4 w-4" />
          {t("actions.syncAll")}
        </button>
      </div>
    </div>
  );
}

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ipc } from "../lib/ipc";
import { cn } from "../lib/utils";
import { Globe, Server, ExternalLink, Database, CheckCircle2, XCircle, FolderOpen, Clipboard } from "lucide-react";
import { getPlatformIcon } from "../components/icons/PlatformIcons";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useAppStore } from "../stores/appStore";
import type { Platform, PlatformCapabilities } from "../types";

type SettingsTab = "general" | "platforms";

const APP_VERSION = "1.0.1";
const GITHUB_URL = "https://github.com/WebbLee94/SkillForge";
const LANG_STORAGE_KEY = "skillforge-lang";

function resolveSystemLanguage(): string {
  const browserLang = navigator.language || "zh-CN";
  if (browserLang.startsWith("zh")) return "zh-CN";
  return "en-US";
}

function getStoredLanguage(): string {
  const stored = localStorage.getItem(LANG_STORAGE_KEY);
  if (stored === "system") return "system";
  if (stored === "zh-CN" || stored === "en-US") return stored;
  return "system";
}

export function Settings() {
  const { t, i18n } = useTranslation(["common", "settings"]);
  const addToast = useAppStore((s) => s.addToast);
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [dataDir, setDataDir] = useState("~/.skillforge/");
  const [rawDataDir, setRawDataDir] = useState<string | null>(null);
  const [dbSize, setDbSize] = useState<string | null>(null);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [platformsLoading, setPlatformsLoading] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [capabilitiesMap, setCapabilitiesMap] = useState<Record<string, PlatformCapabilities>>({});

  // Resolve the effective language for the <select> value
  const effectiveLang = (() => {
    const stored = getStoredLanguage();
    if (stored === "system") return "system";
    return i18n.language;
  })();

  useEffect(() => {
    ipc.getAppConfig().then((config) => {
      setRawDataDir(config.data_dir);
      // T9: Replace absolute home path with ~
      const homeDir = config.data_dir.split("/.skillforge")[0];
      setDataDir(config.data_dir.replace(homeDir, "~"));
    }).catch(() => {
      // fallback to default
    });
  }, []);

  useEffect(() => {
    ipc.getDbSize().then((size) => {
      setDbSize(size);
    }).catch(() => {
      setDbSize(null);
    });
  }, []);

  useEffect(() => {
    if (activeTab === "platforms") {
      setPlatformsLoading(true);
      ipc.listPlatforms().then((list) => {
        setPlatforms(list);
        setPlatformsLoading(false);
      }).catch(() => {
        setPlatformsLoading(false);
      });
    }
  }, [activeTab]);

  useEffect(() => {
    const fetchCaps = async () => {
      const map: Record<string, PlatformCapabilities> = {};
      for (const p of platforms) {
        try { map[p.id] = await ipc.getCapabilities(p.id); } catch (e) { console.error('getCapabilities failed:', e); }
      }
      setCapabilitiesMap(map);
    };
    if (platforms.length > 0) fetchCaps();
  }, [platforms]);

  const handleLanguageChange = useCallback((lng: string) => {
    localStorage.setItem(LANG_STORAGE_KEY, lng);
    if (lng === "system") {
      i18n.changeLanguage(resolveSystemLanguage());
    } else {
      i18n.changeLanguage(lng);
    }
  }, [i18n]);

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

  const tabs: { key: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { key: "general", label: t("settings:tabs.general"), icon: <Globe className="h-4 w-4" /> },
    { key: "platforms", label: t("settings:tabs.platforms"), icon: <Server className="h-4 w-4" /> },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-border px-6 py-4">
        <h1 className="text-xl font-semibold text-foreground">{t("settings:title")}</h1>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left tab list */}
        <div className="w-[200px] shrink-0 border-r border-border py-4 px-3">
          <nav className="space-y-1">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                  activeTab === tab.key
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Right content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === "general" && (
            <div className="max-w-[600px] space-y-6">
              {/* Language */}
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-foreground">{t("settings:general.language.title")}</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">{t("settings:general.language.desc")}</p>
                  </div>
                  <select
                    value={effectiveLang}
                    onChange={(e) => handleLanguageChange(e.target.value)}
                    className="w-36 rounded-lg border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="system">{t("settings:general.languageSystem")}</option>
                    <option value="zh-CN">简体中文</option>
                    <option value="en-US">English</option>
                  </select>
                </div>
              </div>

              {/* Data directory + DB size */}
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-foreground">{t("settings:general.dataDir.title")}</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">{t("settings:general.dataDir.desc")}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
                      <Database className="h-3 w-3" />
                      <span>{dbSize ?? t("settings:general.dbSizeCalculating")}</span>
                    </div>
                    <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5 text-sm text-foreground">
                      <button
                        className="text-muted-foreground hover:text-primary transition-colors"
                        onClick={() => rawDataDir && revealItemInDir(rawDataDir)}
                        title="在文件管理器中打开"
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                      </button>
                      <span className="font-mono text-xs">{dataDir}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Version */}
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-foreground">{t("settings:general.version.title")}</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">{t("settings:general.version.desc")}</p>
                  </div>
                  <span className="rounded-lg bg-muted px-3 py-1.5 text-xs font-mono text-foreground">
                    v{APP_VERSION}
                  </span>
                </div>
              </div>

              {/* GitHub */}
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-foreground">{t("settings:general.github.title")}</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">{t("settings:general.github.desc")}</p>
                  </div>
                  <a
                    href={GITHUB_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 rounded-lg bg-muted px-3 py-1.5 text-xs text-primary hover:bg-accent transition-colors"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {GITHUB_URL.replace("https://", "")}
                  </a>
                </div>
              </div>

              {/* Distribution method info */}
              <div className="rounded-lg border border-border bg-card p-4">
                <div>
                  <h3 className="text-sm font-medium text-foreground">{t("settings:general.distribution.title")}</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t("settings:general.distribution.desc")}</p>
                </div>
              </div>
            </div>
          )}

          {activeTab === "platforms" && (
            <div className="max-w-[800px] space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-foreground">{t("settings:platforms.title")}</h3>
              </div>

              {/* Platform table */}
              {platformsLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <th className="px-4 py-2.5 text-left font-medium text-muted-foreground w-10"></th>
                        <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">{t("settings:platforms.columns.name")}</th>
                        <th className="px-4 py-2.5 text-center font-medium text-muted-foreground w-[180px]">路径与能力</th>
                        <th className="px-4 py-2.5 text-center font-medium text-muted-foreground w-20">{t("settings:platforms.columns.status")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {platforms.map((platform) => {
                        const IconComp = getPlatformIcon(platform.id);
                        const isToggling = togglingId === platform.id;
                        const caps = capabilitiesMap[platform.id];
                        return (
                          <tr
                            key={platform.id}
                            className="border-b border-border last:border-0 group"
                          >
                            <td className={cn("px-4 py-2.5", !platform.enabled && "opacity-60")}>
                              <IconComp className="h-5 w-5 text-muted-foreground" />
                            </td>
                            <td className={cn("px-4 py-2.5 text-foreground font-medium", !platform.enabled && "opacity-60")}>{platform.name}</td>
                            <td className="px-4 py-2.5 text-center">
                              {(() => {
                                if (!caps) return <span className="text-xs text-muted-foreground">-</span>;
                                const CapBadge = ({ supported, label }: { supported: boolean; label: string }) => (
                                  <span title={`${label}: ${supported ? "✓" : "✗"}`}>
                                    {supported
                                      ? <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                                      : <XCircle className="h-3.5 w-3.5 text-error" />}
                                  </span>
                                );
                                const capLabels = [
                                  { key: "skills_global", supported: caps.skills_global, label: "全局技能", path: platform.paths?.global_skills_dir || "" },
                                  { key: "skills_project", supported: caps.skills_project, label: "项目技能", path: platform.paths?.project_skills_pattern || "" },
                                  { key: "rules_global", supported: caps.rules_global, label: "全局规则", path: platform.paths?.global_rules_dir || "" },
                                  { key: "rules_project", supported: caps.rules_project, label: "项目规则", path: platform.paths?.project_rules_pattern || "" },
                                ];
                                return (
                                  <div className="relative">
                                    <div className="flex items-center justify-center gap-1.5">
                                      {capLabels.map((c) => (
                                        <CapBadge key={c.key} supported={c.supported} label={c.label} />
                                      ))}
                                    </div>
                                    {/* Tooltip on hover — bg-popover 背景不受 row 透明度影响 */}
                                    <div className="absolute left-1/2 -translate-x-1/2 top-full z-50 mt-1 hidden group-hover:block">
                                      <div className="rounded-lg border border-border bg-popover p-3 shadow-lg text-left min-w-[280px] max-w-[320px]">
                                        {capLabels.map((c) => (
                                          <div key={c.key} className="flex items-center gap-2 py-1 text-xs">
                                            {c.supported
                                              ? <CheckCircle2 className="h-3 w-3 text-success shrink-0" />
                                              : <XCircle className="h-3 w-3 text-error shrink-0" />
                                            }
                                            <span className="text-muted-foreground w-16 shrink-0">{c.label}</span>
                                            {c.supported && c.path ? (
                                              <span className="font-mono text-foreground truncate flex-1">{c.path}</span>
                                            ) : (
                                              <span className="text-muted-foreground/50">不支持</span>
                                            )}
                                            {c.supported && c.path && (
                                              <button
                                                className="shrink-0 text-muted-foreground hover:text-primary"
                                                onClick={() => {
                                                  navigator.clipboard.writeText(c.path);
                                                  addToast("已复制", "success");
                                                }}
                                                title="复制路径"
                                              >
                                                <Clipboard className="h-3 w-3" />
                                              </button>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })()}
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              <button
                                onClick={() => handleTogglePlatform(platform)}
                                disabled={isToggling}
                                className={cn(
                                  "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                                  platform.enabled ? "bg-primary" : "bg-muted",
                                  isToggling && "cursor-wait",
                                )}
                                role="switch"
                                aria-checked={platform.enabled}
                                title={platform.enabled ? t("settings:platforms.actions.disable") : t("settings:platforms.actions.enable")}
                              >
                                <span
                                  className={cn(
                                    "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow ring-0 transition-transform duration-200 ease-in-out",
                                    platform.enabled ? "translate-x-4" : "translate-x-0",
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
                {t("settings:platforms.hint")}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

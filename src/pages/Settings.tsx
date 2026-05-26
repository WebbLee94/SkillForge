import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ipc } from "../lib/ipc";
import { cn } from "../lib/utils";
import { Globe, Server, ShoppingBag, ExternalLink, Database, Folder, Info } from "lucide-react";
import type { Platform } from "../types";

type SettingsTab = "general" | "platforms" | "marketplace";

const APP_VERSION = "1.0.0";
const GITHUB_URL = "https://github.com/JieYueGo/SkillForge";

export function Settings() {
  const { i18n } = useTranslation("common");
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [dataDir, setDataDir] = useState("~/.skillforge/");
  const [dbSize] = useState<string | null>(null);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [platformsLoading, setPlatformsLoading] = useState(false);

  useEffect(() => {
    ipc.getAppConfig().then((config) => {
      setDataDir(config.data_dir);
    }).catch(() => {
      // fallback to default
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

  const handleLanguageChange = (lng: string) => {
    i18n.changeLanguage(lng);
  };

  const tabs: { key: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { key: "general", label: "通用", icon: <Globe className="h-4 w-4" /> },
    { key: "platforms", label: "平台管理", icon: <Server className="h-4 w-4" /> },
    { key: "marketplace", label: "技能市场", icon: <ShoppingBag className="h-4 w-4" /> },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-border px-6 py-4">
        <h1 className="text-xl font-semibold text-foreground">设置</h1>
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
                    <h3 className="text-sm font-medium text-foreground">语言 / Language</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">选择界面显示语言</p>
                  </div>
                  <select
                    value={i18n.language}
                    onChange={(e) => handleLanguageChange(e.target.value)}
                    className="rounded-lg border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="zh-CN">简体中文</option>
                    <option value="en-US">English</option>
                  </select>
                </div>
              </div>

              {/* Data directory */}
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-foreground">数据目录</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">SkillForge 数据存储位置</p>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5 text-sm text-foreground">
                    <Folder className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-mono text-xs">{dataDir}</span>
                  </div>
                </div>
              </div>

              {/* Database size */}
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-foreground">数据库大小</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">SQLite 数据库文件占用空间</p>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5 text-sm text-foreground">
                    <Database className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs">{dbSize ?? "计算中..."}</span>
                  </div>
                </div>
              </div>

              {/* Version */}
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-foreground">版本</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">当前应用版本号</p>
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
                    <h3 className="text-sm font-medium text-foreground">GitHub</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">查看源码和提交反馈</p>
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
            </div>
          )}

          {activeTab === "platforms" && (
            <div className="max-w-[800px] space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-foreground">已注册平台</h3>
                <button
                  className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground cursor-not-allowed opacity-50"
                  disabled
                  title="即将推出"
                >
                  + 添加平台
                </button>
              </div>

              {/* Notice */}
              <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/5 p-3">
                <Info className="h-4 w-4 shrink-0 mt-0.5 text-warning" />
                <p className="text-xs text-muted-foreground">
                  平台管理功能将在后续版本中开放，当前仅支持查看内置平台
                </p>
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
                        <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">名称</th>
                        <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Adapter</th>
                        <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">全局 Skills 路径</th>
                        <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">项目路径</th>
                        <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {platforms.map((platform) => (
                        <tr key={platform.id} className="border-b border-border last:border-0">
                          <td className="px-4 py-2.5 text-foreground font-medium">{platform.name}</td>
                          <td className="px-4 py-2.5">
                            <span className="rounded bg-secondary px-1.5 py-0.5 text-xs font-mono text-secondary-foreground">
                              {platform.adapter}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground max-w-[200px] truncate">
                            {platform.global_path || "-"}
                          </td>
                          <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground max-w-[200px] truncate">
                            {platform.project_path || "-"}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <button
                              className="rounded px-2 py-1 text-xs text-muted-foreground cursor-not-allowed opacity-50"
                              disabled
                            >
                              编辑
                            </button>
                            <button
                              className="ml-1 rounded px-2 py-1 text-xs text-error cursor-not-allowed opacity-50"
                              disabled
                            >
                              删除
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === "marketplace" && (
            <div className="flex flex-col items-center justify-center py-20">
              <ShoppingBag className="mb-4 h-16 w-16 text-muted-foreground/20" />
              <h3 className="text-lg font-medium text-muted-foreground">技能市场功能开发中</h3>
              <p className="mt-2 text-sm text-muted-foreground/70">后续版本将支持在线浏览和一键安装技能</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

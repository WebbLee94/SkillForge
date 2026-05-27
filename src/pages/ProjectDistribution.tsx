import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../stores/appStore";
import { ipc } from "../lib/ipc";
import { cn } from "../lib/utils";
import { AddProjectDialog } from "../components/AddProjectDialog";
import { getPlatformIcon } from "../components/icons/PlatformIcons";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  Plus, FolderOpen, Trash2, RefreshCw,
  CheckCircle, AlertCircle, Clock, AlertTriangle, Search, Globe, Filter,
} from "lucide-react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import type { SyncStatus } from "../types";

const statusIconMap: Record<SyncStatus, React.ReactNode> = {
  synced: <CheckCircle className="h-3.5 w-3.5 text-success" />,
  outdated: <AlertTriangle className="h-3.5 w-3.5 text-warning" />,
  partial: <AlertTriangle className="h-3.5 w-3.5 text-warning" />,
  error: <AlertCircle className="h-3.5 w-3.5 text-error" />,
  pending: <Clock className="h-3.5 w-3.5 text-muted-foreground" />,
};

export function ProjectDistribution() {
  const { t } = useTranslation("distribution");
  const { t: tc } = useTranslation("common");
  const projects = useAppStore((s) => s.projects);
  const scenes = useAppStore((s) => s.scenes);
  const distributions = useAppStore((s) => s.distributions);
  const platforms = useAppStore((s) => s.platforms);
  const fetchProjects = useAppStore((s) => s.fetchProjects);
  const fetchScenes = useAppStore((s) => s.fetchScenes);
  const fetchDistributions = useAppStore((s) => s.fetchDistributions);
  const fetchPlatforms = useAppStore((s) => s.fetchPlatforms);
  const addProject = useAppStore((s) => s.addProject);
  const removeProject = useAppStore((s) => s.removeProject);
  const bindSceneToProject = useAppStore((s) => s.bindSceneToProject);
  const syncScene = useAppStore((s) => s.syncScene);

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sceneFilter, setSceneFilter] = useState<string>("");
  const [confirmDeleteProjectId, setConfirmDeleteProjectId] = useState<string | null>(null);

  // Scene-bound platform IDs map: sceneId -> platformId[]
  const [scenePlatformsMap, setScenePlatformsMap] = useState<Record<string, string[]>>({});

  // Fetch scene platforms for all projects with bound scenes
  useEffect(() => {
    const fetchScenePlatforms = async () => {
      const sceneIds = [...new Set(projects.filter((p) => p.scene_id).map((p) => p.scene_id!))];
      const map: Record<string, string[]> = {};
      for (const sid of sceneIds) {
        if (!scenePlatformsMap[sid]) {
          try {
            map[sid] = await ipc.getScenePlatforms(sid);
          } catch (e) {
            console.error('getScenePlatforms failed:', e);
            map[sid] = [];
          }
        }
      }
      if (Object.keys(map).length > 0) {
        setScenePlatformsMap((prev) => ({ ...prev, ...map }));
      }
    };
    fetchScenePlatforms();
  }, [projects]);

  useEffect(() => {
    fetchProjects();
    fetchScenes();
    fetchDistributions();
    fetchPlatforms();
    // Detect URL param for scene_id
    const params = new URLSearchParams(window.location.search);
    const sceneId = params.get("scene_id");
    if (sceneId) setSceneFilter(sceneId);
  }, [fetchProjects, fetchScenes, fetchDistributions, fetchPlatforms]);

  const handleAddProject = useCallback(async (data: { name: string; path: string; sceneId?: string }) => {
    await addProject(data.name, data.path, data.sceneId);
    if (data.sceneId) {
      const projects = useAppStore.getState().projects;
      const newProject = projects[projects.length - 1];
      if (newProject) {
        // Use scene-associated platforms (null = auto-resolve from scene_platforms)
        await syncScene(data.sceneId, null, "project", newProject.id);
      }
    }
    setShowAddDialog(false);
  }, [addProject, syncScene]);

  const handleRemoveProject = useCallback((id: string) => {
    setConfirmDeleteProjectId(id);
  }, []);

  const executeRemoveProject = useCallback(async () => {
    if (!confirmDeleteProjectId) return;
    await removeProject(confirmDeleteProjectId);
    setConfirmDeleteProjectId(null);
  }, [confirmDeleteProjectId, removeProject]);

  const handleSyncProject = useCallback(async (projectId: string, sceneId: string, platformId: string) => {
    await syncScene(sceneId, [platformId], "project", projectId);
  }, [syncScene]);

  const getProjectDistributions = useCallback((projectId: string) => {
    return distributions.filter((d) => d.project_id === projectId);
  }, [distributions]);

  const filteredProjects = projects.filter((p) => {
    if (searchQuery && !p.name.toLowerCase().includes(searchQuery.toLowerCase()) && !p.path.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (sceneFilter && p.scene_id !== sceneFilter) return false;
    return true;
  });

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("projectTitle")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("projectSubtitle")}</p>
        </div>
        <button
          className={cn(
            "flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5",
            "text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors",
          )}
          onClick={() => setShowAddDialog(true)}
        >
          <Plus className="h-4 w-4" />
          {t("addProject")}
        </button>
      </div>

      {/* Search + Scene Filter */}
      <div className="mb-4 flex items-center gap-3">
        <div className="relative max-w-[400px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={tc("actions.searchProjects")}
            className={cn(
              "w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm",
              "placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring",
            )}
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <select
            value={sceneFilter}
            onChange={(e) => setSceneFilter(e.target.value)}
            className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">{tc("scenes:allScenes")}</option>
            {scenes.map((scene) => (
              <option key={scene.id} value={scene.id}>{scene.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Project Cards */}
      <div className="space-y-4">
        {filteredProjects.map((project) => {
          const projectDists = getProjectDistributions(project.id);
          const platformStatuses = new Map<string, string>();
          projectDists.forEach((d) => platformStatuses.set(d.platform_id, d.status || "pending"));

          return (
            <div key={project.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <button
                    className="text-primary hover:text-primary/80 transition-colors"
                    onClick={() => revealItemInDir(project.path)}
                    title={tc("actions.openInFileManager")}
                  >
                    <FolderOpen className="h-5 w-5" />
                  </button>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{project.name}</h3>
                    <p className="text-xs text-muted-foreground">{project.path}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={project.scene_id || ""}
                    onChange={(e) => {
                      if (e.target.value) {
                        bindSceneToProject(project.id, e.target.value);
                      }
                    }}
                    className="rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="">{t("bindScene")}</option>
                    {scenes.map((scene) => (
                      <option key={scene.id} value={scene.id}>{scene.name}</option>
                    ))}
                  </select>
                  <button
                    className="text-muted-foreground hover:text-error transition-colors"
                    onClick={() => handleRemoveProject(project.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Platform Status Grid - filtered by scene-bound platforms */}
              {!project.scene_id ? (
                <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
                  <Globe className="h-4 w-4 mr-2 text-muted-foreground/50" />
                  {t("bindSceneFirst")}
                </div>
              ) : (scenePlatformsMap[project.scene_id] || []).length === 0 ? (
                <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
                  <Globe className="h-4 w-4 mr-2 text-muted-foreground/50" />
                  {t("noPlatformForSceneProject")}
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {platforms
                    .filter((p) => (scenePlatformsMap[project.scene_id!] || []).includes(p.id))
                    .map((platform) => {
                  const rawStatus = platformStatuses.get(platform.id) || "pending";
                  const status = rawStatus as SyncStatus;
                  return (
                    <div key={platform.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                      <div className="flex items-center gap-2">
                        {statusIconMap[status] || statusIconMap.pending}
                        {(() => { const Icon = getPlatformIcon(platform.id); return <Icon className="h-4 w-4 text-muted-foreground" />; })()}
                        <span className="text-xs font-medium text-foreground">{platform.name}</span>
                      </div>
                      <button
                        className="text-muted-foreground hover:text-primary transition-colors"
                        onClick={() => {
                          if (project.scene_id) {
                            handleSyncProject(project.id, project.scene_id, platform.id);
                          }
                        }}
                        disabled={!project.scene_id}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
              )}
            </div>
          );
        })}
      </div>

      {filteredProjects.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12">
          <FolderOpen className="mb-3 h-12 w-12 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        </div>
      )}

      <AddProjectDialog
        open={showAddDialog}
        onClose={() => setShowAddDialog(false)}
        onConfirm={handleAddProject}
        scenes={scenes.map((s) => ({ id: s.id, name: s.name }))}
      />

      <ConfirmDialog
        open={confirmDeleteProjectId !== null}
        title={tc("messages.confirmDelete")}
        message={tc("messages.confirmDelete")}
        variant="danger"
        confirmLabel={tc("actions.delete")}
        onConfirm={executeRemoveProject}
        onCancel={() => setConfirmDeleteProjectId(null)}
      />
    </div>
  );
}

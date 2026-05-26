import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../stores/appStore";
import { cn } from "../lib/utils";
import { AddProjectDialog } from "../components/AddProjectDialog";
import {
  Plus, FolderOpen, Trash2, RefreshCw,
  CheckCircle, AlertCircle, Clock, AlertTriangle, Search,
} from "lucide-react";
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

  useEffect(() => {
    fetchProjects();
    fetchScenes();
    fetchDistributions();
    fetchPlatforms();
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

  const handleRemoveProject = useCallback(async (id: string) => {
    if (window.confirm(tc("messages.confirmDelete"))) {
      await removeProject(id);
    }
  }, [tc, removeProject]);

  const handleSyncProject = useCallback(async (projectId: string, sceneId: string, platformId: string) => {
    await syncScene(sceneId, [platformId], "project", projectId);
  }, [syncScene]);

  const getProjectDistributions = useCallback((projectId: string) => {
    return distributions.filter((d) => d.project_id === projectId);
  }, [distributions]);

  const filteredProjects = searchQuery
    ? projects.filter((p) => p.name.toLowerCase().includes(searchQuery.toLowerCase()) || p.path.toLowerCase().includes(searchQuery.toLowerCase()))
    : projects;

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

      {/* Search */}
      <div className="mb-4">
        <div className="relative max-w-[400px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索项目..."
            className={cn(
              "w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm",
              "placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring",
            )}
          />
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
                  <FolderOpen className="h-5 w-5 text-primary" />
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

              {/* Platform Status Grid */}
              <div className="grid grid-cols-4 gap-2">
                {platforms.map((platform) => {
                  const rawStatus = platformStatuses.get(platform.id) || "pending";
                  const status = rawStatus as SyncStatus;
                  return (
                    <div key={platform.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                      <div className="flex items-center gap-2">
                        {statusIconMap[status] || statusIconMap.pending}
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
    </div>
  );
}

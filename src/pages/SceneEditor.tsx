import { useEffect, useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../stores/appStore";
import { ipc } from "../lib/ipc";
import { cn } from "../lib/utils";
import { SortableSkillList } from "../components/SortableSkillList";
import { SortableRuleList } from "../components/SortableRuleList";
import { TagFilterBar } from "../components/TagFilterBar";
import {
  Search, Plus, Save, RefreshCw, Film,
  Package, FileText, X, Monitor, Info, Trash2, CheckCircle2, Users,
} from "lucide-react";
import { getPlatformIcon } from "../components/icons/PlatformIcons";
import { ConfirmDialog } from "../components/ConfirmDialog";
import type { PlatformCapabilities } from "../types";

export function SceneEditor() {
  const { t } = useTranslation("scenes");
  const { t: tc } = useTranslation("common");
  const scenes = useAppStore((s) => s.scenes);
  const currentScene = useAppStore((s) => s.currentScene);
  const currentSceneDetail = useAppStore((s) => s.currentSceneDetail);
  const skills = useAppStore((s) => s.skills);
  const rules = useAppStore((s) => s.rules);
  const platforms = useAppStore((s) => s.platforms);
  const fetchScenes = useAppStore((s) => s.fetchScenes);
  const fetchSkills = useAppStore((s) => s.fetchSkills);
  const fetchRules = useAppStore((s) => s.fetchRules);
  const fetchPlatforms = useAppStore((s) => s.fetchPlatforms);
  const setCurrentScene = useAppStore((s) => s.setCurrentScene);
  const fetchSceneDetail = useAppStore((s) => s.fetchSceneDetail);
  const createScene = useAppStore((s) => s.createScene);
  const updateScene = useAppStore((s) => s.updateScene);
  const addSkillToScene = useAppStore((s) => s.addSkillToScene);
  const removeSkillFromScene = useAppStore((s) => s.removeSkillFromScene);
  const addRuleToScene = useAppStore((s) => s.addRuleToScene);
  const removeRuleFromScene = useAppStore((s) => s.removeRuleFromScene);
  const syncScene = useAppStore((s) => s.syncScene);
  const getScenePlatforms = useAppStore((s) => s.getScenePlatforms);
  const setScenePlatforms = useAppStore((s) => s.setScenePlatforms);
  const deleteScene = useAppStore((s) => s.deleteScene);
  const addToast = useAppStore((s) => s.addToast);
  const projects = useAppStore((s) => s.projects);
  const fetchProjects = useAppStore((s) => s.fetchProjects);

  const [leftTab, setLeftTab] = useState<"skills" | "rules">("skills");
  const [leftSearch, setLeftSearch] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [showCreateScene, setShowCreateScene] = useState(false);
  const [newSceneName, setNewSceneName] = useState("");
  const [newSceneDesc, setNewSceneDesc] = useState("");
  const [sceneName, setSceneName] = useState("");
  const [sceneDesc, setSceneDesc] = useState("");
  const [capabilitiesMap, setCapabilitiesMap] = useState<Record<string, PlatformCapabilities>>({});
  const [sceneTagFilter, setSceneTagFilter] = useState<number[]>([]);
  const [sceneTags, setSceneTags] = useState<import("../types").Tag[]>([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    fetchScenes();
    fetchSkills();
    fetchRules();
    fetchPlatforms();
    fetchProjects();
  }, [fetchScenes, fetchSkills, fetchRules, fetchPlatforms, fetchProjects]);

  // Auto-select first scene when currentScene is null on mount
  useEffect(() => {
    if (!currentScene && scenes.length > 0) {
      setCurrentScene(scenes[0]);
    }
  }, [scenes, currentScene, setCurrentScene]);

  // Fetch tags for current tab and clear filter on tab switch
  useEffect(() => {
    const loadTags = async () => {
      const tagType = leftTab === "skills" ? "skill" : "rule";
      const result = await ipc.listTags(undefined, tagType);
      setSceneTags(result);
    };
    setSceneTagFilter([]);
    loadTags();
  }, [leftTab]);

  useEffect(() => {
    const fetchCaps = async () => {
      const map: Record<string, PlatformCapabilities> = {};
      for (const p of platforms) {
        if (!capabilitiesMap[p.id]) {
          try { map[p.id] = await ipc.getCapabilities(p.id); } catch { /* skip */ }
        }
      }
      if (Object.keys(map).length > 0) setCapabilitiesMap(prev => ({ ...prev, ...map }));
    };
    fetchCaps();
  }, [platforms]);

  useEffect(() => {
    if (currentScene) {
      fetchSceneDetail(currentScene.id);
      setSceneName(currentScene.name);
      setSceneDesc(currentScene.description || "");
      // Load scene-platform associations
      if (!currentScene.is_system) {
        getScenePlatforms(currentScene.id).then((platformIds) => {
          setSelectedPlatforms(platformIds);
        });
      } else {
        setSelectedPlatforms([]);
      }
    }
  }, [currentScene, fetchSceneDetail, getScenePlatforms]);

  const availableSkills = useMemo(() => {
    const sceneSkillIds = new Set(currentSceneDetail?.skills.map((s) => s.skill_id) || []);
    let filtered = skills.filter((s) => !sceneSkillIds.has(s.id));
    if (leftSearch) {
      const q = leftSearch.toLowerCase();
      filtered = filtered.filter(
        (s) => s.name.toLowerCase().includes(q) || (s.description || "").toLowerCase().includes(q),
      );
    }
    if (sceneTagFilter.length > 0) {
      filtered = filtered.filter((s) => {
        if (!s.tags || s.tags.length === 0) return false;
        return sceneTagFilter.some((id) => s.tags!.some((t) => t.id === id));
      });
    }
    return filtered;
  }, [skills, currentSceneDetail, leftSearch, sceneTagFilter]);

  const availableRules = useMemo(() => {
    const sceneRuleIds = new Set(currentSceneDetail?.rules.map((r) => r.rule_id) || []);
    let filtered = rules.filter((r) => !sceneRuleIds.has(r.id));
    if (leftSearch) {
      const q = leftSearch.toLowerCase();
      filtered = filtered.filter(
        (r) => r.name.toLowerCase().includes(q) || (r.description || "").toLowerCase().includes(q),
      );
    }
    if (sceneTagFilter.length > 0) {
      filtered = filtered.filter((r) => {
        if (!r.tags || r.tags.length === 0) return false;
        return sceneTagFilter.some((id) => r.tags!.some((t) => t.id === id));
      });
    }
    return filtered;
  }, [rules, currentSceneDetail, leftSearch, sceneTagFilter]);

  const handleAddSkill = useCallback(async (skillId: string) => {
    if (!currentScene) return;
    await addSkillToScene(currentScene.id, skillId);
  }, [currentScene, addSkillToScene]);

  const handleRemoveSkill = useCallback(async (skillId: string) => {
    if (!currentScene) return;
    await removeSkillFromScene(currentScene.id, skillId);
  }, [currentScene, removeSkillFromScene]);

  const handleToggleSkill = useCallback((skillId: string) => {
    // Toggle would need a backend call; for now update local state
    if (!currentSceneDetail) return;
    const updatedSkills = currentSceneDetail.skills.map((s) =>
      s.skill_id === skillId ? { ...s, enabled: !s.enabled } : s,
    );
    useAppStore.setState({
      currentSceneDetail: { ...currentSceneDetail, skills: updatedSkills },
    });
  }, [currentSceneDetail]);

  const handleRemoveRule = useCallback(async (ruleId: string) => {
    if (!currentScene) return;
    await removeRuleFromScene(currentScene.id, ruleId);
  }, [currentScene, removeRuleFromScene]);

  const handleToggleRule = useCallback((ruleId: string) => {
    if (!currentSceneDetail) return;
    const updatedRules = currentSceneDetail.rules.map((r) =>
      r.rule_id === ruleId ? { ...r, enabled: !r.enabled } : r,
    );
    useAppStore.setState({
      currentSceneDetail: { ...currentSceneDetail, rules: updatedRules },
    });
  }, [currentSceneDetail]);

  const handleSaveScene = useCallback(async () => {
    if (!currentScene) return;
    await updateScene(currentScene.id, {
      name: sceneName,
      description: sceneDesc,
    });
  }, [currentScene, sceneName, sceneDesc, updateScene]);

  const handleSyncScene = useCallback(async () => {
    if (!currentScene) return;
    await syncScene(currentScene.id, selectedPlatforms, "global");
  }, [currentScene, selectedPlatforms, syncScene]);

  const executeDeleteScene = useCallback(async () => {
    if (!currentScene) return;
    try {
      await deleteScene(currentScene.id);
      setCurrentScene(scenes[0] || null);
      fetchScenes();
    } catch (e: unknown) {
      addToast(e?.toString?.() || tc("messages.deleteSceneFailed"), "error");
    }
    setShowDeleteConfirm(false);
  }, [currentScene, deleteScene, scenes, setCurrentScene, fetchScenes, addToast, tc]);

  const handleCreateScene = useCallback(async () => {
    if (!newSceneName.trim()) return;
    await createScene({ name: newSceneName.trim(), description: newSceneDesc.trim() });
    setShowCreateScene(false);
    setNewSceneName("");
    setNewSceneDesc("");
  }, [newSceneName, newSceneDesc, createScene]);

  const togglePlatform = (platform: string) => {
    setSelectedPlatforms((prev) => {
      const next = prev.includes(platform) ? prev.filter((p) => p !== platform) : [...prev, platform];
      // Persist to backend
      if (currentScene && !currentScene.is_system) {
        setScenePlatforms(currentScene.id, next);
      }
      return next;
    });
  };

  return (
    <div className="flex h-full flex-col">
      {/* Top Bar — 5 fixed button positions */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Film className="h-5 w-5 text-primary" />
        <select
          value={currentScene?.id || ""}
          onChange={(e) => {
            const scene = scenes.find((s) => s.id === e.target.value);
            setCurrentScene(scene || null);
          }}
          className="rounded-lg border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {scenes.map((scene) => (
            <option key={scene.id} value={scene.id}>{scene.name}</option>
          ))}
        </select>

        {/* 1. 新建场景 — always enabled */}
        <button
          className={cn(
            "flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5",
            "text-sm font-medium text-primary-foreground hover:bg-primary/90",
          )}
          onClick={() => setShowCreateScene(true)}
        >
          <Plus className="h-4 w-4" />
          {t("createScene")}
        </button>

        {/* 2. 一键同步 — always enabled */}
        {currentScene && (
          <button
            className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            onClick={handleSyncScene}
          >
            <RefreshCw className="h-4 w-4" />
            {t("syncScene")}
          </button>
        )}

        <div className="flex-1" />

        {/* 3. 保存场景 — disabled for system scenes */}
        {currentScene && (
          <button
            className={cn(
              "flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm transition-colors",
              currentScene.is_system
                ? "bg-secondary/50 text-muted-foreground cursor-not-allowed"
                : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
            )}
            onClick={() => !currentScene.is_system && handleSaveScene()}
            title={currentScene.is_system ? t("systemSceneNoSave") : undefined}
          >
            <Save className="h-4 w-4" />
            {t("saveScene")}
          </button>
        )}

        {/* 4. 已用于 N 个项目 — disabled for system scenes */}
        {currentScene && (() => {
          const projectCount = projects.filter((p) => p.scene_id === currentScene.id).length;
          return (
            <button
              className={cn(
                "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition-colors",
                currentScene.is_system || projectCount === 0
                  ? "bg-secondary/50 text-muted-foreground cursor-not-allowed"
                  : "bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
              onClick={() => {
                if (currentScene.is_system || projectCount === 0) return;
                window.location.hash = `/project-distribution?scene_id=${currentScene.id}`;
              }}
              title={currentScene.is_system ? t("systemSceneNoProject") : projectCount === 0 ? t("noLinkedProjects") : t("viewLinkedProjects")}
            >
              <Users className="h-3 w-3" />
              {t("usedInProjects", { count: projectCount })}
            </button>
          );
        })()}

        {/* 5. 删除 — disabled for system scenes */}
        {currentScene && (
          <button
            className={cn(
              "flex items-center gap-1 rounded-lg border px-2 py-1.5 text-sm transition-colors",
              currentScene.is_system
                ? "border-error/10 bg-error/5 text-error/30 cursor-not-allowed"
                : "border-error/30 bg-error/5 text-error hover:bg-error/10",
            )}
            onClick={() => {
              if (currentScene.is_system) return;
              setShowDeleteConfirm(true);
            }}
            title={currentScene.is_system ? t("systemSceneNoDelete") : t("deleteScene")}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {currentScene ? (
        <div className="flex flex-1 overflow-hidden">
          {/* Left Panel: Available Resources */}
          <div className="w-[280px] shrink-0 border-r border-border flex flex-col">
            <div className="p-3 border-b border-border">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={leftSearch}
                  onChange={(e) => setLeftSearch(e.target.value)}
                  placeholder={t("searchPlaceholder", { ns: "skills" })}
                  className={cn(
                    "w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-3 text-sm",
                    "placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring",
                  )}
                />
              </div>
              <div className="mt-2 flex rounded-lg bg-muted p-0.5">
                <button
                  className={cn(
                    "flex-1 rounded-md px-3 py-1 text-xs font-medium transition-colors",
                    leftTab === "skills" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setLeftTab("skills")}
                >
                  <Package className="mr-1 inline h-3 w-3" />
                  {t("skillTab")}
                </button>
                <button
                  className={cn(
                    "flex-1 rounded-md px-3 py-1 text-xs font-medium transition-colors",
                    leftTab === "rules" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setLeftTab("rules")}
                >
                  <FileText className="mr-1 inline h-3 w-3" />
                  {t("ruleTab")}
                </button>
              </div>
              {/* Tag filter bar */}
              <div className="mt-2">
                <TagFilterBar
                  tags={sceneTags}
                  selectedTagIds={sceneTagFilter}
                  onToggleTag={(tagId) => setSceneTagFilter(
                    sceneTagFilter.includes(tagId)
                      ? sceneTagFilter.filter((id) => id !== tagId)
                      : [...sceneTagFilter, tagId],
                  )}
                  onClearAll={() => setSceneTagFilter([])}
                  showUntagged={false}
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {leftTab === "skills" ? (
                <div className="space-y-1">
                  {availableSkills.map((skill) => (
                    <div
                      key={skill.id}
                      className="w-full rounded-lg border border-border bg-card p-2 hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="min-w-0 flex-1">
                          <span className="text-sm font-medium text-foreground truncate block">{skill.name}</span>
                          <p className="mt-0.5 text-xs text-muted-foreground truncate">{skill.description}</p>
                        </div>
                        <button
                          className="shrink-0 ml-2 text-primary hover:text-primary/80 transition-colors"
                          onClick={() => handleAddSkill(skill.id)}
                          title={t("addSkill")}
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                  {availableSkills.length === 0 && (
                    <p className="py-4 text-center text-xs text-muted-foreground">{tc("messages.noData")}</p>
                  )}
                </div>
              ) : (
                <div className="space-y-1">
                  {availableRules.map((rule) => (
                    <div
                      key={rule.id}
                      className="w-full rounded-lg border border-border bg-card p-2 hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="min-w-0 flex-1">
                          <span className="text-sm font-medium text-foreground truncate block">{rule.name}</span>
                          <p className="mt-0.5 text-xs text-muted-foreground truncate">.{rule.format}</p>
                        </div>
                        <button
                          className="shrink-0 ml-2 text-primary hover:text-primary/80 transition-colors"
                          onClick={() => {
                            if (currentScene) addRuleToScene(currentScene.id, rule.id);
                          }}
                          title={t("addRule")}
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                  {availableRules.length === 0 && (
                    <p className="py-4 text-center text-xs text-muted-foreground">{tc("messages.noData")}</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right Panel: Scene Canvas */}
          <div className="flex-1 flex flex-col overflow-y-auto p-4">
            {/* Scene Header */}
            <div className="mb-4">
              {currentScene.is_system && (
                <p className="mb-1 text-xs text-muted-foreground">{t("systemSceneHint")}</p>
              )}
              <input
                type="text"
                value={sceneName}
                onChange={(e) => setSceneName(e.target.value)}
                className="w-full bg-transparent text-xl font-semibold text-foreground focus:outline-none disabled:opacity-60"
                placeholder={t("create.namePlaceholder")}
                disabled={currentScene.is_system}
              />
              <input
                type="text"
                value={sceneDesc}
                onChange={(e) => setSceneDesc(e.target.value)}
                className="w-full mt-1 bg-transparent text-sm text-muted-foreground focus:outline-none disabled:opacity-60"
                placeholder={t("create.descriptionPlaceholder")}
                disabled={currentScene.is_system}
              />
            </div>

            {/* Skills Section */}
            <div className="mb-6">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                <Package className="h-4 w-4 text-primary" />
                {t("sceneSkills")}
                <span className="text-xs font-normal text-muted-foreground">
                  ({currentSceneDetail?.skills.length || 0})
                </span>
              </h3>
              <SortableSkillList
                skills={currentSceneDetail?.skills || []}
                onRemove={handleRemoveSkill}
                onToggle={handleToggleSkill}
                onReorder={() => {}}
                disabled={currentScene.is_system}
              />
            </div>

            {/* Rules Section */}
            <div className="mb-6">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                <FileText className="h-4 w-4 text-success" />
                {t("sceneRules")}
                <span className="text-xs font-normal text-muted-foreground">
                  ({currentSceneDetail?.rules.length || 0})
                </span>
              </h3>
              <SortableRuleList
                rules={currentSceneDetail?.rules || []}
                onRemove={handleRemoveRule}
                onToggle={handleToggleRule}
                onReorder={() => {}}
                disabled={currentScene.is_system}
              />
            </div>

            {/* Platform Selector / Read-only for system scenes */}
            <div className="mb-4">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                <Monitor className="h-4 w-4 text-primary" />
                {t("platforms.title")}
                {currentScene.is_system ? (
                  <span className="text-xs font-normal text-muted-foreground">
                    ({platforms.filter((p) => p.enabled).length} {t("platforms.enabled")})
                  </span>
                ) : (
                  <span className="text-xs font-normal text-muted-foreground">
                    ({selectedPlatforms.length}/{platforms.filter((p) => p.enabled).length})
                  </span>
                )}
              </h3>
              {currentScene.is_system && (
                <p className="mb-2 text-xs text-muted-foreground">
                  {t("platforms.autoBindHint")}
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                {platforms.filter((p) => p.enabled).map((platform) => {
                  const caps = capabilitiesMap[platform.id];
                  const IconComp = getPlatformIcon(platform.id);
                  const limitations: string[] = [];
                  if (caps && !caps.rules_global) limitations.push(t("platforms.noGlobalRules"));
                  if (caps && !caps.rules_project && caps.rules_global) limitations.push(t("platforms.noProjectRules"));
                  if (currentScene.is_system) {
                    // Read-only for system scenes
                    return (
                      <div
                        key={platform.id}
                        className="relative flex items-center gap-2.5 rounded-lg border border-primary/30 bg-primary/5 p-3"
                      >
                        <CheckCircle2 className="absolute right-2 top-2 h-4 w-4 text-primary" />
                        <IconComp className="h-5 w-5 text-muted-foreground shrink-0" />
                        <span className="text-sm font-medium text-foreground">{platform.name}</span>
                        {limitations.length > 0 && (
                          <span className="inline-flex items-center" title={limitations.join("；")}>
                            <Info className="h-3.5 w-3.5 text-warning" />
                          </span>
                        )}
                      </div>
                    );
                  }
                  // Interactive for user scenes
                  const isSelected = selectedPlatforms.includes(platform.id);
                  return (
                    <div
                      key={platform.id}
                      onClick={() => togglePlatform(platform.id)}
                      className={cn(
                        "relative flex items-center gap-2.5 rounded-lg border p-3 cursor-pointer transition-colors",
                        isSelected ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/50",
                      )}
                    >
                      {isSelected && (
                        <CheckCircle2 className="absolute right-2 top-2 h-4 w-4 text-primary" />
                      )}
                      <IconComp className="h-5 w-5 text-muted-foreground shrink-0" />
                      <span className="text-sm font-medium text-foreground">{platform.name}</span>
                      {limitations.length > 0 && (
                        <span className="inline-flex items-center" title={limitations.join("；")}>
                          <Info className="h-3.5 w-3.5 text-warning" />
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <Film className="mx-auto mb-3 h-12 w-12 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">{t("noScene")}</p>
          </div>
        </div>
      )}

      {/* Create Scene Dialog */}
      {showCreateScene && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50">
          <div className="w-[400px] rounded-lg border border-border bg-card p-6 shadow-xl animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">{t("create.title")}</h2>
              <button onClick={() => setShowCreateScene(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">{t("sceneName")}</label>
                <input
                  type="text"
                  value={newSceneName}
                  onChange={(e) => setNewSceneName(e.target.value)}
                  placeholder={t("create.namePlaceholder")}
                  autoFocus
                  className={cn(
                    "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm",
                    "focus:outline-none focus:ring-2 focus:ring-ring",
                  )}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">{t("sceneDescription")}</label>
                <textarea
                  value={newSceneDesc}
                  onChange={(e) => setNewSceneDesc(e.target.value)}
                  placeholder={t("create.descriptionPlaceholder")}
                  rows={3}
                  className={cn(
                    "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none",
                    "focus:outline-none focus:ring-2 focus:ring-ring",
                  )}
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
                  onClick={() => setShowCreateScene(false)}
                >
                  {tc("actions.cancel")}
                </button>
                <button
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                  onClick={handleCreateScene}
                >
                  {tc("actions.create")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={showDeleteConfirm}
        title={tc("messages.confirmDelete")}
        message={tc("messages.confirmDeleteScene", { name: currentScene?.name || "" })}
        variant="danger"
        confirmLabel={tc("actions.delete")}
        onConfirm={executeDeleteScene}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  );
}

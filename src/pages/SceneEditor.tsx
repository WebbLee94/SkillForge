import { useEffect, useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../stores/appStore";
import { ipc } from "../lib/ipc";
import { cn } from "../lib/utils";
import { SortableSkillList } from "../components/SortableSkillList";
import { SortableRuleList } from "../components/SortableRuleList";
import {
  Search, Plus, Save, RefreshCw, Film,
  Package, FileText, X,
} from "lucide-react";
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

  const [leftTab, setLeftTab] = useState<"skills" | "rules">("skills");
  const [leftSearch, setLeftSearch] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [showCreateScene, setShowCreateScene] = useState(false);
  const [newSceneName, setNewSceneName] = useState("");
  const [newSceneDesc, setNewSceneDesc] = useState("");
  const [sceneName, setSceneName] = useState("");
  const [sceneDesc, setSceneDesc] = useState("");
  const [capabilitiesMap, setCapabilitiesMap] = useState<Record<string, PlatformCapabilities>>({});

  useEffect(() => {
    fetchScenes();
    fetchSkills();
    fetchRules();
    fetchPlatforms();
  }, [fetchScenes, fetchSkills, fetchRules, fetchPlatforms]);

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
    return filtered;
  }, [skills, currentSceneDetail, leftSearch]);

  const availableRules = useMemo(() => {
    const sceneRuleIds = new Set(currentSceneDetail?.rules.map((r) => r.rule_id) || []);
    let filtered = rules.filter((r) => !sceneRuleIds.has(r.id));
    if (leftSearch) {
      const q = leftSearch.toLowerCase();
      filtered = filtered.filter(
        (r) => r.name.toLowerCase().includes(q) || (r.description || "").toLowerCase().includes(q),
      );
    }
    return filtered;
  }, [rules, currentSceneDetail, leftSearch]);

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
      {/* Top Bar */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Film className="h-5 w-5 text-primary" />
        <select
          value={currentScene?.id || ""}
          onChange={(e) => {
            const scene = scenes.find((s) => s.id === e.target.value);
            setCurrentScene(scene || null);
          }}
          className="rounded-lg border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">{t("selectScene")}</option>
          {scenes.map((scene) => (
            <option key={scene.id} value={scene.id}>{scene.name}</option>
          ))}
        </select>
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
        <div className="flex-1" />
        {currentScene && (
          <div className="flex items-center gap-2">
            {!currentScene.is_system && (
              <button
                className="flex items-center gap-1 rounded-lg bg-secondary px-3 py-1.5 text-sm text-secondary-foreground hover:bg-secondary/80"
                onClick={handleSaveScene}
              >
                <Save className="h-4 w-4" />
                {t("saveScene")}
              </button>
            )}
            <button
              className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              onClick={handleSyncScene}
            >
              <RefreshCw className="h-4 w-4" />
              {t("syncScene")}
            </button>
          </div>
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
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {leftTab === "skills" ? (
                <div className="space-y-1">
                  {availableSkills.map((skill) => (
                    <button
                      key={skill.id}
                      className="w-full rounded-lg border border-border bg-card p-2 text-left hover:bg-accent transition-colors"
                      onClick={() => handleAddSkill(skill.id)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-foreground truncate">{skill.name}</span>
                        <Plus className="h-4 w-4 shrink-0 text-primary" />
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground truncate">{skill.description}</p>
                    </button>
                  ))}
                  {availableSkills.length === 0 && (
                    <p className="py-4 text-center text-xs text-muted-foreground">{tc("messages.noData")}</p>
                  )}
                </div>
              ) : (
                <div className="space-y-1">
                  {availableRules.map((rule) => (
                    <button
                      key={rule.id}
                      className="w-full rounded-lg border border-border bg-card p-2 text-left hover:bg-accent transition-colors"
                      onClick={() => {
                        if (currentScene) addRuleToScene(currentScene.id, rule.id);
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-foreground truncate">{rule.name}</span>
                        <Plus className="h-4 w-4 shrink-0 text-primary" />
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground truncate">.{rule.format}</p>
                    </button>
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
              />
            </div>

            {/* Platform Selector - hidden for system scenes */}
            {!currentScene.is_system && (
              <div className="mb-4">
                <h3 className="mb-2 text-sm font-semibold text-foreground">{t("targetPlatforms")}</h3>
                <div className="flex flex-wrap gap-2">
                  {platforms.filter((p) => p.enabled).map((platform) => {
                    const caps = capabilitiesMap[platform.id];
                    return (
                      <label key={platform.id} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedPlatforms.includes(platform.id)}
                          onChange={() => togglePlatform(platform.id)}
                          className="rounded border-border"
                        />
                        <span className="text-sm text-foreground">{platform.name}</span>
                        {caps && !caps.rules_global && (
                          <span className="text-xs text-warning ml-1" title={t("capabilities.no_global_rules")}>
                            ⚠️ {t("capabilities.no_global_rules")}
                          </span>
                        )}
                        {caps && !caps.rules_project && caps.rules_global && (
                          <span className="text-xs text-warning ml-1" title={t("capabilities.no_project_rules")}>
                            ⚠️ {t("capabilities.no_project_rules")}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
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
    </div>
  );
}

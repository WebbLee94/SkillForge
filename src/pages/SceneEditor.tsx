import { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../stores/appStore';
import { ipc } from '../lib/ipc';
import { cn } from '../lib/utils';
import { SortableSkillList } from '../components/SortableSkillList';
import { SortableRuleList } from '../components/SortableRuleList';
import { TagFilterBar } from '../components/TagFilterBar';
import {
  Search,
  Plus,
  Save,
  Film,
  Package,
  FileText,
  X,
  Trash2,
  } from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';

export function SceneEditor() {
  const { t } = useTranslation('scenes');
  const { t: tc } = useTranslation('common');
  const scenes = useAppStore((s) => s.scenes);
  const currentScene = useAppStore((s) => s.currentScene);
  const currentSceneDetail = useAppStore((s) => s.currentSceneDetail);
  const skills = useAppStore((s) => s.skills);
  const rules = useAppStore((s) => s.rules);
  const fetchScenes = useAppStore((s) => s.fetchScenes);
  const fetchSkills = useAppStore((s) => s.fetchSkills);
  const fetchRules = useAppStore((s) => s.fetchRules);
  const setCurrentScene = useAppStore((s) => s.setCurrentScene);
  const fetchSceneDetail = useAppStore((s) => s.fetchSceneDetail);
  const createScene = useAppStore((s) => s.createScene);
  const updateScene = useAppStore((s) => s.updateScene);
  const addSkillToScene = useAppStore((s) => s.addSkillToScene);
  const removeSkillFromScene = useAppStore((s) => s.removeSkillFromScene);
  const addRuleToScene = useAppStore((s) => s.addRuleToScene);
  const removeRuleFromScene = useAppStore((s) => s.removeRuleFromScene);
  const deleteScene = useAppStore((s) => s.deleteScene);
  const addToast = useAppStore((s) => s.addToast);
  

  const [leftTab, setLeftTab] = useState<'skills' | 'rules'>('skills');
  const [leftSearch, setLeftSearch] = useState('');
  const [showCreateScene, setShowCreateScene] = useState(false);
  const [newSceneName, setNewSceneName] = useState('');
  const [newSceneDesc, setNewSceneDesc] = useState('');
  const [sceneName, setSceneName] = useState('');
  const [sceneDesc, setSceneDesc] = useState('');
  const [sceneTagFilter, setSceneTagFilter] = useState<number[]>([]);
  const [sceneTags, setSceneTags] = useState<import('../types').Tag[]>([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    fetchScenes();
    fetchSkills();
    fetchRules();
  }, [fetchScenes, fetchSkills, fetchRules]);

  // Auto-select first scene when currentScene is null on mount
  useEffect(() => {
    if (!currentScene && scenes.length > 0) {
      setCurrentScene(scenes[0]);
    }
  }, [scenes, currentScene, setCurrentScene]);

  // Fetch tags for current tab and clear filter on tab switch
  useEffect(() => {
    const loadTags = async () => {
      const tagType = leftTab === 'skills' ? 'skill' : 'rule';
      const result = await ipc.listTags(undefined, tagType);
      setSceneTags(result);
    };
    setSceneTagFilter([]);
    loadTags();
  }, [leftTab]);

  

  useEffect(() => {
    if (currentScene) {
      fetchSceneDetail(currentScene.id);
      setSceneName(currentScene.name);
      setSceneDesc(currentScene.description || '');
      // Platform selection removed — platforms chosen at distribution entry
    }
  }, [currentScene, fetchSceneDetail]);

  const availableSkills = useMemo(() => {
    const sceneSkillIds = new Set(
      currentSceneDetail?.skills.map((s) => s.skill_id) || []
    );
    let filtered = skills.filter((s) => !sceneSkillIds.has(s.id));
    if (leftSearch) {
      const q = leftSearch.toLowerCase();
      filtered = filtered.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.description || '').toLowerCase().includes(q)
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
    const sceneRuleIds = new Set(
      currentSceneDetail?.rules.map((r) => r.rule_id) || []
    );
    let filtered = rules.filter((r) => !sceneRuleIds.has(r.id));
    if (leftSearch) {
      const q = leftSearch.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          (r.description || '').toLowerCase().includes(q)
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

  const handleAddSkill = useCallback(
    async (skillId: string) => {
      if (!currentScene) return;
      await addSkillToScene(currentScene.id, skillId);
    },
    [currentScene, addSkillToScene]
  );

  const handleRemoveSkill = useCallback(
    async (skillId: string) => {
      if (!currentScene) return;
      await removeSkillFromScene(currentScene.id, skillId);
    },
    [currentScene, removeSkillFromScene]
  );

  const handleToggleSkill = useCallback(
    (skillId: string) => {
      // Toggle would need a backend call; for now update local state
      if (!currentSceneDetail) return;
      const updatedSkills = currentSceneDetail.skills.map((s) =>
        s.skill_id === skillId ? { ...s, enabled: !s.enabled } : s
      );
      useAppStore.setState({
        currentSceneDetail: { ...currentSceneDetail, skills: updatedSkills },
      });
    },
    [currentSceneDetail]
  );

  const handleRemoveRule = useCallback(
    async (ruleId: string) => {
      if (!currentScene) return;
      await removeRuleFromScene(currentScene.id, ruleId);
    },
    [currentScene, removeRuleFromScene]
  );

  const handleToggleRule = useCallback(
    (ruleId: string) => {
      if (!currentSceneDetail) return;
      const updatedRules = currentSceneDetail.rules.map((r) =>
        r.rule_id === ruleId ? { ...r, enabled: !r.enabled } : r
      );
      useAppStore.setState({
        currentSceneDetail: { ...currentSceneDetail, rules: updatedRules },
      });
    },
    [currentSceneDetail]
  );

  const handleSaveScene = useCallback(async () => {
    if (!currentScene) return;
    await updateScene(currentScene.id, {
      name: sceneName,
      description: sceneDesc,
    });
  }, [currentScene, sceneName, sceneDesc, updateScene]);

  const executeDeleteScene = useCallback(async () => {
    if (!currentScene) return;
    try {
      await deleteScene(currentScene.id);
      setCurrentScene(scenes[0] || null);
      fetchScenes();
    } catch (e: unknown) {
      addToast(e?.toString?.() || tc('messages.deleteSceneFailed'), 'error');
    }
    setShowDeleteConfirm(false);
  }, [
    currentScene,
    deleteScene,
    scenes,
    setCurrentScene,
    fetchScenes,
    addToast,
    tc,
  ]);

  const handleCreateScene = useCallback(async () => {
    if (!newSceneName.trim()) return;
    await createScene({
      name: newSceneName.trim(),
      description: newSceneDesc.trim(),
    });
    setShowCreateScene(false);
    setNewSceneName('');
    setNewSceneDesc('');
  }, [newSceneName, newSceneDesc, createScene]);

  

  return (
    <div className="flex h-full flex-col">
      {/* Top Bar — 5 fixed button positions */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Film className="h-5 w-5 text-primary" />
        <select
          value={currentScene?.id || ''}
          onChange={(e) => {
            const scene = scenes.find((s) => s.id === e.target.value);
            setCurrentScene(scene || null);
          }}
          className="rounded-lg border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {scenes.map((scene) => (
            <option key={scene.id} value={scene.id}>
              {scene.name}
            </option>
          ))}
        </select>

        {/* 1. 新建场景 — always enabled */}
        <button
          className={cn(
            'flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5',
            'text-sm font-medium text-primary-foreground hover:bg-primary/90'
          )}
          onClick={() => setShowCreateScene(true)}
        >
          <Plus className="h-4 w-4" />
          {t('createScene')}
        </button>

        <div className="flex-1" />

        {/* 3. 保存场景 */}
        {currentScene && (
          <button
            className="flex items-center gap-1 rounded-lg bg-secondary px-3 py-1.5 text-sm text-secondary-foreground transition-colors hover:bg-secondary/80"
            onClick={handleSaveScene}
          >
            <Save className="h-4 w-4" />
            {t('saveScene')}
          </button>
        )}

        {/* 5. 删除 */}
        {currentScene && (
          <button
            className="flex items-center gap-1 rounded-lg border border-error/30 px-2 py-1.5 text-sm text-error transition-colors hover:bg-error/10"
            onClick={() => setShowDeleteConfirm(true)}
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
                  placeholder={t('searchPlaceholder', { ns: 'skills' })}
                  className={cn(
                    'w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-3 text-sm',
                    'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'
                  )}
                />
              </div>
              <div className="mt-2 flex rounded-lg bg-muted p-0.5">
                <button
                  className={cn(
                    'flex-1 rounded-md px-3 py-1 text-xs font-medium transition-colors',
                    leftTab === 'skills'
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  onClick={() => setLeftTab('skills')}
                >
                  <Package className="mr-1 inline h-3 w-3" />
                  {t('skillTab')}
                </button>
                <button
                  className={cn(
                    'flex-1 rounded-md px-3 py-1 text-xs font-medium transition-colors',
                    leftTab === 'rules'
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  onClick={() => setLeftTab('rules')}
                >
                  <FileText className="mr-1 inline h-3 w-3" />
                  {t('ruleTab')}
                </button>
              </div>
              {/* Tag filter bar */}
              <div className="mt-2">
                <TagFilterBar
                  tags={sceneTags}
                  selectedTagIds={sceneTagFilter}
                  onToggleTag={(tagId) =>
                    setSceneTagFilter(
                      sceneTagFilter.includes(tagId)
                        ? sceneTagFilter.filter((id) => id !== tagId)
                        : [...sceneTagFilter, tagId]
                    )
                  }
                  onClearAll={() => setSceneTagFilter([])}
                  showUntagged={false}
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {leftTab === 'skills' ? (
                <div className="space-y-1">
                  {availableSkills.map((skill) => (
                    <div
                      key={skill.id}
                      className="w-full rounded-lg border border-border bg-card p-2 hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="min-w-0 flex-1">
                          <span className="text-sm font-medium text-foreground truncate block">
                            {skill.name}
                          </span>
                          <p className="mt-0.5 text-xs text-muted-foreground truncate">
                            {skill.description}
                          </p>
                        </div>
                        <button
                          className="shrink-0 ml-2 text-primary hover:text-primary/80 transition-colors"
                          onClick={() => handleAddSkill(skill.id)}
                          title={t('addSkill')}
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                  {availableSkills.length === 0 && (
                    <p className="py-4 text-center text-xs text-muted-foreground">
                      {tc('messages.noData')}
                    </p>
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
                          <span className="text-sm font-medium text-foreground truncate block">
                            {rule.name}
                          </span>
                          <p className="mt-0.5 text-xs text-muted-foreground truncate">
                            .{rule.format}
                          </p>
                        </div>
                        <button
                          className="shrink-0 ml-2 text-primary hover:text-primary/80 transition-colors"
                          onClick={() => {
                            if (currentScene)
                              addRuleToScene(currentScene.id, rule.id);
                          }}
                          title={t('addRule')}
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                  {availableRules.length === 0 && (
                    <p className="py-4 text-center text-xs text-muted-foreground">
                      {tc('messages.noData')}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right Panel: Scene Canvas */}
          <div className="flex-1 flex flex-col overflow-y-auto p-4">
            {/* Scene Header */}
            <div className="mb-4">
              <input
                type="text"
                value={sceneName}
                onChange={(e) => setSceneName(e.target.value)}
                className="w-full bg-transparent text-xl font-semibold text-foreground focus:outline-none"
                placeholder={t('create.namePlaceholder')}
              />
              <input
                type="text"
                value={sceneDesc}
                onChange={(e) => setSceneDesc(e.target.value)}
                className="w-full mt-1 bg-transparent text-sm text-muted-foreground focus:outline-none"
                placeholder={t('create.descriptionPlaceholder')}
              />
            </div>

            {/* Skills Section */}
            <div className="mb-6">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                <Package className="h-4 w-4 text-primary" />
                {t('sceneSkills')}
                <span className="text-xs font-normal text-muted-foreground">
                  ({currentSceneDetail?.skills.length || 0})
                </span>
              </h3>
              <SortableSkillList
                skills={currentSceneDetail?.skills || []}
                onRemove={handleRemoveSkill}
                onToggle={handleToggleSkill}
                disabled={false}
              />
            </div>

            {/* Rules Section */}
            <div className="mb-6">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                <FileText className="h-4 w-4 text-success" />
                {t('sceneRules')}
                <span className="text-xs font-normal text-muted-foreground">
                  ({currentSceneDetail?.rules.length || 0})
                </span>
              </h3>
              <SortableRuleList
                rules={currentSceneDetail?.rules || []}
                onRemove={handleRemoveRule}
                onToggle={handleToggleRule}
                disabled={false}
              />
            </div>

            {/* Platform selection removed — platforms chosen at distribution entry */}
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <Film className="mx-auto mb-3 h-12 w-12 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">{t('noScene')}</p>
          </div>
        </div>
      )}

      {/* Create Scene Dialog */}
      {showCreateScene && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50">
          <div className="w-[400px] rounded-lg border border-border bg-card p-6 shadow-xl animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">
                {t('create.title')}
              </h2>
              <button
                onClick={() => setShowCreateScene(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  {t('sceneName')}
                </label>
                <input
                  type="text"
                  value={newSceneName}
                  onChange={(e) => setNewSceneName(e.target.value)}
                  placeholder={t('create.namePlaceholder')}
                  autoFocus
                  className={cn(
                    'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm',
                    'focus:outline-none focus:ring-2 focus:ring-ring'
                  )}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  {t('sceneDescription')}
                </label>
                <textarea
                  value={newSceneDesc}
                  onChange={(e) => setNewSceneDesc(e.target.value)}
                  placeholder={t('create.descriptionPlaceholder')}
                  rows={3}
                  className={cn(
                    'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none',
                    'focus:outline-none focus:ring-2 focus:ring-ring'
                  )}
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
                  onClick={() => setShowCreateScene(false)}
                >
                  {tc('actions.cancel')}
                </button>
                <button
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                  onClick={handleCreateScene}
                >
                  {tc('actions.create')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={showDeleteConfirm}
        title={tc('messages.confirmDelete')}
        message={tc('messages.confirmDeleteScene', {
          name: currentScene?.name || '',
        })}
        variant="danger"
        confirmLabel={tc('actions.delete')}
        onConfirm={executeDeleteScene}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  );
}

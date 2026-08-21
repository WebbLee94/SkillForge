import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn, formatDate } from '../lib/utils';
import {
  Film,
  List,
  Package,
  FileText,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { ipc } from '../lib/ipc';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import {
  SceneEditorDrawer,
  type SceneDraft,
} from '../components/common/SceneEditorDrawer';
import type { SceneDetail, Tag } from '../types';

type ListState = 'loading' | 'ready' | 'error';
type ListSort = 'recent' | 'name';

export function SceneEditor() {
  const { t } = useTranslation('scenes');
  const { t: tc } = useTranslation('common');

  const scenes = useAppStore((s) => s.scenes);
  const skills = useAppStore((s) => s.skills);
  const rules = useAppStore((s) => s.rules);
  const currentScene = useAppStore((s) => s.currentScene);
  const currentSceneDetail = useAppStore((s) => s.currentSceneDetail);
  const setCurrentScene = useAppStore((s) => s.setCurrentScene);
  const fetchSceneDetail = useAppStore((s) => s.fetchSceneDetail);
  const createScene = useAppStore((s) => s.createScene);
  const deleteScene = useAppStore((s) => s.deleteScene);
  const saveSceneComposition = useAppStore((s) => s.saveSceneComposition);
  const setPendingDistributionSelection = useAppStore(
    (s) => s.setPendingDistributionSelection
  );
  const setActiveNav = useAppStore((s) => s.setActiveNav);

  const [listState, setListState] = useState<ListState>('loading');
  const [listSearch, setListSearch] = useState('');
  const [listSort, setListSort] = useState<ListSort>('recent');
  const [tags, setTags] = useState<Tag[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showCreateScene, setShowCreateScene] = useState(false);
  const [newSceneName, setNewSceneName] = useState('');
  const [newSceneDesc, setNewSceneDesc] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showInvalidRefDialog, setShowInvalidRefDialog] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const invalidRefDialogRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    setListState('loading');
    try {
      const [sceneList, skillList, ruleList, skillTags, ruleTags] =
        await Promise.all([
          ipc.listScenes(),
          ipc.listSkills(),
          ipc.listRules(),
          ipc.listTags(undefined, 'skill'),
          ipc.listTags(undefined, 'rule'),
        ]);
      useAppStore.setState({
        scenes: sceneList,
        skills: skillList,
        rules: ruleList,
      });
      setTags([...skillTags, ...ruleTags]);
      setListState('ready');
    } catch {
      setListState('error');
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (listState === 'ready' && !currentScene && scenes.length > 0) {
      setCurrentScene(scenes[0]);
    }
  }, [listState, currentScene, scenes, setCurrentScene]);

  useEffect(() => {
    if (currentScene) {
      fetchSceneDetail(currentScene.id);
    }
  }, [currentScene, fetchSceneDetail]);

  useEffect(() => {
    if (!showInvalidRefDialog) return;
    invalidRefDialogRef.current?.focus();
  }, [showInvalidRefDialog]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showInvalidRefDialog) setShowInvalidRefDialog(false);
      else if (showCreateScene) setShowCreateScene(false);
      else if (showDeleteConfirm) setShowDeleteConfirm(false);
      else if (listOpen) setListOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showInvalidRefDialog, showCreateScene, showDeleteConfirm, listOpen]);

  const sortedScenes = useMemo(() => {
    const q = listSearch.toLowerCase();
    const filtered = scenes.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.description || '').toLowerCase().includes(q)
    );
    return [...filtered].sort((a, b) =>
      listSort === 'name'
        ? a.name.localeCompare(b.name)
        : b.updated_at.localeCompare(a.updated_at)
    );
  }, [scenes, listSearch, listSort]);

  const invalidSkills = useMemo(
    () => (currentSceneDetail?.skills ?? []).filter((s) => !s.skill_name),
    [currentSceneDetail]
  );
  const invalidRules = useMemo(
    () => (currentSceneDetail?.rules ?? []).filter((r) => !r.rule_name),
    [currentSceneDetail]
  );
  const hasInvalidRefs = invalidSkills.length > 0 || invalidRules.length > 0;

  const skillCount = currentSceneDetail?.skills.length ?? 0;
  const ruleCount = currentSceneDetail?.rules.length ?? 0;

  const carryToDistribution = useCallback(
    (detail: SceneDetail) => {
      const skillIds = detail.skills
        .filter((s) => s.enabled && s.skill_name)
        .map((s) => s.skill_id);
      const ruleIds = detail.rules
        .filter((r) => r.enabled && r.rule_name)
        .map((r) => r.rule_id);
      setPendingDistributionSelection({
        skillIds,
        ruleIds,
        sceneId: detail.scene.id,
      });
      setActiveNav('globalDistribution');
    },
    [setPendingDistributionSelection, setActiveNav]
  );

  const handleUseForDistribution = useCallback(() => {
    if (!currentSceneDetail) return;
    if (hasInvalidRefs) {
      setShowInvalidRefDialog(true);
      return;
    }
    carryToDistribution(currentSceneDetail);
  }, [currentSceneDetail, hasInvalidRefs, carryToDistribution]);

  const handleDrawerSave = useCallback(
    async (draft: SceneDraft) => {
      if (!currentScene) return false;
      const ok = await saveSceneComposition(currentScene.id, draft);
      if (ok) await fetchSceneDetail(currentScene.id);
      return ok;
    },
    [currentScene, saveSceneComposition, fetchSceneDetail]
  );

  const executeDelete = useCallback(async () => {
    if (!currentScene) return;
    await deleteScene(currentScene.id);
    setShowDeleteConfirm(false);
  }, [currentScene, deleteScene]);

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
    <div
      className="flex h-full flex-col overflow-y-auto"
      data-testid="scene-page-content"
    >
      {/* 页面壳层标题（决策 3）：统一 page-toolbar / page-title */}
      <div className="page-toolbar flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="page-title mb-1 text-foreground">{tc('nav.scenes')}</h1>
          <p className="text-xs text-muted-foreground">
            提供针对资源的可复用组合编排能力
          </p>
        </div>
        <button
          className="flex shrink-0 items-center gap-1 rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          onClick={() => setShowCreateScene(true)}
        >
          <Plus className="h-4 w-4" />
          {t('createScene')}
        </button>
      </div>

      {listState === 'loading' && (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">{t('loading')}</p>
        </div>
      )}

      {listState === 'error' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <p className="text-sm text-muted-foreground" role="alert">
            {t('loadFailed')}
          </p>
          <button
            className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
            onClick={reload}
          >
            {t('retry')}
          </button>
        </div>
      )}

      {listState === 'ready' && scenes.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <Film className="h-12 w-12 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
          <button
            className="flex items-center gap-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            onClick={() => setShowCreateScene(true)}
          >
            <Plus className="h-4 w-4" />
            {t('createScene')}
          </button>
        </div>
      )}

      {listState === 'ready' && scenes.length > 0 && (
        <div className="flex min-h-0 flex-1">
          {/* Master list — fixed 280px on wide, Drawer on narrow */}
          <div
            className={cn(
              'bg-background',
              listOpen
                ? 'fixed inset-y-0 left-0 z-40 flex w-[280px] flex-col border-r border-border'
                : 'hidden w-[280px] shrink-0 flex-col border-r border-border md:flex'
            )}
          >
            <div className="border-b border-border mb-3 mt-5 px-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={listSearch}
                  onChange={(e) => setListSearch(e.target.value)}
                  placeholder={t('list.searchPlaceholder')}
                  className="w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="mt-3 mb-3 flex items-center justify-end gap-2">
                <label className="text-xs text-muted-foreground">
                  {t('list.sortLabel')}
                </label>
                <select
                  value={listSort}
                  onChange={(e) => setListSort(e.target.value as ListSort)}
                  className="rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="recent">{t('list.sortRecent')}</option>
                  <option value="name">{t('list.sortName')}</option>
                </select>
              </div>
            </div>
            <div
              className="min-h-0 flex-1 space-y-1 overflow-y-auto mt-1 mb-1 px-2"
              data-testid="scene-list"
            >
              {sortedScenes.length === 0 && (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  {tc('messages.noData')}
                </p>
              )}
              {sortedScenes.map((scene) => (
                <button
                  key={scene.id}
                  data-testid="scene-list-item"
                  onClick={() => {
                    setCurrentScene(scene);
                    setListOpen(false);
                  }}
                  className={cn(
                    'w-full rounded-lg border px-3 py-2 text-left transition-colors',
                    currentScene?.id === scene.id
                      ? 'border-primary bg-accent/40'
                      : 'border-border bg-card hover:bg-accent/40'
                  )}
                >
                  <span
                    className="block truncate text-sm font-medium text-foreground"
                    title={scene.name}
                  >
                    {scene.name}
                  </span>
                  <span className="line-clamp-2 block text-xs text-muted-foreground">
                    {scene.description}
                  </span>
                </button>
              ))}
            </div>
          </div>
          {listOpen && (
            <div
              data-testid="list-backdrop"
              className="fixed inset-0 z-30 bg-black/50 md:hidden"
              onClick={() => setListOpen(false)}
            />
          )}

          {/* Detail pane */}
          <div
            className="min-w-0 flex-1 overflow-y-auto p-3"
            data-testid="scene-detail"
          >
            <button
              data-testid="list-toggle"
              className="mb-3 flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-accent/40 md:hidden"
              onClick={() => setListOpen(true)}
            >
              <List className="h-4 w-4" />
              {t('list.drawerOpen')}
            </button>

            {!currentSceneDetail ? (
              <p className="text-sm text-muted-foreground">{t('loading')}</p>
            ) : (
              <>
                <h2 className="text-lg font-semibold text-foreground">
                  {currentSceneDetail.scene.name}
                </h2>
                <p
                  className="mt-1 text-sm text-muted-foreground"
                  data-testid="scene-updated-at"
                >
                  {currentSceneDetail.scene.description
                    ? `${currentSceneDetail.scene.description} · `
                    : ''}
                  {t('detail.updatedAt', {
                    time: formatDate(currentSceneDetail.scene.updated_at),
                  })}
                </p>
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="scene-read-only"
                >
                  {t('detail.readOnly')}
                </p>

                {hasInvalidRefs && (
                  <div
                    role="alert"
                    className="mt-4 rounded-lg border border-error/30 bg-error/5 p-3"
                    data-testid="invalid-refs"
                  >
                    <p className="text-sm font-medium text-error">
                      {t('detail.invalidRefsTitle')}
                    </p>
                    <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
                      {invalidSkills.map((s) => (
                        <li key={`sk-${s.skill_id}`}>
                          {t('detail.invalidSkill', { id: s.skill_id })}
                        </li>
                      ))}
                      {invalidRules.map((r) => (
                        <li key={`rl-${r.rule_id}`}>
                          {t('detail.invalidRule', { id: r.rule_id })}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div
                  className="mt-4 flex flex-row flex-wrap items-center gap-2"
                  data-testid="scene-actions"
                >
                  <button
                    className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                    onClick={handleUseForDistribution}
                  >
                    <Film className="h-4 w-4" />
                    {t('detail.useForDistribution')}
                  </button>
                  <button
                    className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-accent/40"
                    onClick={() => setDrawerOpen(true)}
                  >
                    <Package className="h-4 w-4" />
                    {t('detail.configure')}
                  </button>
                  <button
                    className="flex items-center gap-1 rounded-lg border border-error/30 px-2 py-1.5 text-sm text-error transition-colors hover:bg-error/10"
                    onClick={() => setShowDeleteConfirm(true)}
                  >
                    <Trash2 className="h-4 w-4" />
                    {t('detail.delete')}
                  </button>
                </div>

                <h3 className="mb-2 mt-6 flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Package className="h-4 w-4 text-primary" />
                  {t('sceneSkills')}
                  <span className="text-xs font-normal text-muted-foreground">
                    ({skillCount})
                  </span>
                </h3>
                <div className="mb-4 space-y-1">
                  {skillCount === 0 && (
                    <p className="py-2 text-center text-xs text-muted-foreground">
                      {t('detail.noSkills')}
                    </p>
                  )}
                  {currentSceneDetail.skills.map((skill) => (
                    <div
                      key={skill.skill_id}
                      className={cn(
                        'flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2',
                        !skill.skill_name && 'opacity-60'
                      )}
                    >
                      <Package className="h-4 w-4 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                        {skill.skill_name || `${skill.skill_id}（已删除）`}
                      </span>
                      <span
                        className={cn(
                          'shrink-0 text-xs',
                          skill.enabled
                            ? 'text-success'
                            : 'text-muted-foreground'
                        )}
                      >
                        {skill.enabled
                          ? t('detail.memberEnabled')
                          : t('detail.memberDisabled')}
                      </span>
                    </div>
                  ))}
                </div>

                <h3 className="mb-2 mt-6 flex items-center gap-2 text-sm font-semibold text-foreground">
                  <FileText className="h-4 w-4 text-success" />
                  {t('sceneRules')}
                  <span className="text-xs font-normal text-muted-foreground">
                    ({ruleCount})
                  </span>
                </h3>
                <div className="mb-4 space-y-1">
                  {ruleCount === 0 && (
                    <p className="py-2 text-center text-xs text-muted-foreground">
                      {t('detail.noRules')}
                    </p>
                  )}
                  {currentSceneDetail.rules.map((rule) => (
                    <div
                      key={rule.rule_id}
                      className={cn(
                        'flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2',
                        !rule.rule_name && 'opacity-60'
                      )}
                    >
                      <FileText className="h-4 w-4 shrink-0 text-success" />
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                        {rule.rule_name || `${rule.rule_id}（已删除）`}
                      </span>
                      <span
                        className={cn(
                          'shrink-0 text-xs',
                          rule.enabled
                            ? 'text-success'
                            : 'text-muted-foreground'
                        )}
                      >
                        {rule.enabled
                          ? t('detail.memberEnabled')
                          : t('detail.memberDisabled')}
                      </span>
                    </div>
                  ))}
                </div>

                <p
                  className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground"
                  data-testid="scene-save-note"
                >
                  {t('detail.saveScopeNote')}
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Configuration drawer */}
      {drawerOpen && currentSceneDetail && (
        <SceneEditorDrawer
          key={currentSceneDetail.scene.id}
          saved={currentSceneDetail}
          skills={skills}
          rules={rules}
          tags={tags}
          onSave={handleDrawerSave}
          onClose={() => setDrawerOpen(false)}
        />
      )}

      {/* Invalid-reference gate dialog */}
      {showInvalidRefDialog && currentSceneDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div
            ref={invalidRefDialogRef}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            className="w-[420px] rounded-lg border border-border bg-card p-6 shadow-xl animate-fade-in"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">
                {t('detail.invalidRefsTitle')}
              </h2>
              <button
                onClick={() => setShowInvalidRefDialog(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {t('detail.invalidRefsHint')}
            </p>
            <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-muted-foreground">
              {invalidSkills.map((s) => (
                <li key={`sk-${s.skill_id}`}>
                  {t('detail.invalidSkill', { id: s.skill_id })}
                </li>
              ))}
              {invalidRules.map((r) => (
                <li key={`rl-${r.rule_id}`}>
                  {t('detail.invalidRule', { id: r.rule_id })}
                </li>
              ))}
            </ul>
            <div className="mt-6 flex justify-end gap-2">
              <button
                className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
                onClick={() => {
                  setShowInvalidRefDialog(false);
                  setDrawerOpen(true);
                }}
              >
                {t('detail.invalidRefsCleanup')}
              </button>
              <button
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                onClick={() => {
                  carryToDistribution(currentSceneDetail);
                  setShowInvalidRefDialog(false);
                }}
              >
                {t('detail.invalidRefsUseValid')}
              </button>
              <button
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
                onClick={() => setShowInvalidRefDialog(false)}
              >
                {tc('actions.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        open={showDeleteConfirm}
        title={t('deleteConfirm.title')}
        message={t('deleteConfirm.message', { name: currentScene?.name ?? '' })}
        confirmLabel={t('deleteConfirm.confirm')}
        variant="danger"
        onConfirm={executeDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      >
        <div className="mb-4 space-y-1 text-xs text-muted-foreground">
          <p>
            {t('deleteConfirm.skillLabel')}: {skillCount} ·{' '}
            {t('deleteConfirm.ruleLabel')}: {ruleCount}
          </p>
          <p>{t('deleteConfirm.notAffected')}</p>
        </div>
      </ConfirmDialog>

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
    </div>
  );
}

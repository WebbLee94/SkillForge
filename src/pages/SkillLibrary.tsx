import { useEffect, useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../stores/appStore';
import { ipc } from '../lib/ipc';
import { cn, sanitizePath } from '../lib/utils';
import { SEARCH_INPUT_CLASSES } from '../lib/ui-tokens';
import { TagFilterBar } from '../components/ui/tags/TagFilterBar';
import { TagManagerDialog } from '../domains/tags/TagManagerDialog';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import {
  ResourceViewToggle,
  type ResourceView,
} from '../components/ui/ResourceViewToggle';
import { ResourceCollection } from '../domains/resources/ResourceCollection';
import { BatchActionBar } from '../domains/resources/BatchActionBar';
import { BatchTagDialog } from '../domains/tags/BatchTagDialog';
import { Inspector } from '../domains/inspector/Inspector';
import {
  ResourceImportDialog,
  type ImportItem,
} from '../domains/resources/ResourceImportDialog';
import { useBatchMode } from '../hooks/useBatchMode';
import {
  formatRelativeTime,
  skillDirName,
  validateSkillDirPath,
} from '../lib/resourceLibrary';
import {
  Search,
  Download,
  Package,
  FolderOpen,
  Clock,
  CheckSquare,
  Tags,
  AlertTriangle,
  ChevronsUpDown,
} from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { readDir } from '@tauri-apps/plugin-fs';

async function buildSkillImportItem(
  dirPath: string,
  existingNames: Set<string>
): Promise<ImportItem> {
  const name = skillDirName(dirPath);
  const base = validateSkillDirPath(dirPath, existingNames);
  if (base.status !== 'valid') {
    return {
      key: dirPath,
      name: name || dirPath,
      path: dirPath,
      status: base.status,
      reason: base.reason,
    };
  }
  try {
    const entries = await readDir(dirPath);
    const hasSkillMd = entries.some((e) => e.name === 'SKILL.md');
    return {
      key: dirPath,
      name,
      path: dirPath,
      status: hasSkillMd ? 'valid' : 'skip',
      reason: hasSkillMd ? undefined : 'missingSkillMd',
    };
  } catch {
    return {
      key: dirPath,
      name,
      path: dirPath,
      status: 'error',
      reason: 'readFailed',
    };
  }
}

export function SkillLibrary() {
  const { t } = useTranslation(['skills', 'distribution']);
  const { t: tc } = useTranslation('common');
  const skills = useAppStore((s) => s.skills);
  const tags = useAppStore((s) => s.tags);
  const selectedSkill = useAppStore((s) => s.selectedSkill);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const tagFilter = useAppStore((s) => s.tagFilter);
  const loading = useAppStore((s) => s.loading);
  const fetchSkills = useAppStore((s) => s.fetchSkills);
  const fetchTags = useAppStore((s) => s.fetchTags);
  const selectSkill = useAppStore((s) => s.selectSkill);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const setTagFilter = useAppStore((s) => s.setTagFilter);
  const setActiveNav = useAppStore((s) => s.setActiveNav);
  const setPendingDistributionSelection = useAppStore(
    (s) => s.setPendingDistributionSelection
  );
  const uninstallSkill = useAppStore((s) => s.uninstallSkill);
  const updateSkill = useAppStore((s) => s.updateSkill);
  const assignTag = useAppStore((s) => s.assignTag);
  const removeTagAction = useAppStore((s) => s.removeTag);
  const createTag = useAppStore((s) => s.createTag);

  const [localSearch, setLocalSearch] = useState('');
  const [debounceTimer, setDebounceTimer] = useState<ReturnType<
    typeof setTimeout
  > | null>(null);
  const [untaggedFilter, setUntaggedFilter] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [view, setView] = useState<ResourceView>('group');
  const [collapsedAll, setCollapsedAll] = useState(false);
  const [showTagManager, setShowTagManager] = useState(false);
  const [confirmUninstallId, setConfirmUninstallId] = useState<string | null>(
    null
  );
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);
  const [showBatchTagDialog, setShowBatchTagDialog] = useState(false);
  const [batchRef, setBatchRef] = useState<{
    status: 'idle' | 'loading' | 'loaded' | 'error';
    referenced: number;
    total: number;
  }>({ status: 'idle', referenced: 0, total: 0 });

  // 导入预览（§3.8：多目录选择 + 逐项 valid/skip/error + 结果计数）
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importItems, setImportItems] = useState<ImportItem[]>([]);
  const [importing, setImporting] = useState(false);

  const batch = useBatchMode();

  useEffect(() => {
    let cancelled = false;
    fetchSkills().then((ok) => {
      if (!cancelled) setLoadFailed(!ok);
    });
    fetchTags('skill');
    return () => {
      cancelled = true;
    };
  }, [fetchSkills, fetchTags]);

  const retryLoad = () => {
    setLoadFailed(false);
    fetchSkills().then((ok) => setLoadFailed(!ok));
  };

  const handleSearch = useCallback(
    (value: string) => {
      setLocalSearch(value);
      if (debounceTimer) clearTimeout(debounceTimer);
      const timer = setTimeout(() => setSearchQuery(value), 300);
      setDebounceTimer(timer);
    },
    [debounceTimer, setSearchQuery]
  );

  const filteredSkills = useMemo(() => {
    return skills.filter((skill) => {
      if (
        searchQuery &&
        !skill.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !(skill.description || '')
          .toLowerCase()
          .includes(searchQuery.toLowerCase())
      ) {
        return false;
      }
      if (untaggedFilter) {
        if (skill.tags && skill.tags.length > 0) return false;
      } else if (tagFilter.length > 0) {
        if (!skill.tags || skill.tags.length === 0) return false;
        const skillTagIds = skill.tags.map((tag) => tag.id);
        if (!tagFilter.some((id) => skillTagIds.includes(id))) return false;
      }
      return true;
    });
  }, [skills, searchQuery, tagFilter, untaggedFilter]);

  const toggleTag = (tagId: number) => {
    setTagFilter(
      tagFilter.includes(tagId)
        ? tagFilter.filter((id) => id !== tagId)
        : [...tagFilter, tagId]
    );
  };

  const clearFilters = useCallback(() => {
    setTagFilter([]);
    setUntaggedFilter(false);
  }, [setTagFilter]);

  // === 去分发（§3.4）：携带选中资源进入分发工作区 ===
  const goDistribute = useCallback(
    (skillIds: string[]) => {
      setPendingDistributionSelection({ skillIds, ruleIds: [] });
      setActiveNav('globalDistribution');
      batch.exit();
    },
    [setPendingDistributionSelection, setActiveNav, batch]
  );

  // === 批量删除 ===
  const handleBatchDelete = useCallback(() => {
    if (batch.selectedCount === 0) return;
    setShowBatchDeleteConfirm(true);
    const ids = [...batch.selectedIds];
    setBatchRef({ status: 'loading', referenced: 0, total: 0 });
    Promise.all(ids.map((id) => ipc.countSceneReferences('skill', id)))
      .then((counts) => {
        setBatchRef({
          status: 'loaded',
          referenced: counts.filter((c) => c > 0).length,
          total: counts.reduce((sum, c) => sum + c, 0),
        });
      })
      .catch(() => {
        setBatchRef({ status: 'error', referenced: 0, total: 0 });
      });
  }, [batch.selectedCount, batch.selectedIds]);

  const executeBatchDelete = useCallback(async () => {
    for (const id of batch.selectedIds) {
      await uninstallSkill(id);
    }
    setShowBatchDeleteConfirm(false);
    batch.exit();
  }, [batch, uninstallSkill]);

  // === 批量管理所选标签 ===
  const selectedSkills = useMemo(
    () => skills.filter((s) => batch.selectedIds.has(s.id)),
    [skills, batch.selectedIds]
  );

  const batchTagIntersection = useMemo(() => {
    if (selectedSkills.length === 0) return [];
    const common = new Set<number>();
    selectedSkills.forEach((s, idx) => {
      const ids = (s.tags || []).map((tg) => tg.id);
      if (idx === 0) ids.forEach((id) => common.add(id));
      else {
        const keep = new Set(ids);
        for (const id of common) if (!keep.has(id)) common.delete(id);
      }
    });
    return [...common];
  }, [selectedSkills]);

  const applyBatchTags = useCallback(
    async (added: number[], removed: number[]) => {
      for (const tagId of added) {
        for (const id of batch.selectedIds) await assignTag('skill', id, tagId);
      }
      for (const tagId of removed) {
        for (const id of batch.selectedIds)
          await removeTagAction('skill', id, tagId);
      }
      setShowBatchTagDialog(false);
      batch.exit();
      await fetchSkills();
      await fetchTags('skill');
    },
    [batch, assignTag, removeTagAction, fetchSkills, fetchTags]
  );

  // === 详情面板标签保存 ===
  const saveSkillTags = useCallback(
    async (skillId: string, added: number[], removed: number[]) => {
      for (const tagId of added) await assignTag('skill', skillId, tagId);
      for (const tagId of removed)
        await removeTagAction('skill', skillId, tagId);
      await fetchSkills();
      const fresh = useAppStore.getState().skills.find((s) => s.id === skillId);
      if (fresh) selectSkill(fresh);
    },
    [assignTag, removeTagAction, fetchSkills, selectSkill]
  );

  // === 导入预览（技能目录） ===
  const pickSkillDirs = useCallback(async () => {
    try {
      const selected = await open({ directory: true, multiple: true });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      const existingNames = new Set(
        skills
          .map((s) => skillDirName(s.local_path))
          .filter((n): n is string => Boolean(n))
      );
      const built = await Promise.all(
        paths.map((p) => buildSkillImportItem(p, existingNames))
      );
      setImportItems((prev) => {
        const seen = new Set(prev.map((i) => i.key));
        return [...prev, ...built.filter((i) => !seen.has(i.key))];
      });
    } catch {
      /* 用户取消选择 */
    }
  }, [skills]);

  const executeImport = useCallback(async () => {
    if (importing) return;
    setImporting(true);
    const next = [...importItems];
    for (const item of next) {
      if (item.status === 'skip') {
        if (!item.result) item.result = 'skipped';
        continue;
      }
      if (item.status === 'error') {
        if (!item.result) item.result = 'failed';
        continue;
      }
      if (item.result) continue;
      try {
        await ipc.installSkill('local-fs', item.path);
        item.result = 'success';
      } catch {
        item.result = 'failed';
      }
    }
    setImportItems(next);
    setImporting(false);
    await fetchSkills();
  }, [importing, importItems, fetchSkills]);

  const retryImportItem = useCallback(
    async (key: string) => {
      if (importing) return;
      const item = importItems.find((i) => i.key === key);
      if (!item) return;
      if (item.result === 'failed') {
        setImporting(true);
        const next = [...importItems];
        const target = next.find((i) => i.key === key)!;
        try {
          await ipc.installSkill('local-fs', target.path);
          target.result = 'success';
        } catch {
          target.result = 'failed';
        }
        setImportItems(next);
        setImporting(false);
        await fetchSkills();
      } else {
        const existingNames = new Set(
          skills
            .map((s) => skillDirName(s.local_path))
            .filter((n): n is string => Boolean(n))
        );
        const rebuilt = await buildSkillImportItem(item.path, existingNames);
        setImportItems((prev) =>
          prev.map((i) =>
            i.key === key ? { ...rebuilt, result: undefined } : i
          )
        );
      }
    },
    [importing, importItems, skills, fetchSkills]
  );

  const removeImportItem = useCallback((key: string) => {
    setImportItems((prev) => prev.filter((i) => i.key !== key));
  }, []);

  const openImportDialog = useCallback(() => {
    setImportItems([]);
    setShowImportDialog(true);
  }, []);

  // === 卡片/行渲染 ===
  const renderGroupCard = useCallback(
    (skill: (typeof skills)[number]) => (
      <>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold text-foreground">
              {skill.name}
            </h3>
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {skill.description || ''}
            </p>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {formatRelativeTime(skill.installed_at)}
          </span>
          {skill.current_ver && (
            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
              v{skill.current_ver}
            </span>
          )}
        </div>
      </>
    ),
    []
  );

  const renderListRow = useCallback(
    (skill: (typeof skills)[number]) => (
      <>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold text-foreground">
              {skill.name}
            </h3>
            <p className="truncate text-xs text-muted-foreground">
              {skill.description || ''}
            </p>
          </div>
          {skill.tags && skill.tags.length > 0 && (
            <div className="flex shrink-0 flex-wrap items-center gap-1">
              {skill.tags.map((tag) => (
                <span
                  key={tag.id}
                  className="rounded-full px-2 py-0.5 text-xs font-medium"
                  style={
                    tag.color
                      ? { backgroundColor: tag.color + '20', color: tag.color }
                      : undefined
                  }
                >
                  {tag.name}
                </span>
              ))}
            </div>
          )}
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatRelativeTime(skill.installed_at)}
        </span>
      </>
    ),
    []
  );

  const parseMetadata = (
    meta: string | null | undefined
  ): Record<string, unknown> => {
    if (!meta) return {};
    try {
      return JSON.parse(meta);
    } catch {
      return {};
    }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* 页头行（决策 7 布局部分推翻，保留视觉令牌）：标题 + 副标题 + 右侧 导入(primary) → 管理标签(outline) */}
      <div className="shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="page-title">{t('title')}</h1>
            <p className="text-xs text-muted-foreground">
              {t('subtitle')}
            </p>
          </div>
          <div
            className="flex shrink-0 items-center gap-3"
            data-testid="lib-page-actions"
          >
            <button
              className={cn(
                'shrink-0 flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5',
                'text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors'
              )}
              onClick={openImportDialog}
            >
              <Download className="h-4 w-4" />
              {tc('actions.import')}
            </button>
            <button
              className={cn(
                'shrink-0 flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5',
                'text-xs font-medium text-foreground hover:bg-accent transition-colors'
              )}
              onClick={() => setShowTagManager(true)}
            >
              <Tags className="h-3.5 w-3.5" />
              {tc('tag.manageTags')}
            </button>
          </div>
        </div>
      </div>

      {/* 工具栏（决策 7 布局部分推翻）：左侧搜索 icon+input ~220px、placeholder 全角 …；右侧 计数 → 视图切换 seg → 批量 */}
      <div className="shrink-0">
        <div className="flex items-center justify-between gap-3 mb-2 mt-2">
          <div className="relative w-[220px] shrink-0">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={localSearch}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className={SEARCH_INPUT_CLASSES}
            />
          </div>
          <div
            className="flex shrink-0 items-center gap-3"
            data-testid="lib-toolbar-actions"
          >
            <span
              data-testid="lib-toolbar-count"
              className="text-xs text-muted-foreground"
            >
              {t('count', { count: skills.length })}
            </span>
            <ResourceViewToggle
              view={view}
              onChange={setView}
              groupLabel={tc('view.group')}
              listLabel={tc('view.list')}
            />
            <button
              className={cn(
                'shrink-0 flex items-center gap-2 rounded-lg border border-border px-3 py-1.5',
                'text-sm font-medium text-foreground hover:bg-accent transition-colors',
                batch.enabled && 'bg-primary/10 border-primary/30',
                loading && 'pointer-events-none opacity-50'
              )}
              onClick={batch.toggle}
              disabled={loading}
            >
              <CheckSquare className="h-4 w-4" />
              {batch.enabled
                ? tc('actions.exitSelect')
                : tc('actions.batchSelect')}
            </button>
          </div>
        </div>
      </div>

      {/* 筛选行（决策 7）：标签 chips + 右侧 全部展开/收起 */}
      <div className="shrink-0">
        <div className="flex items-center gap-3 mb-2 mt-2"
          data-testid="lib-filters"
        >
          <div className="min-w-0 flex-1">
            <TagFilterBar
              tags={tags}
              selectedTagIds={tagFilter}
              onToggleTag={toggleTag}
              onClearAll={clearFilters}
              showUntagged
              untaggedFilter={untaggedFilter}
              onToggleUntagged={() => setUntaggedFilter(!untaggedFilter)}
            />
          </div>
          <button
            aria-label={collapsedAll ? '展开分组' : '收起分组'}
            className="shrink-0 flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            onClick={() => setCollapsedAll((prev) => !prev)}
          >
            <ChevronsUpDown className="h-3.5 w-3.5" />
            {collapsedAll ? '展开分组' : '收起分组'}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-y-auto mb-2 mt-2" data-testid="lib-content">
          {loading ? (
            <div
              className="grid gap-3"
              style={{
                gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
              }}
            >
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="animate-pulse rounded-lg border border-border bg-card p-4"
                >
                  <div className="h-4 w-32 rounded bg-muted" />
                  <div className="mt-2 h-3 w-full rounded bg-muted" />
                  <div className="mt-1 h-3 w-3/4 rounded bg-muted" />
                </div>
              ))}
            </div>
          ) : loadFailed ? (
            <div className="flex flex-col items-center justify-center py-16">
              <AlertTriangle className="mb-3 h-12 w-12 text-muted-foreground/30" />
              <p className="mb-1 text-sm font-medium text-muted-foreground">
                {tc('messages.loadSkillsFailed')}
              </p>
              <button
                className="mt-2 text-sm text-primary hover:underline"
                onClick={retryLoad}
              >
                {tc('actions.retry')}
              </button>
            </div>
          ) : skills.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Package className="mb-3 h-12 w-12 text-muted-foreground/30" />
              <p className="mb-1 text-sm font-medium text-muted-foreground">
                {t('empty')}
              </p>
              <button
                className="mt-2 text-sm text-primary hover:underline"
                onClick={openImportDialog}
              >
                {tc('actions.import')}
              </button>
            </div>
          ) : filteredSkills.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Package className="mb-3 h-12 w-12 text-muted-foreground/30" />
              <p className="mb-1 text-sm font-medium text-muted-foreground">
                {tc('messages.noResults')}
              </p>
              <button
                className="mt-2 text-sm text-primary hover:underline"
                onClick={clearFilters}
              >
                {tc('messages.clearFilter')}
              </button>
            </div>
          ) : (
            <ResourceCollection
              items={filteredSkills}
              tags={tags}
              view={view}
              batchMode={batch.enabled}
              selectedIds={batch.selectedIds}
              untaggedLabel={tc('tag.untagged')}
              showMoreLabel={tc('view.showMore')}
              collapsedAll={collapsedAll}
              onToggleSelect={batch.toggleSelect}
              onOpenDetail={selectSkill}
              renderItem={(skill) =>
                view === 'group' ? renderGroupCard(skill) : renderListRow(skill)
              }
            />
          )}

          <BatchActionBar
            enabled={batch.enabled}
            selectedCount={batch.selectedCount}
            selectedLabel={tc('messages.selectedCount', {
              count: batch.selectedCount,
            })}
            guideLabel={tc('batch.guide')}
            exitLabel={tc('batch.exit')}
            manageTagsLabel={tc('batch.manageTags')}
            goDistributeLabel={tc('batch.goDistribute')}
            deleteLabel={tc('batch.delete')}
            clearLabel={tc('batch.clear')}
            onExit={batch.exit}
            onGoDistribute={() => goDistribute([...batch.selectedIds])}
            onManageTags={() => setShowBatchTagDialog(true)}
            onDelete={handleBatchDelete}
            onClear={batch.clear}
          />
        </div>

        {/* Inspector（§3.2/§3.5：完整时间戳、来源仅技能、标签脏状态、受管 reveal） */}
        <div
          className={cn(
            'shrink-0 border-l border-border overflow-y-auto transition-all duration-300',
            selectedSkill ? 'w-[360px]' : 'w-0'
          )}
        >
          {selectedSkill && (
            <Inspector
              key={selectedSkill.id}
              resourceType="skill"
              title={selectedSkill.name}
              subtitle={
                selectedSkill.current_ver
                  ? `v${selectedSkill.current_ver}`
                  : undefined
              }
              source={t(`sourceTypes.${selectedSkill.source_type}`)}
              updatedAt={selectedSkill.installed_at}
              contentPreview={selectedSkill.description || ''}
              tags={selectedSkill.tags || []}
              allTags={tags}
              onSaveTags={(added, removed) =>
                saveSkillTags(selectedSkill.id, added, removed)
              }
              onCreateTag={(name, color) =>
                createTag({ name, color, tag_type: 'skill' })
              }
              onEdit={
                selectedSkill.source_type === 'git' ||
                selectedSkill.source_type === 'skills.sh'
                  ? () => updateSkill(selectedSkill.id)
                  : undefined
              }
              editLabel={tc('actions.update')}
              deleteLabel={tc('actions.uninstall')}
              onDelete={() => setConfirmUninstallId(selectedSkill.id)}
              onGoDistribute={() => goDistribute([selectedSkill.id])}
              goDistributeLabel={tc('batch.goDistribute')}
              onClose={() => selectSkill(null)}
            >
              {(() => {
                const meta = parseMetadata(selectedSkill.metadata);
                return (
                  <>
                    {meta.author && (
                      <div className="flex justify-between gap-3 text-sm">
                        <span className="shrink-0 text-muted-foreground">
                          {t('detail.author')}
                        </span>
                        <span className="truncate text-foreground">
                          {meta.author as string}
                        </span>
                      </div>
                    )}
                    {meta.license && (
                      <div className="flex justify-between gap-3 text-sm">
                        <span className="shrink-0 text-muted-foreground">
                          {t('detail.license')}
                        </span>
                        <span className="truncate text-foreground">
                          {meta.license as string}
                        </span>
                      </div>
                    )}
                    <div
                      data-testid="skill-local-path-row"
                      className="group flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="shrink-0 text-muted-foreground">
                        {t('detail.localPath')}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span className="max-w-[180px] truncate text-xs text-foreground">
                          {sanitizePath(selectedSkill.local_path)}
                        </span>
                        {selectedSkill.local_path && (
                          <button
                            aria-label={`${t('detail.localPath')} ${sanitizePath(selectedSkill.local_path)}`}
                            title={t('detail.openInFinder')}
                            className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-primary transition-colors action-reveal"
                            onClick={() => {
                              ipc
                                .revealPath(selectedSkill.local_path!, false)
                                .then((res) => {
                                  if (res.fallback)
                                    useAppStore
                                      .getState()
                                      .addToast(t('ws.revealFallback'), 'info');
                                })
                                .catch(() =>
                                  useAppStore
                                    .getState()
                                    .addToast(t('ws.revealFailed'), 'error')
                                );
                            }}
                          >
                            <FolderOpen className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </>
                );
              })()}
            </Inspector>
          )}
        </div>
      </div>

      {/* 导入预览对话框（§3.8） */}
      <ResourceImportDialog
        open={showImportDialog}
        title={t('install.title')}
        items={importItems}
        importing={importing}
        itemKindLabel={tc('import.dirs')}
        appendLabel={tc('import.append')}
        confirmLabel={tc('actions.confirmImport')}
        cancelLabel={tc('actions.cancel')}
        onAppend={pickSkillDirs}
        onRemoveItem={removeImportItem}
        onRetryItem={retryImportItem}
        onConfirm={executeImport}
        onCancel={() => {
          setShowImportDialog(false);
          setImportItems([]);
        }}
      />

      {/* 批量管理所选标签 */}
      <BatchTagDialog
        open={showBatchTagDialog}
        allTags={tags}
        initialTagIds={batchTagIntersection}
        title={tc('batch.manageTags')}
        applyLabel={tc('actions.confirm')}
        onApply={applyBatchTags}
        onClose={() => setShowBatchTagDialog(false)}
      />

      {/* 确认对话框 */}
      <ConfirmDialog
        open={showBatchDeleteConfirm}
        title={tc('messages.confirmBatchDeleteSkills', {
          count: batch.selectedCount,
        })}
        message={tc('messages.confirmBatchDeleteSkills', {
          count: batch.selectedCount,
        })}
        variant="danger"
        onConfirm={executeBatchDelete}
        onCancel={() => setShowBatchDeleteConfirm(false)}
      >
        {batchRef.status === 'loading' && (
          <p className="mb-6 text-xs text-muted-foreground">
            {tc('messages.referenceLoading')}
          </p>
        )}
        {batchRef.status === 'loaded' && batchRef.total > 0 && (
          <p className="mb-6 text-xs text-warning">
            {tc('messages.referenceSummary', {
              referenced: batchRef.referenced,
              count: batchRef.total,
            })}
          </p>
        )}
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmUninstallId !== null}
        title={tc('actions.uninstall')}
        message={tc('messages.confirmUninstall')}
        variant="danger"
        confirmLabel={tc('actions.uninstall')}
        onConfirm={async () => {
          if (confirmUninstallId) await uninstallSkill(confirmUninstallId);
          setConfirmUninstallId(null);
        }}
        onCancel={() => setConfirmUninstallId(null)}
      />

      <TagManagerDialog
        tagType="skill"
        isOpen={showTagManager}
        onClose={() => setShowTagManager(false)}
      />
    </div>
  );
}

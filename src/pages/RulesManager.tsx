import { useEffect, useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../stores/appStore';
import { cn, sanitizePath } from '../lib/utils';
import { SEARCH_INPUT_CLASSES } from '../lib/ui-tokens';
import { RuleEditor } from '../domains/rules/RuleEditor';
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
import { useDialogA11y } from '../hooks/useDialogA11y';
import {
  detectRuleFormat,
  formatRelativeTime,
  ruleImportFileName,
  validateRuleImportFile,
} from '../lib/resourceLibrary';
import {
  Search,
  Plus,
  History,
  FileText,
  X,
  CheckSquare,
  Download,
  Tags,
  Maximize,
  Minimize,
  AlertTriangle,
  ChevronsUpDown,
  FolderOpen,
} from 'lucide-react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { ipc } from '../lib/ipc';
import type { CreateRuleDTO, UpdateRuleDTO } from '../types';

const formatBadge: Record<string, { bg: string; text: string }> = {
  mdc: { bg: 'bg-primary/10', text: 'text-primary' },
  md: { bg: 'bg-success/10', text: 'text-success' },
  yaml: { bg: 'bg-warning/10', text: 'text-warning' },
};

export function RulesManager() {
  const { t } = useTranslation(['rules', 'distribution']);
  const { t: tc } = useTranslation('common');
  const rules = useAppStore((s) => s.rules);
  const tags = useAppStore((s) => s.tags);
  const editingRule = useAppStore((s) => s.editingRule);
  const fetchRules = useAppStore((s) => s.fetchRules);
  const fetchTags = useAppStore((s) => s.fetchTags);
  const setEditingRule = useAppStore((s) => s.setEditingRule);
  const createRule = useAppStore((s) => s.createRule);
  const updateRule = useAppStore((s) => s.updateRule);
  const deleteRule = useAppStore((s) => s.deleteRule);
  const loading = useAppStore((s) => s.loading);
  const tagFilter = useAppStore((s) => s.tagFilter);
  const setTagFilter = useAppStore((s) => s.setTagFilter);
  const setActiveNav = useAppStore((s) => s.setActiveNav);
  const setPendingDistributionSelection = useAppStore(
    (s) => s.setPendingDistributionSelection
  );
  const assignTag = useAppStore((s) => s.assignTag);
  const removeTagAction = useAppStore((s) => s.removeTag);
  const createTag = useAppStore((s) => s.createTag);
  const addToast = useAppStore((s) => s.addToast);

  const [searchQuery, setSearchQuery] = useState('');
  const [view, setView] = useState<ResourceView>('group');
  const [collapsedAll, setCollapsedAll] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');

  // Create form state
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newFormat, setNewFormat] = useState<'md' | 'mdc' | 'yaml'>('md');
  const [newContent, setNewContent] = useState('');

  const [untaggedFilter, setUntaggedFilter] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [showTagManager, setShowTagManager] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);
  const [showBatchTagDialog, setShowBatchTagDialog] = useState(false);
  const [confirmDeleteRuleId, setConfirmDeleteRuleId] = useState<string | null>(
    null
  );
  const [showEditLeaveConfirm, setShowEditLeaveConfirm] = useState(false);
  const [managedCopyPath, setManagedCopyPath] = useState<string | null>(null);
  const [batchRef, setBatchRef] = useState<{
    status: 'idle' | 'loading' | 'loaded' | 'error';
    referenced: number;
    total: number;
  }>({ status: 'idle', referenced: 0, total: 0 });

  // Import preview state（§3.8）
  const [importItems, setImportItems] = useState<ImportItem[]>([]);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importing, setImporting] = useState(false);

  const batch = useBatchMode();
  const editLeaveRef = useDialogA11y(showEditLeaveConfirm);

  useEffect(() => {
    let cancelled = false;
    fetchRules().then((ok) => {
      if (!cancelled) setLoadFailed(!ok);
    });
    fetchTags('rule');
    return () => {
      cancelled = true;
    };
  }, [fetchRules, fetchTags]);

  const retryLoad = () => {
    setLoadFailed(false);
    fetchRules().then((ok) => setLoadFailed(!ok));
  };

  // Inspector 打开时按需解析受管副本路径（避免列表逐项 N+1 查询）
  const editingRuleId = editingRule?.id ?? null;
  useEffect(() => {
    if (!editingRuleId) {
      setManagedCopyPath(null);
      return;
    }
    let cancelled = false;
    setManagedCopyPath(null);
    ipc
      .getManagedCopyPath('rule', editingRuleId)
      .then((path) => {
        if (!cancelled) setManagedCopyPath(path ?? null);
      })
      .catch(() => {
        if (!cancelled) setManagedCopyPath(null);
      });
    return () => {
      cancelled = true;
    };
  }, [editingRuleId]);

  useEffect(() => {
    if (editingRule) {
      setEditContent(editingRule.content);
      setEditName(editingRule.name);
      setEditDescription(editingRule.description || '');
    }
  }, [editingRule]);

  const filteredRules = useMemo(() => {
    let result = rules;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (rule) =>
          rule.name.toLowerCase().includes(q) ||
          (rule.description || '').toLowerCase().includes(q)
      );
    }
    if (untaggedFilter) {
      result = result.filter((rule) => !rule.tags || rule.tags.length === 0);
    } else if (tagFilter.length > 0) {
      result = result.filter((rule) => {
        if (!rule.tags) return false;
        const ruleTagIds = rule.tags.map((tag) => tag.id);
        return tagFilter.some((id) => ruleTagIds.includes(id));
      });
    }
    return result;
  }, [rules, searchQuery, tagFilter, untaggedFilter]);

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

  const handleSaveEdit = useCallback(async () => {
    if (!editingRule) return;
    const data: UpdateRuleDTO = {
      name: editName,
      description: editDescription,
      content: editContent,
    };
    await updateRule(editingRule.id, data);
    setEditMode(false);
    setEditingRule(null);
    setShowEditLeaveConfirm(false);
  }, [
    editingRule,
    editName,
    editDescription,
    editContent,
    updateRule,
    setEditMode,
    setEditingRule,
  ]);

  const editDirty = useMemo(() => {
    if (!editingRule) return false;
    return (
      editName !== editingRule.name ||
      editDescription !== (editingRule.description || '') ||
      editContent !== editingRule.content
    );
  }, [editName, editDescription, editContent, editingRule]);

  const handleEditClose = useCallback(() => {
    if (editDirty) setShowEditLeaveConfirm(true);
    else setEditingRule(null);
  }, [editDirty, setEditingRule]);

  const handleEditDiscard = useCallback(() => {
    setShowEditLeaveConfirm(false);
    setEditingRule(null);
  }, [setEditingRule]);

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return;
    if (!newContent.trim()) {
      addToast(t('create.contentRequired'), 'error');
      return;
    }
    const data: CreateRuleDTO = {
      name: newName.trim(),
      description: newDescription.trim(),
      format: newFormat,
      content: newContent,
      platform: '',
      scope: 'global',
    };
    await createRule(data);
    setShowCreateForm(false);
    setNewName('');
    setNewDescription('');
    setNewContent('');
  }, [newName, newDescription, newFormat, newContent, createRule, addToast, t]);

  // === 去分发（§3.4） ===
  const goDistribute = useCallback(
    (ruleIds: string[]) => {
      setPendingDistributionSelection({ skillIds: [], ruleIds });
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
    Promise.all(ids.map((id) => ipc.countSceneReferences('rule', id)))
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
      await deleteRule(id);
    }
    setShowBatchDeleteConfirm(false);
    batch.exit();
  }, [batch, deleteRule]);

  // === 批量管理所选标签 ===
  const selectedRules = useMemo(
    () => rules.filter((r) => batch.selectedIds.has(r.id)),
    [rules, batch.selectedIds]
  );

  const batchTagIntersection = useMemo(() => {
    if (selectedRules.length === 0) return [];
    const common = new Set<number>();
    selectedRules.forEach((r, idx) => {
      const ids = (r.tags || []).map((tg) => tg.id);
      if (idx === 0) ids.forEach((id) => common.add(id));
      else {
        const keep = new Set(ids);
        for (const id of common) if (!keep.has(id)) common.delete(id);
      }
    });
    return [...common];
  }, [selectedRules]);

  const applyBatchTags = useCallback(
    async (added: number[], removed: number[]) => {
      for (const tagId of added) {
        for (const id of batch.selectedIds) await assignTag('rule', id, tagId);
      }
      for (const tagId of removed) {
        for (const id of batch.selectedIds)
          await removeTagAction('rule', id, tagId);
      }
      setShowBatchTagDialog(false);
      batch.exit();
      await fetchRules();
      await fetchTags('rule');
    },
    [batch, assignTag, removeTagAction, fetchRules, fetchTags]
  );

  // === 详情面板标签保存 ===
  const saveRuleTags = useCallback(
    async (ruleId: string, added: number[], removed: number[]) => {
      for (const tagId of added) await assignTag('rule', ruleId, tagId);
      for (const tagId of removed) await removeTagAction('rule', ruleId, tagId);
      await fetchRules();
      const fresh = useAppStore.getState().rules.find((r) => r.id === ruleId);
      if (fresh) setEditingRule(fresh);
    },
    [assignTag, removeTagAction, fetchRules, setEditingRule]
  );

  // === 导入预览（规则文件 .md/.mdc） ===
  const pickRuleFiles = useCallback(async () => {
    try {
      const selected = await openDialog({
        multiple: true,
        filters: [{ name: t('ruleFileFilter'), extensions: ['mdc', 'md'] }],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      const existingNames = new Set(rules.map((r) => r.name));
      const built: ImportItem[] = paths.map((p) => {
        const name = p.split('/').pop() || p.split('\\').pop() || p;
        const validation = validateRuleImportFile(name, existingNames);
        return {
          key: p,
          name,
          path: p,
          format: detectRuleFormat(name),
          status: validation.status,
          reason: validation.reason,
        };
      });
      setImportItems((prev) => {
        const seen = new Set(prev.map((i) => i.key));
        return [...prev, ...built.filter((i) => !seen.has(i.key))];
      });
    } catch {
      /* 用户取消选择 */
    }
  }, [rules, t]);

  const importRuleFile = useCallback(
    async (item: ImportItem): Promise<ImportItem> => {
      try {
        const content = await readTextFile(item.path);
        const data: CreateRuleDTO = {
          name: ruleImportFileName(item.name),
          description: t('importedFrom', { filename: item.name }),
          format: item.format || 'mdc',
          content,
          platform: '',
          scope: 'global',
        };
        await ipc.createRule(data);
        return { ...item, result: 'success' };
      } catch {
        return { ...item, result: 'failed' };
      }
    },
    [t]
  );

  const executeImport = useCallback(async () => {
    if (importing) return;
    setImporting(true);
    const next: ImportItem[] = [];
    for (const item of importItems) {
      if (item.status === 'skip') {
        next.push({ ...item, result: item.result ?? 'skipped' });
        continue;
      }
      if (item.status === 'error') {
        next.push({ ...item, result: item.result ?? 'failed' });
        continue;
      }
      if (item.status !== 'valid' || item.result) {
        next.push(item);
        continue;
      }
      next.push(await importRuleFile(item));
    }
    setImportItems(next);
    setImporting(false);
    await fetchRules();
  }, [importing, importItems, importRuleFile, fetchRules]);

  const retryImportItem = useCallback(
    async (key: string) => {
      if (importing) return;
      const item = importItems.find((i) => i.key === key);
      if (!item) return;
      if (item.result === 'failed') {
        setImporting(true);
        const target = await importRuleFile(item);
        setImportItems((prev) => prev.map((i) => (i.key === key ? target : i)));
        setImporting(false);
        await fetchRules();
      } else {
        const existingNames = new Set(rules.map((r) => r.name));
        const validation = validateRuleImportFile(item.name, existingNames);
        setImportItems((prev) =>
          prev.map((i) =>
            i.key === key
              ? {
                  ...i,
                  status: validation.status,
                  reason: validation.reason,
                  result: undefined,
                }
              : i
          )
        );
      }
    },
    [importing, importItems, importRuleFile, rules, fetchRules]
  );

  const removeImportItem = useCallback((key: string) => {
    setImportItems((prev) => prev.filter((i) => i.key !== key));
  }, []);

  const openImportDialog = useCallback(() => {
    setImportItems([]);
    setShowImportDialog(true);
  }, []);

  // === 卡片/行渲染（A17：Rule 无来源；分组不显示标签、底左相对时间、底右格式徽标；列表显示标签） ===
  const renderGroupCard = useCallback((rule: (typeof rules)[number]) => {
    const badge = formatBadge[rule.format] || formatBadge.md;
    return (
      <>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold text-foreground">
              {rule.name}
            </h3>
            <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">
              {rule.content?.slice(0, 150) || rule.description || ''}
            </p>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            {formatRelativeTime(rule.updated_at)}
          </span>
          <span
            className={cn(
              'shrink-0 rounded px-1.5 py-0.5 text-xs font-medium',
              badge.bg,
              badge.text
            )}
          >
            .{rule.format}
          </span>
        </div>
      </>
    );
  }, []);

  const renderListRow = useCallback((rule: (typeof rules)[number]) => {
    const badge = formatBadge[rule.format] || formatBadge.md;
    return (
      <>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-semibold text-foreground">
                {rule.name}
              </h3>
              <span
                className={cn(
                  'shrink-0 rounded px-1.5 py-0.5 text-xs font-medium',
                  badge.bg,
                  badge.text
                )}
              >
                .{rule.format}
              </span>
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {rule.content?.slice(0, 150) || rule.description || ''}
            </p>
          </div>
          {rule.tags && rule.tags.length > 0 && (
            <div className="flex shrink-0 flex-wrap items-center gap-1">
              {rule.tags.map((tag) => (
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
          {formatRelativeTime(rule.updated_at)}
        </span>
      </>
    );
  }, []);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* 页头行（决策 7 / 29 号 5a）：标题 + 副标题 + 右侧 新建(primary) → 导入(primary) → 管理标签(outline) */}
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
              onClick={() => setShowCreateForm(true)}
            >
              <Plus className="h-4 w-4" />
              {t('createRule')}
            </button>
            <button
              className={cn(
                'shrink-0 flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5',
                'text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors'
              )}
              onClick={openImportDialog}
            >
              <Download className="h-4 w-4" />
              {t('importRules')}
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

      {/* 工具栏（决策 7 / 29 号 5a）：左侧搜索 icon+input ~220px、placeholder 全角 …；右侧 计数 → 视图切换 seg → 批量 */}
      <div className="shrink-0">
        <div className="flex items-center justify-between gap-3 mb-2 mt-2">
          <div className="relative w-[220px] shrink-0">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
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
              {t('count', { count: rules.length })}
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
        <div
          className="flex items-center gap-3 mb-2 mt-2"
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
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="animate-pulse rounded-lg border border-border bg-card p-4"
                >
                  <div className="h-4 w-32 rounded bg-muted" />
                  <div className="mt-2 h-3 w-full rounded bg-muted" />
                  <div className="mt-1 h-3 w-2/3 rounded bg-muted" />
                </div>
              ))}
            </div>
          ) : loadFailed ? (
            <div className="flex flex-col items-center justify-center py-16">
              <AlertTriangle className="mb-3 h-12 w-12 text-muted-foreground/30" />
              <p className="mb-1 text-sm font-medium text-muted-foreground">
                {tc('messages.loadRulesFailed')}
              </p>
              <button
                className="mt-2 text-sm text-primary hover:underline"
                onClick={retryLoad}
              >
                {tc('actions.retry')}
              </button>
            </div>
          ) : rules.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <FileText className="mb-3 h-12 w-12 text-muted-foreground/30" />
              <p className="mb-1 text-sm font-medium text-muted-foreground">
                {t('empty')}
              </p>
              <button
                className="mt-2 text-sm text-primary hover:underline"
                onClick={() => setShowCreateForm(true)}
              >
                {t('createRule')}
              </button>
            </div>
          ) : filteredRules.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <FileText className="mb-3 h-12 w-12 text-muted-foreground/30" />
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
              items={filteredRules}
              tags={tags}
              view={view}
              batchMode={batch.enabled}
              selectedIds={batch.selectedIds}
              untaggedLabel={tc('tag.untagged')}
              showMoreLabel={tc('view.showMore')}
              collapsedAll={collapsedAll}
              onToggleSelect={batch.toggleSelect}
              onOpenDetail={setEditingRule}
              renderItem={(rule) =>
                view === 'group' ? renderGroupCard(rule) : renderListRow(rule)
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

        {/* 详情面板：Inspector 读取态 / 编辑态（§3.2/§3.5） */}
        <div
          className={cn(
            'shrink-0 border-l border-border overflow-y-auto transition-all duration-300',
            editingRule ? (editMode ? 'w-[420px]' : 'w-[360px]') : 'w-0'
          )}
        >
          {editingRule && !editMode && (
            <Inspector
              key={editingRule.id}
              resourceType="rule"
              title={editingRule.name}
              updatedAt={editingRule.updated_at}
              contentPreview={editingRule.content}
              tags={editingRule.tags || []}
              allTags={tags}
              onSaveTags={(added, removed) =>
                saveRuleTags(editingRule.id, added, removed)
              }
              onCreateTag={(name, color) =>
                createTag({ name, color, tag_type: 'rule' })
              }
              onEdit={() => setEditMode(true)}
              deleteLabel={tc('actions.delete')}
              onDelete={() => setConfirmDeleteRuleId(editingRule.id)}
              onGoDistribute={() => goDistribute([editingRule.id])}
              goDistributeLabel={tc('batch.goDistribute')}
              onClose={() => setEditingRule(null)}
            >
              <div
                data-testid="rule-local-path-row"
                className="group flex items-center justify-between gap-3 text-sm"
              >
                <span className="shrink-0 text-muted-foreground">
                  {t('detail.localPath')}
                </span>
                {managedCopyPath ? (
                  <div className="flex items-center gap-1.5">
                    <span className="max-w-[180px] truncate text-xs text-foreground">
                      {sanitizePath(managedCopyPath)}
                    </span>
                    <button
                      aria-label={`${t('detail.localPath')} ${sanitizePath(managedCopyPath)}`}
                      title={t('detail.openInFinder')}
                      className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-primary transition-colors action-reveal"
                      onClick={() => {
                        ipc
                          .revealPath(managedCopyPath, false)
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
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {t('detail.notDistributed')}
                  </span>
                )}
              </div>
            </Inspector>
          )}

          {editingRule && editMode && (
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b border-border p-4">
                <div className="flex-1">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full bg-transparent text-lg font-semibold text-foreground focus:outline-none"
                  />
                  <input
                    type="text"
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    className="mt-1 w-full bg-transparent text-sm text-muted-foreground focus:outline-none"
                    placeholder={t('create.descriptionPlaceholder')}
                  />
                </div>
                <div className="ml-2 flex items-center gap-2">
                  <button
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setIsFullscreen(true)}
                    title={t('fullscreenEdit')}
                  >
                    <Maximize className="h-4 w-4" />
                  </button>
                  <button
                    className="flex items-center gap-1 rounded-md bg-secondary px-3 py-1.5 text-sm text-secondary-foreground hover:bg-secondary/80 transition-colors"
                    onClick={() => setShowHistory(!showHistory)}
                  >
                    <History className="h-4 w-4" />
                    {t('versionHistory')}
                  </button>
                  <button
                    className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                    onClick={handleSaveEdit}
                  >
                    {tc('actions.save')}
                  </button>
                  <button
                    aria-label="close-editor"
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    onClick={handleEditClose}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-hidden p-4">
                <RuleEditor
                  content={editContent}
                  onChange={setEditContent}
                  format={
                    (editingRule.format || 'mdc') as 'mdc' | 'md' | 'yaml'
                  }
                  defaultViewMode="preview"
                />
              </div>

              {showHistory && (
                <div className="max-h-[200px] overflow-y-auto border-t border-border p-3">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t('versionHistory')}
                  </h3>
                  <div className="space-y-1">
                    {[
                      {
                        version: editingRule.version,
                        changed_at: editingRule.updated_at,
                      },
                    ].map((h) => (
                      <div
                        key={h.version}
                        className="flex items-center justify-between rounded px-2 py-1 text-sm"
                      >
                        <span className="text-foreground">v{h.version}</span>
                        <span className="text-xs text-muted-foreground">
                          {h.changed_at}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 新建 Rule 对话框 */}
      {showCreateForm && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50">
          <div className="w-[560px] rounded-lg border border-border bg-card p-6 shadow-xl animate-fade-in">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">
                {t('create.title')}
              </h2>
              <button
                onClick={() => setShowCreateForm(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  {t('create.nameLabel')}
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={t('create.namePlaceholder')}
                  className={cn(
                    'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm',
                    'focus:outline-none focus:ring-2 focus:ring-ring'
                  )}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  {t('create.descriptionLabel')}
                </label>
                <input
                  type="text"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder={t('create.descriptionPlaceholder')}
                  className={cn(
                    'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm',
                    'focus:outline-none focus:ring-2 focus:ring-ring'
                  )}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  {t('format')}
                </label>
                <select
                  value={newFormat}
                  onChange={(e) =>
                    setNewFormat(e.target.value as 'md' | 'mdc' | 'yaml')
                  }
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="md">.md</option>
                  <option value="mdc">.mdc</option>
                  <option value="yaml">.yaml</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  {t('content')}
                </label>
                <div className="h-[300px]">
                  <RuleEditor
                    content={newContent}
                    onChange={setNewContent}
                    format={newFormat}
                    defaultViewMode="edit"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors"
                  onClick={() => setShowCreateForm(false)}
                >
                  {tc('actions.cancel')}
                </button>
                <button
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                  onClick={handleCreate}
                >
                  {tc('actions.save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 导入预览对话框（§3.8） */}
      <ResourceImportDialog
        open={showImportDialog}
        title={t('importPreview')}
        items={importItems}
        importing={importing}
        itemKindLabel={tc('import.files')}
        appendLabel={tc('import.append')}
        confirmLabel={tc('actions.confirmImport')}
        cancelLabel={tc('actions.cancel')}
        onAppend={pickRuleFiles}
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

      {/* 全屏编辑 */}
      {isFullscreen && editingRule && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex-1">
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full max-w-md bg-transparent text-lg font-semibold text-foreground focus:outline-none"
                autoFocus
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                onClick={async () => {
                  await handleSaveEdit();
                  setIsFullscreen(false);
                }}
              >
                {tc('actions.save')}
              </button>
              <button
                className="text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setIsFullscreen(false)}
                title={t('exitFullscreen')}
              >
                <Minimize className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="flex flex-1 overflow-hidden">
            <div className="flex-1 overflow-y-auto border-r border-border p-4">
              <RuleEditor
                content={editContent}
                onChange={setEditContent}
                format={(editingRule.format || 'mdc') as 'mdc' | 'md' | 'yaml'}
                defaultViewMode="edit"
              />
            </div>
            <div className="w-[40%] overflow-y-auto p-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t('preview')}
              </h3>
              <pre className="whitespace-pre-wrap font-mono text-sm text-foreground">
                {editContent}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* 确认对话框 */}
      <ConfirmDialog
        open={showBatchDeleteConfirm}
        title={tc('messages.confirmBatchDeleteRules', {
          count: batch.selectedCount,
        })}
        message={tc('messages.confirmBatchDeleteRules', {
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
        open={confirmDeleteRuleId !== null}
        title={tc('actions.delete')}
        message={tc('messages.confirmDelete')}
        variant="danger"
        confirmLabel={tc('actions.delete')}
        onConfirm={async () => {
          if (confirmDeleteRuleId) await deleteRule(confirmDeleteRuleId);
          setConfirmDeleteRuleId(null);
        }}
        onCancel={() => setConfirmDeleteRuleId(null)}
      />

      <TagManagerDialog
        tagType="rule"
        isOpen={showTagManager}
        onClose={() => setShowTagManager(false)}
      />

      {/* 未保存编辑离开确认（A13：保存 / 放弃 / 取消离开） */}
      {showEditLeaveConfirm && (
        <div
          ref={editLeaveRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="rule-edit-leave-title"
          tabIndex={-1}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        >
          <div className="w-[400px] rounded-lg border border-border bg-card p-6 shadow-xl animate-fade-in">
            <h2
              id="rule-edit-leave-title"
              className="text-lg font-semibold text-foreground"
            >
              {tc('inspector.unsavedTitle')}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {tc('inspector.unsavedMessage')}
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors"
                onClick={() => setShowEditLeaveConfirm(false)}
              >
                {tc('inspector.stay')}
              </button>
              <button
                className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors"
                onClick={handleEditDiscard}
              >
                {tc('inspector.discard')}
              </button>
              <button
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                onClick={handleSaveEdit}
              >
                {tc('actions.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

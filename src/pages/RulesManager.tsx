import { useEffect, useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../stores/appStore';
import { cn } from '../lib/utils';
import { RuleEditor } from '../components/RuleEditor';
import { TagPopover } from '../components/TagPopover';
import { TagFilterBar } from '../components/TagFilterBar';
import { TagManagerDialog } from '../components/TagManagerDialog';
import {
  Search,
  Plus,
  Trash2,
  History,
  FileText,
  X,
  ChevronRight,
  Clock,
  CheckSquare,
  Upload,
  Tags,
  Maximize,
  Minimize,
} from 'lucide-react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { readTextFile } from '@tauri-apps/plugin-fs';
import type { CreateRuleDTO, UpdateRuleDTO } from '../types';

const formatBadge: Record<string, { bg: string; text: string }> = {
  mdc: { bg: 'bg-primary/10', text: 'text-primary' },
  md: { bg: 'bg-success/10', text: 'text-success' },
  yaml: { bg: 'bg-warning/10', text: 'text-warning' },
};

function detectFormat(filename: string): 'mdc' | 'md' | 'yaml' {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (ext === 'mdc') return 'mdc';
  if (ext === 'yaml' || ext === 'yml') return 'yaml';
  return 'md';
}

export function RulesManager() {
  const { t } = useTranslation('rules');
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
  const assignTag = useAppStore((s) => s.assignTag);
  const removeTagAction = useAppStore((s) => s.removeTag);
  const createTag = useAppStore((s) => s.createTag);
  const addToast = useAppStore((s) => s.addToast);

  const [searchQuery, setSearchQuery] = useState('');
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

  // Batch mode state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchMode, setBatchMode] = useState(false);
  const [untaggedFilter, setUntaggedFilter] = useState(false);
  const [showTagManager, setShowTagManager] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);

  // Import preview state
  const [importFiles, setImportFiles] = useState<
    Array<{ name: string; size: number; format: string; path: string }>
  >([]);
  const [showImportPreview, setShowImportPreview] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    fetchRules();
    fetchTags('rule');
  }, [fetchRules, fetchTags]);

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

  const handleSaveEdit = useCallback(async () => {
    if (!editingRule) return;
    const data: UpdateRuleDTO = {
      name: editName,
      description: editDescription,
      content: editContent,
    };
    await updateRule(editingRule.id, data);
    setEditingRule(null);
  }, [
    editingRule,
    editName,
    editDescription,
    editContent,
    updateRule,
    setEditingRule,
  ]);

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

  const handleAssignTag = useCallback(
    async (ruleId: string, tagId: number) => {
      await assignTag('rule', ruleId, tagId);
      await fetchRules();
      await fetchTags('rule');
    },
    [assignTag, fetchRules, fetchTags]
  );

  const handleRemoveTag = useCallback(
    async (ruleId: string, tagId: number) => {
      await removeTagAction('rule', ruleId, tagId);
      await fetchRules();
      await fetchTags('rule');
    },
    [removeTagAction, fetchRules, fetchTags]
  );

  const executeBatchDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    for (const id of selectedIds) {
      await deleteRule(id);
    }
    setSelectedIds(new Set());
    setBatchMode(false);
    setShowBatchDeleteConfirm(false);
  }, [selectedIds, deleteRule]);

  const handleBatchDelete = useCallback(() => {
    if (selectedIds.size === 0) return;
    setShowBatchDeleteConfirm(true);
  }, [selectedIds]);

  // Esc to exit batch mode
  useEffect(() => {
    if (!batchMode) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setBatchMode(false);
        setSelectedIds(new Set());
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [batchMode]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString('zh-CN', {
        month: 'short',
        day: 'numeric',
      });
    } catch (e) {
      console.error('formatTime failed:', e);
      return iso;
    }
  };

  // T12: Import rules from files
  const handleImportClick = useCallback(async () => {
    try {
      const selected = await openDialog({
        multiple: true,
        filters: [
          {
            name: t('ruleFileFilter'),
            extensions: ['mdc', 'md', 'yaml', 'yml'],
          },
        ],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      const files = paths.map((p) => {
        const name = p.split('/').pop() || p.split('\\').pop() || p;
        return {
          name,
          size: 0,
          format: detectFormat(name),
          path: p,
        };
      });
      setImportFiles(files);
      setShowImportPreview(true);
    } catch (e) {}
  }, []);

  const handleImportConfirm = useCallback(async () => {
    setImporting(true);
    let successCount = 0;
    let failCount = 0;
    for (const file of importFiles) {
      try {
        const content = await readTextFile(file.path);
        const nameWithoutExt = file.name.replace(/\.[^.]+$/, '');
        const data: CreateRuleDTO = {
          name: nameWithoutExt,
          description: t('importedFrom', { filename: file.name }),
          format: file.format,
          content: content,
          platform: '',
          scope: 'global',
        };
        await createRule(data, { silent: true });
        successCount++;
      } catch (e) {
        failCount++;
      }
    }
    setImporting(false);
    setShowImportPreview(false);
    setImportFiles([]);
    addToast(
      tc('messages.importComplete', { success: successCount, fail: failCount }),
      failCount > 0 ? 'warning' : 'success'
    );
  }, [importFiles, createRule, addToast]);

  return (
    <div className="flex h-full flex-col">
      {/* Top Bar: Search + Tag Pills */}
      <div className="shrink-0 border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className={cn(
                'w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm',
                'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'
              )}
            />
          </div>
          <button
            className={cn(
              'flex items-center gap-2 rounded-lg border border-border px-3 py-2',
              'text-sm font-medium text-foreground hover:bg-accent transition-colors',
              batchMode && 'bg-primary/10 border-primary/30'
            )}
            onClick={() => {
              setBatchMode(!batchMode);
              if (batchMode) setSelectedIds(new Set());
            }}
          >
            <CheckSquare className="h-4 w-4" />
            {batchMode ? tc('actions.exitSelect') : tc('actions.batchSelect')}
          </button>
          <button
            className={cn(
              'flex items-center gap-2 rounded-lg border border-border px-3 py-2',
              'text-sm font-medium text-foreground hover:bg-accent transition-colors'
            )}
            onClick={handleImportClick}
          >
            <Upload className="h-4 w-4" />
            {t('importRules')}
          </button>
          <button
            className={cn(
              'flex items-center gap-2 rounded-lg bg-primary px-3 py-2',
              'text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors'
            )}
            onClick={() => setShowCreateForm(true)}
          >
            <Plus className="h-4 w-4" />
            {t('createRule')}
          </button>
        </div>
        {/* Tag filter bar + manage button */}
        {(tags.length > 0 || true) && (
          <div className="flex items-center gap-2 px-4 pb-2">
            <div className="flex-1 overflow-hidden">
              <TagFilterBar
                tags={tags}
                selectedTagIds={tagFilter}
                onToggleTag={toggleTag}
                onClearAll={() => {
                  setTagFilter([]);
                  setUntaggedFilter(false);
                }}
                showUntagged
                untaggedFilter={untaggedFilter}
                onToggleUntagged={() => setUntaggedFilter(!untaggedFilter)}
              />
            </div>
            <button
              className={cn(
                'shrink-0 flex items-center gap-1 rounded-lg border border-border px-2.5 py-1',
                'text-xs font-medium text-foreground hover:bg-accent transition-colors'
              )}
              onClick={() => setShowTagManager(true)}
            >
              <Tags className="h-3.5 w-3.5" />
              {tc('tag.manageTags')}
            </button>
          </div>
        )}
      </div>

      {/* Batch Action Bar */}
      {batchMode && selectedIds.size > 0 && (
        <div className="flex items-center gap-3 border-b border-border bg-primary/5 px-4 py-2">
          <span className="text-sm font-medium text-foreground">
            {tc('messages.selectedCount', { count: selectedIds.size })}
          </span>
          <button
            className="flex items-center gap-1.5 rounded-md bg-error/10 px-3 py-1.5 text-sm font-medium text-error hover:bg-error/20 transition-colors"
            onClick={handleBatchDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {tc('actions.delete')}
          </button>
          <button
            className="ml-auto text-sm text-muted-foreground hover:text-foreground"
            onClick={() => {
              setBatchMode(false);
              setSelectedIds(new Set());
            }}
          >
            {tc('actions.cancelSelect')}
          </button>
        </div>
      )}

      {/* Card Grid + Detail Panel */}
      <div className="flex-1 overflow-hidden flex">
        <div className="flex-1 overflow-y-auto p-4">
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
          ) : filteredRules.length > 0 ? (
            <div
              className="grid gap-3"
              style={{
                gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
              }}
            >
              {filteredRules.map((rule) => {
                const badge = formatBadge[rule.format] || formatBadge.md;
                return (
                  <div
                    key={rule.id}
                    className={cn(
                      'rounded-lg border p-4 text-left transition-all relative',
                      editingRule?.id === rule.id
                        ? 'border-primary bg-primary/5 shadow-sm'
                        : 'border-border bg-card hover:border-primary/30 hover:shadow-sm',
                      batchMode &&
                        selectedIds.has(rule.id) &&
                        'border-primary/50 bg-primary/5'
                    )}
                    onClick={() => {
                      if (batchMode) {
                        toggleSelect(rule.id);
                      } else {
                        setEditingRule(rule);
                      }
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    {batchMode && (
                      <div className="absolute left-3 top-3 z-10">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(rule.id)}
                          onChange={() => toggleSelect(rule.id)}
                          className="rounded border-border h-4 w-4 cursor-pointer"
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                    )}
                    <div
                      className={cn(
                        'flex items-start justify-between gap-2',
                        batchMode && 'pl-6'
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-semibold text-foreground truncate">
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
                        <p className="mt-1 text-xs text-muted-foreground line-clamp-3">
                          {rule.content?.slice(0, 150) ||
                            rule.description ||
                            ''}
                        </p>
                      </div>
                      {!batchMode && (
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />
                      )}
                    </div>
                    <div
                      className={cn(
                        'mt-3 flex items-center gap-2 flex-wrap',
                        batchMode && 'pl-6'
                      )}
                    >
                      {/* Tag popover on card */}
                      <div onClick={(e) => e.stopPropagation()}>
                        <div className="flex flex-wrap items-center gap-1">
                          {(rule.tags || []).map((tag) => (
                            <span
                              key={tag.id}
                              className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium"
                              style={
                                tag.color
                                  ? {
                                      backgroundColor: tag.color + '20',
                                      color: tag.color,
                                    }
                                  : undefined
                              }
                            >
                              {tag.name}
                              <button
                                className="ml-0.5 rounded-full p-0.5 hover:bg-black/10 transition-colors"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRemoveTag(rule.id, tag.id);
                                }}
                              >
                                <X className="h-2.5 w-2.5" />
                              </button>
                            </span>
                          ))}
                          <TagPopover
                            tagType="rule"
                            targetId={rule.id}
                            assignedTags={rule.tags || []}
                            allTags={tags}
                            onAssign={(tagId) =>
                              handleAssignTag(rule.id, tagId)
                            }
                            onRemove={(tagId) =>
                              handleRemoveTag(rule.id, tagId)
                            }
                            onCreate={async (name, color) => {
                              const result = await createTag({
                                name,
                                color,
                                tag_type: 'rule',
                              });
                              await fetchRules();
                              return result;
                            }}
                          />
                        </div>
                      </div>
                      <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {formatTime(rule.updated_at)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
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
          )}
        </div>

        {/* Right Slide-out Detail Panel */}
        <div
          className={cn(
            'shrink-0 border-l border-border overflow-y-auto transition-all duration-300',
            editingRule ? 'w-[420px]' : 'w-0'
          )}
        >
          {editingRule && (
            <div className="flex flex-col h-full">
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
                    className="w-full bg-transparent text-sm text-muted-foreground focus:outline-none mt-1"
                    placeholder={t('create.descriptionPlaceholder')}
                  />
                </div>
                <div className="flex items-center gap-2 ml-2">
                  <button
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => setIsFullscreen(true)}
                    title={t('fullscreenEdit')}
                  >
                    <Maximize className="h-4 w-4" />
                  </button>
                  <button
                    className="flex items-center gap-1 rounded-md bg-secondary px-3 py-1.5 text-sm text-secondary-foreground hover:bg-secondary/80"
                    onClick={() => setShowHistory(!showHistory)}
                  >
                    <History className="h-4 w-4" />
                    {t('versionHistory')}
                  </button>
                  <button
                    className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                    onClick={handleSaveEdit}
                  >
                    {tc('actions.save')}
                  </button>
                  <button
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => setEditingRule(null)}
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

              {/* History Panel */}
              {showHistory && (
                <div className="border-t border-border max-h-[200px] overflow-y-auto p-3">
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

      {/* Create Rule Dialog */}
      {showCreateForm && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50">
          <div className="w-[560px] rounded-lg border border-border bg-card p-6 shadow-xl animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">
                {t('create.title')}
              </h2>
              <button
                onClick={() => setShowCreateForm(false)}
                className="text-muted-foreground hover:text-foreground"
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
                    setNewFormat(e.target.value as 'mdc' | 'md' | 'yaml')
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
                  className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
                  onClick={() => setShowCreateForm(false)}
                >
                  {tc('actions.cancel')}
                </button>
                <button
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                  onClick={handleCreate}
                >
                  {tc('actions.save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Import Preview Dialog */}
      {showImportPreview && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50">
          <div className="w-[500px] max-h-[80vh] rounded-lg border border-border bg-card p-6 shadow-xl animate-fade-in flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">
                {t('importPreview')}
              </h2>
              <button
                onClick={() => {
                  setShowImportPreview(false);
                  setImportFiles([]);
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2 mb-4">
              {importFiles.map((file, idx) => (
                <div
                  key={idx}
                  className="rounded-md border border-border bg-muted/30 p-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground truncate">
                      {file.name}
                    </span>
                    <span
                      className={cn(
                        'rounded px-1.5 py-0.5 text-xs font-medium',
                        (formatBadge[file.format] || formatBadge.md).bg,
                        (formatBadge[file.format] || formatBadge.md).text
                      )}
                    >
                      .{file.format}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('willCreateAs', {
                      name: file.name.replace(/\.[^.]+$/, ''),
                    })}
                  </p>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-border">
              <span className="text-sm text-muted-foreground">
                {tc('messages.totalFiles', { count: importFiles.length })}
              </span>
              <div className="flex gap-2">
                <button
                  className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
                  onClick={() => {
                    setShowImportPreview(false);
                    setImportFiles([]);
                  }}
                >
                  {tc('actions.cancel')}
                </button>
                <button
                  className={cn(
                    'rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90',
                    importing && 'opacity-50 pointer-events-none'
                  )}
                  onClick={handleImportConfirm}
                >
                  {importing
                    ? tc('status.importing')
                    : tc('actions.confirmImport')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tag Manager Dialog */}
      <TagManagerDialog
        tagType="rule"
        isOpen={showTagManager}
        onClose={() => setShowTagManager(false)}
      />

      {/* Fullscreen Editor */}
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
                className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                onClick={async () => {
                  await handleSaveEdit();
                  setIsFullscreen(false);
                }}
              >
                {tc('actions.save')}
              </button>
              <button
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setIsFullscreen(false)}
                title={t('exitFullscreen')}
              >
                <Minimize className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="flex flex-1 overflow-hidden">
            <div className="flex-1 overflow-y-auto p-4 border-r border-border">
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
              <pre className="whitespace-pre-wrap text-sm text-foreground font-mono">
                {editContent}
              </pre>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={showBatchDeleteConfirm}
        title={tc('messages.confirmBatchDeleteRules', {
          count: selectedIds.size,
        })}
        message={tc('messages.confirmBatchDeleteRules', {
          count: selectedIds.size,
        })}
        variant="danger"
        onConfirm={executeBatchDelete}
        onCancel={() => setShowBatchDeleteConfirm(false)}
      />
    </div>
  );
}

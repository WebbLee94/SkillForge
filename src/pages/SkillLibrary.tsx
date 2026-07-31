import { useEffect, useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../stores/appStore';
import { ipc } from '../lib/ipc';
import { cn, sanitizePath } from '../lib/utils';
import { TagPopover } from '../components/TagPopover';
import { TagFilterBar } from '../components/TagFilterBar';
import { TagManagerDialog } from '../components/TagManagerDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import {
  Search,
  Download,
  Trash2,
  RefreshCw,
  X,
  Package,
  FolderOpen,
  ChevronRight,
  Clock,
  CheckSquare,
  Tags,
} from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { revealItemInDir } from '@tauri-apps/plugin-opener';

export function SkillLibrary() {
  const { t } = useTranslation('skills');
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
  const uninstallSkill = useAppStore((s) => s.uninstallSkill);
  const updateSkill = useAppStore((s) => s.updateSkill);
  const assignTag = useAppStore((s) => s.assignTag);
  const removeTagAction = useAppStore((s) => s.removeTag);
  const createTag = useAppStore((s) => s.createTag);

  const [showInstallDialog, setShowInstallDialog] = useState(false);
  const [installSource, setInstallSource] = useState<'local' | 'git'>('local');
  const [installInput, setInstallInput] = useState('');
  const [selectedDirs, setSelectedDirs] = useState<string[]>([]);
  const [localSearch, setLocalSearch] = useState('');
  const [debounceTimer, setDebounceTimer] = useState<ReturnType<
    typeof setTimeout
  > | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchMode, setBatchMode] = useState(false);
  const [untaggedFilter, setUntaggedFilter] = useState(false);
  const [showTagManager, setShowTagManager] = useState(false);
  const [confirmUninstallId, setConfirmUninstallId] = useState<string | null>(
    null
  );
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);

  useEffect(() => {
    fetchSkills();
    fetchTags('skill');
  }, [fetchSkills, fetchTags]);

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

  const parseMetadata = (
    meta: string | null | undefined
  ): Record<string, unknown> => {
    if (!meta) return {};
    try {
      return JSON.parse(meta);
    } catch (e) {
      console.error('parseMetadata failed:', e);
      return {};
    }
  };

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

  const handleAssignTag = useCallback(
    async (skillId: string, tagId: number) => {
      await assignTag('skill', skillId, tagId);
      await fetchSkills();
      await fetchTags('skill');
    },
    [assignTag, fetchSkills, fetchTags]
  );

  const handleRemoveTag = useCallback(
    async (skillId: string, tagId: number) => {
      await removeTagAction('skill', skillId, tagId);
      await fetchSkills();
      await fetchTags('skill');
    },
    [removeTagAction, fetchSkills, fetchTags]
  );

  const executeBatchDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    for (const id of selectedIds) {
      await uninstallSkill(id);
    }
    setSelectedIds(new Set());
    setBatchMode(false);
    setShowBatchDeleteConfirm(false);
  }, [selectedIds, uninstallSkill]);

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

  return (
    <div className="flex h-full flex-col">
      {/* Top Bar: Search + Tag Pills */}
      <div className="shrink-0 border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={localSearch}
              onChange={(e) => handleSearch(e.target.value)}
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
              'flex items-center gap-2 rounded-lg bg-primary px-3 py-2',
              'text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors'
            )}
            onClick={() => setShowInstallDialog(true)}
          >
            <Download className="h-4 w-4" />
            {tc('actions.install')}
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

      {/* Card Grid */}
      <div className="flex-1 overflow-hidden flex">
        <div className="flex-1 overflow-y-auto p-4">
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
                  <div className="mt-3 flex items-center gap-2">
                    <div className="h-5 w-12 rounded-full bg-muted" />
                    <div className="h-5 w-12 rounded-full bg-muted" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredSkills.length > 0 ? (
            <div
              className="grid gap-3"
              style={{
                gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
              }}
            >
              {filteredSkills.map((skill) => (
                <div
                  key={skill.id}
                  className={cn(
                    'rounded-lg border p-4 text-left transition-all relative',
                    selectedSkill?.id === skill.id
                      ? 'border-primary bg-primary/5 shadow-sm'
                      : 'border-border bg-card hover:border-primary/30 hover:shadow-sm',
                    batchMode &&
                      selectedIds.has(skill.id) &&
                      'border-primary/50 bg-primary/5'
                  )}
                  onClick={() => {
                    if (batchMode) {
                      toggleSelect(skill.id);
                    } else {
                      selectSkill(skill);
                    }
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  {batchMode && (
                    <div className="absolute left-3 top-3 z-10">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(skill.id)}
                        onChange={() => toggleSelect(skill.id)}
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
                      <h3 className="text-sm font-semibold text-foreground truncate">
                        {skill.name}
                      </h3>
                      <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                        {skill.description || ''}
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
                    {skill.current_ver && (
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                        v{skill.current_ver}
                      </span>
                    )}
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {formatTime(skill.installed_at)}
                    </span>
                  </div>
                  <div
                    className={cn('mt-1.5', batchMode && 'pl-6')}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex flex-wrap items-center gap-1">
                      {(skill.tags || []).map((tag) => (
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
                              handleRemoveTag(skill.id, tag.id);
                            }}
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </span>
                      ))}
                      <TagPopover
                        tagType="skill"
                        targetId={skill.id}
                        assignedTags={skill.tags || []}
                        allTags={tags}
                        onAssign={(tagId) => handleAssignTag(skill.id, tagId)}
                        onRemove={(tagId) => handleRemoveTag(skill.id, tagId)}
                        onCreate={async (name, color) => {
                          const result = await createTag({
                            name,
                            color,
                            tag_type: 'skill',
                          });
                          await fetchSkills();
                          return result;
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16">
              <Package className="mb-3 h-12 w-12 text-muted-foreground/30" />
              <p className="mb-1 text-sm font-medium text-muted-foreground">
                {t('empty')}
              </p>
              <button
                className="mt-2 text-sm text-primary hover:underline"
                onClick={() => setShowInstallDialog(true)}
              >
                {tc('actions.install')}
                {tc('nav.skills')}
              </button>
            </div>
          )}
        </div>

        {/* Right Slide-out Detail Panel */}
        <div
          className={cn(
            'shrink-0 border-l border-border overflow-y-auto transition-all duration-300',
            selectedSkill ? 'w-[360px]' : 'w-0'
          )}
        >
          {selectedSkill && (
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold text-foreground">
                  {selectedSkill.name}
                </h2>
                <button
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => selectSkill(null)}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {selectedSkill.current_ver && (
                <p className="text-xs text-muted-foreground">
                  v{selectedSkill.current_ver}
                </p>
              )}
              <p className="mt-3 text-sm text-foreground">
                {selectedSkill.description || ''}
              </p>

              <div className="mt-4 space-y-2">
                {(() => {
                  const meta = parseMetadata(selectedSkill.metadata);
                  return (
                    <>
                      {meta.author && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">
                            {t('detail.author')}
                          </span>
                          <span className="text-foreground">
                            {meta.author as string}
                          </span>
                        </div>
                      )}
                      {meta.license && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">
                            {t('detail.license')}
                          </span>
                          <span className="text-foreground">
                            {meta.license as string}
                          </span>
                        </div>
                      )}
                    </>
                  );
                })()}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    {t('detail.source')}
                  </span>
                  <span className="text-foreground">
                    {t(`sourceTypes.${selectedSkill.source_type}`)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {t('detail.localPath')}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="max-w-[180px] truncate text-xs text-foreground">
                      {sanitizePath(selectedSkill.local_path)}
                    </span>
                    {selectedSkill.local_path && (
                      <button
                        className="shrink-0 text-muted-foreground hover:text-primary transition-colors"
                        onClick={() =>
                          revealItemInDir(selectedSkill.local_path!)
                        }
                        title={t('detail.openInFinder', '在文件管理器中打开')}
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    {t('detail.installedAt')}
                  </span>
                  <span className="text-xs text-foreground">
                    {formatTime(selectedSkill.installed_at)}
                  </span>
                </div>
              </div>

              {/* Detail panel tags: read-only */}
              {selectedSkill.tags && selectedSkill.tags.length > 0 && (
                <div className="mt-4">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {tc('nav.tags')}
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedSkill.tags.map((tag) => (
                      <span
                        key={tag.id}
                        className="rounded-full px-2.5 py-1 text-xs font-medium"
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
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-6 space-y-2">
                {(selectedSkill.source_type === 'git' ||
                  selectedSkill.source_type === 'skills.sh') && (
                  <button
                    className={cn(
                      'flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2',
                      'text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors'
                    )}
                    onClick={() => updateSkill(selectedSkill.id)}
                  >
                    <RefreshCw className="h-4 w-4" />
                    {tc('actions.update')}
                  </button>
                )}
                <button
                  className={cn(
                    'flex w-full items-center justify-center gap-2 rounded-lg border border-error/30 bg-error/5 px-3 py-2',
                    'text-sm font-medium text-error hover:bg-error/10 transition-colors'
                  )}
                  onClick={() => setConfirmUninstallId(selectedSkill.id)}
                >
                  <Trash2 className="h-4 w-4" />
                  {tc('actions.uninstall')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Install Dialog */}
      {showInstallDialog && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50">
          <div className="w-[440px] max-h-[80vh] overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-xl animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">
                {t('install.title')}
              </h2>
              <button
                onClick={() => setShowInstallDialog(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Source type hidden until git support is ready */}
              {false && (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">
                    {t('install.sourceType')}
                  </label>
                  <div className="flex gap-2">
                    {(['local', 'git'] as const).map((source) => (
                      <button
                        key={source}
                        className={cn(
                          'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                          installSource === source
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                        )}
                        onClick={() => setInstallSource(source)}
                      >
                        {t(`sourceTypes.${source}`)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  {installSource === 'local'
                    ? t('install.localPath')
                    : installSource === 'git'
                      ? t('install.gitUrl')
                      : t('install.registryId')}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={installInput}
                    onChange={(e) => setInstallInput(e.target.value)}
                    placeholder={t(`install.placeholder.${installSource}`)}
                    className={cn(
                      'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm',
                      'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'
                    )}
                  />
                  {installSource === 'local' && (
                    <button
                      type="button"
                      className={cn(
                        'shrink-0 flex items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-2',
                        'text-sm font-medium text-foreground hover:bg-accent transition-colors'
                      )}
                      onClick={async () => {
                        const selected = await open({
                          directory: true,
                          multiple: true,
                        });
                        if (selected && selected.length > 0) {
                          setSelectedDirs(selected);
                          setInstallInput(selected.join('\n'));
                        }
                      }}
                    >
                      <FolderOpen className="h-4 w-4" />
                      {t('install.browse')}
                    </button>
                  )}
                  {installSource === 'local' && selectedDirs.length > 1 && (
                    <div className="mt-2 rounded-lg border border-border bg-muted/50 p-2">
                      <p className="text-xs font-medium text-muted-foreground mb-1">
                        {tc('messages.selectedDirectories', {
                          count: selectedDirs.length,
                        })}
                        :
                      </p>
                      <ul className="space-y-0.5">
                        {selectedDirs.map((dir) => (
                          <li
                            key={dir}
                            className="text-xs font-mono text-foreground truncate"
                          >
                            {dir.split('/').pop() || dir}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
                  onClick={() => setShowInstallDialog(false)}
                >
                  {tc('actions.cancel')}
                </button>
                <button
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                  onClick={async () => {
                    if (!installInput.trim()) return;
                    const addToast = useAppStore.getState().addToast;

                    if (installSource === 'local' && selectedDirs.length > 1) {
                      // Batch install: use backend batch command
                      try {
                        await ipc.installSkillsBatch('local-fs', selectedDirs);
                        await useAppStore.getState().fetchSkills();
                        addToast(
                          `${selectedDirs.length}/${selectedDirs.length} ${tc('messages.installSuccess')}`,
                          'success'
                        );
                      } catch (e) {
                        const errMsg =
                          e instanceof Error ? e.message : String(e);
                        addToast(`批量安装失败: ${errMsg}`, 'error');
                      }
                    } else {
                      // Single install
                      await useAppStore
                        .getState()
                        .installSkill(installSource, installInput.trim());
                    }
                    setShowInstallDialog(false);
                    setInstallInput('');
                    setSelectedDirs([]);
                  }}
                >
                  {tc('actions.install')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Dialogs */}
      <ConfirmDialog
        open={showBatchDeleteConfirm}
        title={tc('messages.confirmBatchDeleteSkills', {
          count: selectedIds.size,
        })}
        message={tc('messages.confirmBatchDeleteSkills', {
          count: selectedIds.size,
        })}
        variant="danger"
        onConfirm={executeBatchDelete}
        onCancel={() => setShowBatchDeleteConfirm(false)}
      />
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

      {/* Tag Manager Dialog */}
      <TagManagerDialog
        tagType="skill"
        isOpen={showTagManager}
        onClose={() => setShowTagManager(false)}
      />
    </div>
  );
}

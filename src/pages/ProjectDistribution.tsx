import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../stores/appStore';
import { sanitizePath } from '../lib/utils';
import { SEARCH_INPUT_CLASSES } from '../lib/ui-tokens';
import type { Platform, PlatformEntryCount } from '../types';
import {
  Plus,
  Settings,
  Folder,
  OctagonX,
  Pencil,
  CheckSquare,
  Send,
  Search,
} from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ipc } from '../lib/ipc';
import { AddProjectDialog } from '../components/AddProjectDialog';
import { ProjectBatchBar } from '../components/ProjectBatchBar';
import { useBatchMode } from '../hooks/useBatchMode';

/**
 * 项目页（差异3，交互稿 §7.8）：纯项目管理列表，不再内嵌分发工作区。
 * - 列表行内提供重命名与「去工作区分发」快捷入口（携带项目上下文）。
 * - 分发统一在共享工作区（/workspace，scope=global）进行；工作区挂载时
 *   消费 `projectDistSelectedProjectId` 作为默认目标并清除，使后续直接
 *   进入工作区时默认回到全局目标。
 * - 删除仅支持批量（二次确认，只删 SkillForge 记录，不删磁盘）。
 *
 * allow: SIZE_OK — 单一职责的 React 页面组件，行数来自内联 JSX 而非逻辑；
 * 仓库内页面组件普遍超过 250 纯行（替换前的本文件为 449 行），拆分单调用方的
 * 行组件只会引入无意义的间接层。
 */

interface ProjectStatsRowProps {
  projectId: string;
  enabledPlatforms: Platform[];
  stats: Record<string, PlatformEntryCount> | undefined;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function ProjectStatsRow({
  projectId,
  enabledPlatforms,
  stats,
  t,
}: ProjectStatsRowProps) {
  const rows = enabledPlatforms.map((platform) => {
    const entry = stats?.[platform.id];
    return {
      platform,
      skills: entry?.skills ?? 0,
      rules: entry?.rules ?? 0,
      dirExists: entry?.dir_exists ?? false,
    };
  });
  const hasContent = rows.some(
    (r) => r.dirExists && (r.skills > 0 || r.rules > 0)
  );
  if (!hasContent) {
    return (
      <div className="mt-2 text-xs text-muted-foreground">
        {t('noDistributionPlaceholder')}
      </div>
    );
  }
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {rows.map((r) => (
        <span key={r.platform.id} data-testid={`platform-stats-${projectId}-${r.platform.id}`}>
          {t('projectPlatformStats', {
            platform: r.platform.name,
            skills: r.skills,
            rules: r.rules,
          })}
        </span>
      ))}
    </div>
  );
}

export function ProjectDistribution() {
  const { t } = useTranslation(['distribution', 'common']);
  const projects = useAppStore((s) => s.projects);
  const platforms = useAppStore((s) => s.platforms);
  const fetchProjects = useAppStore((s) => s.fetchProjects);
  const fetchPlatforms = useAppStore((s) => s.fetchPlatforms);
  const addProject = useAppStore((s) => s.addProject);
  const removeProjects = useAppStore((s) => s.removeProjects);
  const setActiveNav = useAppStore((s) => s.setActiveNav);
  const setProjectDistSelectedProjectId = useAppStore(
    (s) => s.setProjectDistSelectedProjectId
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNameValue, setEditNameValue] = useState('');
  const [platformStats, setPlatformStats] = useState<
    Record<string, Record<string, PlatformEntryCount>>
  >({});
  const batch = useBatchMode();

  const selectedProjectsForDelete = useMemo(
    () => projects.filter((p) => batch.selectedIds.has(p.id)),
    [projects, batch.selectedIds]
  );

  const filteredProjects = useMemo(() => {
    const q = searchQuery.toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q));
  }, [projects, searchQuery]);

  useEffect(() => {
    fetchProjects();
    fetchPlatforms();
  }, []);

  // 每个项目 × 每个已启用平台并发统计技能/规则数（§22 整改项 2）。
  // dir_exists=false 或单项失败降级为 0，不阻塞列表。
  const enabledPlatforms = useMemo(
    () => platforms.filter((p) => p.enabled),
    [platforms]
  );
  useEffect(() => {
    if (projects.length === 0 || enabledPlatforms.length === 0) {
      setPlatformStats({});
      return;
    }
    let cancelled = false;
    (async () => {
      const next: Record<string, Record<string, PlatformEntryCount>> = {};
      await Promise.all(
        projects.map(async (project) => {
          const perPlatform: Record<string, PlatformEntryCount> = {};
          await Promise.all(
            enabledPlatforms.map(async (platform) => {
              try {
                const res = await ipc.countPlatformEntries(
                  platform.id,
                  project.path
                );
                perPlatform[platform.id] = res;
              } catch {
                perPlatform[platform.id] = {
                  platform_id: platform.id,
                  skills: 0,
                  rules: 0,
                  dir_exists: false,
                };
              }
            })
          );
          next[project.id] = perPlatform;
        })
      );
      if (!cancelled) setPlatformStats(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [projects, enabledPlatforms]);

  // 「去工作区分发」：携带项目上下文跳转到共享工作区（§7.8）。
  // 同时清空资源库「去分发」可能残留的临时选择，避免与项目上下文混用。
  const goDistribute = (projectId: string) => {
    setProjectDistSelectedProjectId(projectId);
    useAppStore.getState().setPendingDistributionSelection(null);
    setActiveNav('globalDistribution');
  };

  const commitRename = async (projectId: string, name: string) => {
    if (name.trim() && projectId) {
      await ipc.renameProject(projectId, name.trim());
      await fetchProjects();
    }
    setEditingId(null);
  };

  const handleBatchDelete = async () => {
    if (batch.selectedCount === 0) return;
    await removeProjects([...batch.selectedIds]);
    setShowBatchDeleteConfirm(false);
    batch.exit();
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="page-toolbar flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="page-title mb-1 text-foreground">
            {t('projectTitle')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('projectSubtitle')}
          </p>
        </div>
        <div
          data-testid="project-page-actions"
          className="flex shrink-0 items-center gap-2"
        >
          <button
            aria-label="batchMode"
            onClick={batch.toggle}
            className={`inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2.5 text-sm font-medium text-foreground hover:bg-accent transition-colors ${
              batch.enabled ? 'bg-primary/10 border-primary/30' : ''
            }`}
          >
            <CheckSquare className="h-4 w-4" />
            {batch.enabled
              ? t('common:actions.exitSelect')
              : t('common:actions.batchSelect')}
          </button>
          <button
            onClick={() => setShowAddDialog(true)}
            className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> {t('addProject')}
          </button>
        </div>
      </div>

      {projects.length === 0 &&
      platforms.filter((p) => p.enabled).length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Folder className="h-10 w-10 mb-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold text-foreground mb-2">
            {t('noProjects')}
          </h2>
          <p className="text-sm text-muted-foreground mb-6 max-w-md">
            {t('noProjectsHint')}
          </p>
        </div>
      ) : platforms.filter((p) => p.enabled).length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <OctagonX className="h-10 w-10 mb-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold text-foreground mb-2">
            {t('noEnabledPlatforms') || '暂无启用的 Agent 平台'}
          </h2>
          <p className="text-sm text-muted-foreground mb-6 max-w-md">
            {t('noEnabledPlatformsHint') ||
              '请先在设置中开启至少一个 Agent 平台'}
          </p>
          <button
            onClick={() => useAppStore.getState().setActiveNav('settings')}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Settings className="h-4 w-4" /> {t('goToSettings') || '前往设置'}
          </button>
        </div>
      ) : (
        <>
          {/* 搜索行：位于标题行下一行 */}
          <div className="mb-3">
            <div className="relative w-[220px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('common:actions.searchProjects')}
                aria-label={t('common:actions.searchProjects')}
                className={SEARCH_INPUT_CLASSES}
              />
            </div>
          </div>

          {/* 项目管理列表 */}
          {filteredProjects.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              {searchQuery ? t('noMatchProjects') : t('noProjectsAdd')}
            </div>
          ) : (
            <ul className="space-y-2">
              {filteredProjects.map((project) => (
                <li
                  key={project.id}
                  data-testid={`project-card-${project.id}`}
                  className="group rounded-lg border border-border bg-card p-3"
                >
                  <div className="flex items-center gap-3">
                    {batch.enabled && (
                      <input
                        type="checkbox"
                        data-testid={`batch-check-${project.id}`}
                        aria-label={`select ${project.name}`}
                        checked={batch.isSelected(project.id)}
                        onChange={() => batch.toggleSelect(project.id)}
                        className="h-4 w-4 shrink-0"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      {editingId === project.id ? (
                        <input
                          type="text"
                          data-testid="rename-input"
                          value={editNameValue}
                          onChange={(e) => setEditNameValue(e.target.value)}
                          onBlur={() => commitRename(project.id, editNameValue)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              void commitRename(project.id, editNameValue);
                            }
                            if (e.key === 'Escape') {
                              setEditingId(null);
                            }
                          }}
                          autoFocus
                          className="w-full rounded border border-input bg-background px-2 py-1 text-sm"
                        />
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium">
                            {project.name}
                          </span>
                          <button
                            aria-label="renameProject"
                            data-testid={`project-rename-${project.id}`}
                            onClick={() => {
                              setEditingId(project.id);
                              setEditNameValue(project.name);
                            }}
                            className="shrink-0 rounded-md border border-border p-1 text-xs text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                      <div className="truncate text-xs text-muted-foreground">
                        {sanitizePath(project.path)}
                      </div>
                    </div>
                    <button
                      data-testid={`go-distribute-${project.id}`}
                      onClick={() => goDistribute(project.id)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
                    >
                      <Send className="h-3.5 w-3.5" />
                      {t('goDistributeInWorkspace')}
                    </button>
                  </div>
                  <ProjectStatsRow
                    projectId={project.id}
                    enabledPlatforms={enabledPlatforms}
                    stats={platformStats[project.id]}
                    t={t}
                  />
                </li>
              ))}
            </ul>
          )}

          <ProjectBatchBar
            enabled={batch.enabled}
            selectedCount={batch.selectedCount}
            selectedLabel={t('common:messages.selectedCount', {
              count: batch.selectedCount,
            })}
            guideLabel={t('common:batch.guide')}
            deleteLabel={t('common:batch.delete')}
            clearLabel={t('common:actions.cancelSelect')}
            exitLabel={t('common:batch.exit')}
            onDelete={() => setShowBatchDeleteConfirm(true)}
            onClear={batch.clear}
            onExit={batch.exit}
          />

          <AddProjectDialog
            open={showAddDialog}
            onClose={() => setShowAddDialog(false)}
            onConfirm={async ({ name, path }) => {
              await addProject(name, path);
              setShowAddDialog(false);
            }}
          />
        </>
      )}

      <ConfirmDialog
        open={showBatchDeleteConfirm}
        title={t('batchDeleteTitle', { count: batch.selectedCount })}
        message={t('batchDeleteMessage')}
        variant="danger"
        confirmLabel={t('batchDeleteConfirm')}
        onConfirm={handleBatchDelete}
        onCancel={() => setShowBatchDeleteConfirm(false)}
      >
        {selectedProjectsForDelete.length > 0 && (
          <div className="mb-6">
            <p className="mb-1 text-xs text-muted-foreground">
              {t('batchDeleteSummary')}
            </p>
            <ul className="max-h-40 overflow-y-auto rounded border border-border bg-background p-2 text-sm text-foreground">
              {selectedProjectsForDelete.map((p) => (
                <li key={p.id} className="truncate">
                  {p.name}
                </li>
              ))}
            </ul>
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}

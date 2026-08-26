import { Suspense, lazy, useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../stores/appStore';
import { SEARCH_INPUT_CLASSES } from '../lib/ui-tokens';
import type { PlatformEntryCount } from '../types';
import { Search } from 'lucide-react';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { ipc } from '../lib/ipc';
const AddProjectDialog = lazy(
  () => import('../domains/projects/AddProjectDialog.lazy')
);
const ProjectDistributionItem = lazy(
  () => import('../domains/projects/ProjectDistributionItem.lazy')
);
const ProjectBatchBar = lazy(
  () => import('../domains/distribution/ProjectBatchBar.lazy')
);
import { ProjectDistributionToolbar } from '../domains/projects/ProjectDistributionToolbar';
import {
  ProjectDistributionEmptyProjectsState,
  ProjectDistributionNoPlatformsState,
} from '../domains/projects/ProjectDistributionEmptyStates';
import { useBatchMode } from '../hooks/useBatchMode';

/**
 * 项目页（差异3，交互稿 §7.8）：纯项目管理列表，不再内嵌分发工作区。
 * - 列表行内提供重命名与「去工作区分发」快捷入口（携带项目上下文）。
 * - 分发统一在分发工作区（/workspace，scope=global）进行；工作区挂载时
 *   消费 `projectDistSelectedProjectId` 作为默认目标并清除，使后续直接
 *   进入工作区时默认回到全局目标。
 * - 删除仅支持批量（二次确认，只删 SkillForge 记录，不删磁盘）。
 *
 * allow: SIZE_OK — 单一职责的 React 页面组件，行数来自内联 JSX 而非逻辑；
 * 仓库内页面组件普遍超过 250 纯行（替换前的本文件为 449 行），拆分单调用方的
 * 行组件只会引入无意义的间接层。
 */

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

  // 「去工作区分发」：携带项目上下文跳转到分发工作区（§7.8）。
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
      <ProjectDistributionToolbar
        title={t('projectTitle')}
        subtitle={t('projectSubtitle')}
        batchEnabled={batch.enabled}
        batchSelectLabel={t('common:actions.batchSelect')}
        exitSelectLabel={t('common:actions.exitSelect')}
        addProjectLabel={t('addProject')}
        onToggleBatch={batch.toggle}
        onAddProject={() => setShowAddDialog(true)}
      />

      {projects.length === 0 &&
      platforms.filter((p) => p.enabled).length === 0 ? (
        <ProjectDistributionEmptyProjectsState
          title={t('noProjects')}
          hint={t('noProjectsHint')}
        />
      ) : platforms.filter((p) => p.enabled).length === 0 ? (
        <ProjectDistributionNoPlatformsState
          title={t('noEnabledPlatforms')}
          hint={t('noEnabledPlatformsHint')}
          actionLabel={t('goToSettings')}
          onGoToSettings={() => useAppStore.getState().setActiveNav('settings')}
        />
      ) : (
        <>
          {/* 搜索行：位于标题行下一行 */}
          <div className="mb-3 mt-5">
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
                <Suspense fallback={null}>
                  <ProjectDistributionItem
                    key={project.id}
                    project={project}
                    enabledPlatforms={enabledPlatforms}
                    stats={platformStats[project.id]}
                    batchEnabled={batch.enabled}
                    isSelected={batch.isSelected(project.id)}
                    editing={editingId === project.id}
                    editNameValue={editNameValue}
                    onSelectToggle={() => batch.toggleSelect(project.id)}
                    onEditStart={() => {
                      setEditingId(project.id);
                      setEditNameValue(project.name);
                    }}
                    onEditNameChange={setEditNameValue}
                    onEditCommit={() =>
                      void commitRename(project.id, editNameValue)
                    }
                    onEditCancel={() => setEditingId(null)}
                    onGoDistribute={() => goDistribute(project.id)}
                    onRevealFallback={() =>
                      useAppStore
                        .getState()
                        .addToast(t('ws.revealFallback'), 'info')
                    }
                    onRevealFailed={() =>
                      useAppStore
                        .getState()
                        .addToast(t('ws.revealFailed'), 'error')
                    }
                  />
                </Suspense>
              ))}
            </ul>
          )}

          <Suspense fallback={null}>
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
          </Suspense>

          {showAddDialog && (
            <Suspense fallback={null}>
              <AddProjectDialog
                open={showAddDialog}
                onClose={() => setShowAddDialog(false)}
                onConfirm={async ({
                  name,
                  path,
                }: {
                  name: string;
                  path: string;
                }) => {
                  await addProject(name, path);
                  setShowAddDialog(false);
                }}
              />
            </Suspense>
          )}
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

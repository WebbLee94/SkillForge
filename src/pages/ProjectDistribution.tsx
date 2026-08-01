import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../stores/appStore';
import { sanitizePath } from '../lib/utils';
import { getPlatformIcon } from '../components/icons/PlatformIcons';
import { PlatformButton } from '../components/PlatformButton';
import { Plus, Trash2, Settings, ChevronDown, Folder, OctagonX, Pencil, FolderOpen, Maximize2, X } from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import Editor from '@monaco-editor/react';
import { FileTree } from '../components/FileTree';
import { DistributeDialog } from '../components/DistributeDialog';
import { ipc } from '../lib/ipc';
import { AddProjectDialog } from '../components/AddProjectDialog';
import type { Platform, PlatformEntryCount } from '../types';

const EXT_TO_LANG: Record<string, string> = {
  md: 'markdown', ts: 'typescript', tsx: 'typescript',
  js: 'javascript', jsx: 'javascript', json: 'json',
  xml: 'xml', yaml: 'yaml', yml: 'yaml',
  toml: 'ini', rs: 'rust', py: 'python',
  sh: 'shell', bash: 'shell', css: 'css',
  html: 'html', sql: 'sql', go: 'go',
  java: 'java', kt: 'kotlin', vue: 'html',
  svelte: 'html', rb: 'ruby',
};

const detectLang = (filename: string): string => {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return EXT_TO_LANG[ext] || 'plaintext';
};

export function ProjectDistribution() {
  const { t } = useTranslation(['distribution', 'common']);
  const projects = useAppStore((s) => s.projects);
  const platforms = useAppStore((s) => s.platforms);
  const fetchProjects = useAppStore((s) => s.fetchProjects);
  const fetchPlatforms = useAppStore((s) => s.fetchPlatforms);
  const addProject = useAppStore((s) => s.addProject);
  const removeProject = useAppStore((s) => s.removeProject);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(''); // eslint-disable-line @typescript-eslint/no-unused-vars
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [dropdownRect, setDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');
  const [fullScreen, setFullScreen] = useState(false);
  const [distributeOpen, setDistributeOpen] = useState(false);
  const [counts, setCounts] = useState<Record<string, PlatformEntryCount>>({});
  const dropdownRef = useRef<HTMLDivElement>(null);

  const enabledPlatforms = platforms.filter((p) => p.enabled) as Platform[];
  const enabledIds = enabledPlatforms.map((p) => p.id).join(',');

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) || null,
    [projects, selectedProjectId]
  );

  useEffect(() => {
    const ids = enabledPlatforms.map((p) => p.id);
    if (ids.length === 0) return;
    const pp = selectedProject?.path;
    let cancelled = false;
    Promise.all(
      ids.map((id) => ipc.countPlatformEntries(id, pp).catch(() => null))
    ).then((results) => {
      if (cancelled) return;
      const next: Record<string, PlatformEntryCount> = {};
      for (const r of results) {
        if (r) next[r.platform_id] = r;
      }
      setCounts(next);
    });
    return () => { cancelled = true; };
  }, [enabledIds, selectedProjectId]);

  const hasContent = (id: string) =>
    counts[id]?.dir_exists ?? false;

  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen]);

  const openInFinder = async (filePath: string) => {
    try {
      const { openPath } = await import('@tauri-apps/plugin-opener');
      await openPath(filePath);
    } catch (e) {
      console.error('openInFinder failed:', e);
    }
  };

  const filteredProjects = useMemo(() => {
    const q = searchQuery.toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q));
  }, [projects, searchQuery]);


  useEffect(() => {
    fetchProjects();
    fetchPlatforms();
  }, []);

  // 项目级记忆和默认选中
  useEffect(() => {
    if (projects.length === 0) {
      setSelectedProjectId(null);
      useAppStore.getState().setProjectDistSelectedProjectId(null);
      return;
    }
    const saved = useAppStore.getState().projectDistSelectedProjectId;
    if (saved && projects.some(p => p.id === saved)) {
      setSelectedProjectId(saved);
    } else {
      setSelectedProjectId(projects[0].id);
      useAppStore.getState().setProjectDistSelectedProjectId(projects[0].id);
    }
  }, [projects]);

  // 项目切换时重置子选择
  useEffect(() => {
    if (!selectedProjectId) return;
    setSelectedPlatform(null);
    setPreviewFile(null);
    setPreviewContent('');
  }, [selectedProjectId]);

  // 平台记忆和默认选中：记忆 → 第一个有内容平台 → 第一个启用平台
  useEffect(() => {
    if (!selectedProjectId || enabledPlatforms.length === 0) return;
    if (selectedPlatform && enabledPlatforms.some((p) => p.id === selectedPlatform)) return;
    const saved = useAppStore.getState().projectDistSelectedPlatform;
    if (saved && enabledPlatforms.some((p) => p.id === saved)) {
      setSelectedPlatform(saved);
      return;
    }
    const withContent = enabledPlatforms.find((p) => hasContent(p.id));
    setSelectedPlatform((withContent ?? enabledPlatforms[0]).id);
  }, [selectedProjectId, enabledIds, counts, selectedPlatform, enabledPlatforms]);

  const handleRemove = async () => {
    if (!confirmDeleteId) return;
    await removeProject(confirmDeleteId);
    if (selectedProjectId === confirmDeleteId) {
      setSelectedProjectId(null);
      setSelectedPlatform(null);
    }
    setConfirmDeleteId(null);
  };

  const getPlatformDir = (platformId: string): string => {
    const p = platforms.find((p) => p.id === platformId);
    if (!p?.paths?.project_skills_pattern) return `/.${platformId}/`;
    const cleaned = p.paths.project_skills_pattern.replace('{project}/', '');
    const parts = cleaned.split('/').filter(Boolean);
    return '/' + parts.slice(0, -1).join('/') + '/';
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      <h1 className="text-2xl font-bold text-foreground mb-1">{t('projectTitle')}</h1>
      <p className="text-sm text-muted-foreground mb-6">{t('projectSubtitle')}</p>

      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Folder className="h-10 w-10 mb-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold text-foreground mb-2">
{t('noProjects')}
          </h2>
          <p className="text-sm text-muted-foreground mb-6 max-w-md">
            {t('noProjectsHint')}
          </p>
          <button onClick={() => setShowAddDialog(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            <Plus className="h-4 w-4" /> {t('addProject')}
          </button>
        </div>
      ) : enabledPlatforms.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <OctagonX className="h-10 w-10 mb-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold text-foreground mb-2">
            {t('noEnabledPlatforms') || '暂无启用的 Agent 平台'}
          </h2>
          <p className="text-sm text-muted-foreground mb-6 max-w-md">
            {t('noEnabledPlatformsHint') || '请先在设置中开启至少一个 Agent 平台'}
          </p>
          <button onClick={() => useAppStore.getState().setActiveNav('settings')}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            <Settings className="h-4 w-4" /> {t('goToSettings') || '前往设置'}
          </button>
        </div>
      ) : (
        <>
          {/* Section 1: Project selector — searchable dropdown */}
          <div className="mb-6">
            <div className="flex items-center gap-3">
              <div ref={dropdownRef} className="relative flex-1 max-w-[400px]">
                <button onClick={() => {
                    setDropdownOpen(!dropdownOpen);
                    if (!dropdownOpen) {
                      const btn = dropdownRef.current?.querySelector('button');
                      if (btn) {
                        const rect = btn.getBoundingClientRect();
                        setDropdownRect({ top: rect.bottom + 4, left: rect.left, width: rect.width });
                      }
                    } else {
                      setDropdownRect(null);
                    }
                  }}
                  className="w-full flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-sm hover:border-primary/50 transition-colors">
                  {selectedProject ? (
                    <span className="truncate">{selectedProject.name}</span>
                  ) : (
                    <span className="text-muted-foreground">
                      {t('selectProjectPlaceholder') || '选择项目...'}
                    </span>
                  )}
                  <ChevronDown className="h-4 w-4 ml-auto text-muted-foreground" />
                </button>

                {dropdownOpen && dropdownRect && (
                  <div
                    className="fixed z-50 rounded-lg border border-border bg-card shadow-lg"
                    style={{ top: dropdownRect.top, left: dropdownRect.left, width: dropdownRect.width }}
                  >
                    <div className="p-2">
                      <input autoFocus type="text" value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={t('common:actions.searchProjects')}
                        className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm" />
                    </div>
                    <div className="max-h-[240px] overflow-y-auto border-t border-border">
                      {filteredProjects.length === 0 ? (
                        <div className="py-6 text-center text-sm text-muted-foreground">
                          {searchQuery ? t('noMatchProjects') : t('noProjectsAdd')}
                        </div>
                      ) : (
                        filteredProjects.map((project) => (
                          <div key={project.id}
                            onClick={() => {
                              setSelectedProjectId(project.id);
                              useAppStore.getState().setProjectDistSelectedProjectId(project.id);
                              setSelectedPlatform(null);
                              setPreviewFile(null);
                              setPreviewContent('');
                              setDropdownOpen(false);
                            }}
                            className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-accent/50 transition-colors text-sm">
                            <div className="flex-1 min-w-0">
                              <div className="truncate font-medium">{project.name}</div>
                              {selectedProjectId === project.id && (
                                <div className="text-xs text-muted-foreground truncate">{project.path}</div>
                              )}
                            </div>
                            {selectedProjectId === project.id && <span className="text-primary text-xs">✓</span>}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              <button onClick={() => setShowAddDialog(true)}
                className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                <Plus className="h-4 w-4" /> {t('addProject')}
              </button>
              {selectedProject && (
                <button onClick={() => setConfirmDeleteId(selectedProject.id)}
                  className="inline-flex items-center gap-1 rounded-lg bg-secondary px-3 py-2.5 text-sm text-secondary-foreground hover:bg-secondary/80">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Rename inline */}
            {selectedProject && !editingName && (
              <div className="flex items-center gap-2 mt-2 mb-1 px-1 group">
                <span className="text-sm font-medium">{selectedProject.name}</span>
                <button onClick={() => { setEditNameValue(selectedProject.name); setEditingName(true); }}
                  className="text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"><Pencil className="h-3.5 w-3.5" /></button>
              </div>
            )}
            {selectedProject && editingName && (
              <input
                type="text"
                value={editNameValue}
                onChange={(e) => setEditNameValue(e.target.value)}
                onBlur={async () => {
                  if (editNameValue.trim() && selectedProject) {
                    await ipc.renameProject(selectedProject.id, editNameValue.trim());
                    await fetchProjects();
                  }
                  setEditingName(false);
                }}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter') {
                    if (editNameValue.trim() && selectedProject) {
                      await ipc.renameProject(selectedProject.id, editNameValue.trim());
                      await fetchProjects();
                    }
                    setEditingName(false);
                  }
                  if (e.key === 'Escape') {
                    setEditingName(false);
                  }
                }}
                className="rounded border border-input bg-background px-2 py-1 text-sm mt-2 mb-1"
                autoFocus
              />
            )}
          </div>

          {selectedProject && (
            <>
              {/* Section 2: Platform selector */}
              <div className="mb-6">
                <label className="mb-2 block text-sm font-medium text-foreground">{t('selectTargetPlatform') || '选择目标平台'}</label>
                <div className="flex gap-2 flex-wrap">
                  {enabledPlatforms.map((platform) => {
                    const cnt = counts[platform.id];
                    return (
                      <PlatformButton
                        key={platform.id}
                        name={platform.name}
                        icon={getPlatformIcon(platform.id)}
                        skillCount={cnt?.skills ?? 0}
                        ruleCount={cnt?.rules ?? 0}
                        isInstalled={hasContent(platform.id)}
                        isSelected={selectedPlatform === platform.id}
                        onClick={() => {
                          setSelectedPlatform(platform.id);
                          useAppStore.getState().setProjectDistSelectedPlatform(platform.id);
                        }}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Section 3: File tree + Monaco preview */}
              {selectedPlatform && (
                <div className="mb-6">
                  <label className="mb-2 block text-sm font-medium text-foreground">
                    <FolderOpen className="h-4 w-4 inline" /> {sanitizePath(selectedProject.path)}{getPlatformDir(selectedPlatform)}
                    <span className="font-normal opacity-60 text-xs ml-2">
                      {t('skillRuleCount', { skills: counts[selectedPlatform]?.skills ?? 0, rules: counts[selectedPlatform]?.rules ?? 0 })}
                    </span>
                  </label>
                  <div className="flex gap-3 min-h-[350px]">
                    <div className="w-1/3 font-mono text-xs bg-muted/50 rounded-lg p-3 overflow-y-auto border border-border max-h-[350px]">
                      <FileTree
                        rootPath={selectedProject.path + getPlatformDir(selectedPlatform)}
                        onFileSelect={async (filePath) => {
                          const result = await ipc.readFileContent(filePath);
                          setPreviewFile(filePath);
                          setPreviewContent(result.is_text ? result.content : null);
                        }}
                      />
                    </div>
                    <div className="flex-1 bg-muted/50 rounded-lg p-3 border border-border flex flex-col h-[350px]">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium opacity-60">
                          {t('clickToPreview') || '单击左侧文件预览'}
                        </span>
                        {previewFile && (
                          <button onClick={() => setFullScreen(true)}
                            className="text-xs opacity-40 hover:opacity-100"><Maximize2 className="h-3.5 w-3.5 inline" /> {t('fullscreen')}</button>
                        )}
                      </div>
                      {previewFile ? (
                        previewContent !== null ? (
                          <div className="flex-1 rounded overflow-hidden border border-border">
                            <Editor height="100%" language={detectLang(previewFile)}
                              theme="vs-dark" value={previewContent}
                              options={{ readOnly: true, minimap: { enabled: false }, fontSize: 13, lineNumbers: 'on',
                                scrollBeyondLastLine: false, wordWrap: 'on', folding: true, automaticLayout: true }} />
                          </div>
                        ) : (
                          <div className="flex items-center justify-center h-[200px] text-sm text-muted-foreground bg-muted/30 rounded">
                            <span>{t('cannotPreview')}</span>
                          </div>
                        )
                      ) : (
                        <div className="flex items-center justify-center h-[200px] text-xs text-muted-foreground opacity-50">
                          {t('clickToPreview') || '单击左侧文件预览'}
                        </div>
                      )}
                      <div className="mt-auto flex justify-between text-xs opacity-50 border-t border-border pt-2">
                        <span>{t('textPreviewOnly')}</span>
                        <button onClick={() => previewFile && openInFinder(previewFile)}
                          className="underline cursor-pointer hover:opacity-100">
                          <FolderOpen className="h-3.5 w-3.5 inline" /> {t('openInFinder') || '在 Finder 中打开'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Section 4: Distribute button */}
              <div className="flex justify-end">
                <button onClick={() => setDistributeOpen(true)} disabled={!selectedPlatform}
                  className={`px-6 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    selectedPlatform && selectedProject
                      ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                      : 'bg-muted text-muted-foreground cursor-not-allowed'
                  }`}>
                  {selectedPlatform && selectedProject
                    ? t('distributeTo', { name: `${enabledPlatforms.find((p) => p.id === selectedPlatform)?.name || selectedPlatform}（项目 ${selectedProject.name}）` })
                    : t('selectPlatformFirst')}
                </button>
              </div>
            </>
          )}

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

      {/* Fullscreen Monaco modal */}
      {fullScreen && previewFile && (
        <div className="fixed inset-0 z-50 bg-black/80 flex flex-col p-4">
          <div className="flex justify-between items-center mb-2 text-white">
            <span className="text-sm font-medium">{previewFile}</span>
            <button onClick={() => setFullScreen(false)} className="text-white/70 hover:text-white"><X className="h-5 w-5" /></button>
          </div>
          <div className="flex-1 rounded overflow-hidden">
            <Editor height="100%" language={detectLang(previewFile)} theme="vs-dark"
              value={previewContent || ''}
              options={{ readOnly: true, minimap: { enabled: false }, fontSize: 14, wordWrap: 'on', automaticLayout: true }} />
          </div>
        </div>
      )}

      <DistributeDialog
        open={distributeOpen}
        onClose={() => setDistributeOpen(false)}
        scope="project"
        project={selectedProject}
        initialPlatformId={selectedPlatform}
        onDistributed={() => fetchPlatforms()}
      />

      <ConfirmDialog
        open={confirmDeleteId !== null}
        title={t('confirmDeleteTitle')}
        message={t('confirmDeleteMessage')}
        variant="danger"
        confirmLabel={t('delete')}
        onConfirm={handleRemove}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}

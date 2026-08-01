import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../stores/appStore';
import { cn } from '../lib/utils';
import { getPlatformIcon } from '../components/icons/PlatformIcons';
import { PlatformButton } from '../components/PlatformButton';
import { Settings, FolderOpen, Maximize2, OctagonX, X } from 'lucide-react';
import Editor from '@monaco-editor/react';
import { FileTree } from '../components/FileTree';
import { DistributeDialog } from '../components/DistributeDialog';
import { ipc } from '../lib/ipc';
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

export function GlobalDistribution() {
  const { t } = useTranslation('distribution');
  const platforms = useAppStore((s) => s.platforms);
  const fetchPlatforms = useAppStore((s) => s.fetchPlatforms);

  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [fullScreen, setFullScreen] = useState(false);
  const [distributeOpen, setDistributeOpen] = useState(false);
  const [counts, setCounts] = useState<Record<string, PlatformEntryCount>>({});

  const enabledPlatforms = platforms.filter((p) => p.enabled) as Platform[];
  const enabledIds = enabledPlatforms.map((p) => p.id).join(',');

  // 拉取各平台真实文件系统计数（技能 = skills/ 子目录数，规则 = rules/ 文件数）
  useEffect(() => {
    const ids = enabledPlatforms.map((p) => p.id);
    if (ids.length === 0) return;
    let cancelled = false;
    Promise.all(
      ids.map((id) => ipc.countPlatformEntries(id).catch(() => null))
    ).then((results) => {
      if (cancelled) return;
      const next: Record<string, PlatformEntryCount> = {};
      for (const r of results) {
        if (r) next[r.platform_id] = r;
      }
      setCounts(next);
    });
    return () => { cancelled = true; };
  }, [enabledIds]);

  const hasContent = (id: string) =>
    (counts[id]?.skills ?? 0) + (counts[id]?.rules ?? 0) > 0;

  // 默认选中：URL/记忆平台 → 第一个有内容的平台 → 第一个启用平台
  useEffect(() => {
    if (enabledPlatforms.length === 0) return;
    if (selectedPlatform && enabledPlatforms.some((p) => p.id === selectedPlatform)) return;
    const store = useAppStore.getState();
    const saved = store.globalDistSelectedPlatform;
    if (saved && enabledPlatforms.some(p => p.id === saved)) {
      setSelectedPlatform(saved);
      return;
    }
    const withContent = enabledPlatforms.find((p) => hasContent(p.id));
    setSelectedPlatform((withContent ?? enabledPlatforms[0]).id);
  }, [enabledIds, counts, selectedPlatform, enabledPlatforms]);

  useEffect(() => {
    fetchPlatforms();
  }, []);

  const handleSelectPlatform = (id: string) => {
    setSelectedPlatform(id);
    useAppStore.getState().setGlobalDistSelectedPlatform(id);
    setPreviewFile(null);
    setPreviewContent(null);
  };

  const getPlatformDir = (platformId: string): string => {
    const p = platforms.find((p) => p.id === platformId);
    if (!p?.paths?.global_skills_dir) return `~/.${platformId}/`;
    const parts = p.paths.global_skills_dir.split("/").filter(Boolean);
    return parts.slice(0, -1).join("/") + "/";
  };

  const openInFinder = async (filePath: string) => {
    try {
      const { openPath } = await import('@tauri-apps/plugin-opener');
      await openPath(filePath);
    } catch (e) {
      console.error('openInFinder failed:', e);
    }
  };

  const selectedPlatformName = enabledPlatforms.find((p) => p.id === selectedPlatform)?.name;
  const selectedCount = selectedPlatform ? counts[selectedPlatform] : undefined;

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      <h1 className="text-2xl font-bold text-foreground mb-1">
        {t('globalTitle')}
      </h1>
      <p className="text-sm text-muted-foreground mb-6">
        {t('globalSubtitle')}
      </p>

      {enabledPlatforms.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <OctagonX className="h-10 w-10 mb-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold text-foreground mb-2">
            {t('noEnabledPlatforms') || '暂无启用的 Agent 平台'}
          </h2>
          <p className="text-sm text-muted-foreground mb-6 max-w-md">
            {t('noEnabledPlatformsHint') || '请先在设置中开启至少一个 Agent 平台'}
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
          <div className="mb-6">
            <label className="mb-2 block text-sm font-medium text-foreground">
              {t('selectTargetPlatform') || '选择目标平台'}
            </label>
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
                    isInstalled={cnt?.dir_exists ?? false}
                    isSelected={selectedPlatform === platform.id}
                    onClick={() => handleSelectPlatform(platform.id)}
                  />
                );
              })}
            </div>
          </div>

          {selectedPlatform && (
            <>
              <div className="mb-6">
                <label className="mb-2 block text-sm font-medium text-foreground">
                  <FolderOpen className="h-4 w-4 inline" /> {getPlatformDir(selectedPlatform)}
                  <span className="font-normal opacity-60 text-xs ml-2">
                    {t('skillRuleCount', { skills: selectedCount?.skills ?? 0, rules: selectedCount?.rules ?? 0 })}
                  </span>
                </label>
                <div className="flex gap-3 min-h-[350px]">
                  <div className="w-1/3 font-mono text-xs bg-muted/50 rounded-lg p-3 overflow-y-auto border border-border max-h-[350px]">
                    <FileTree
                      rootPath={getPlatformDir(selectedPlatform)}
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
                        {previewFile || (t('clickToPreview') || '单击左侧文件预览')}
                      </span>
                      {previewFile && (
                        <button onClick={() => setFullScreen(true)}
                          className="text-xs opacity-40 hover:opacity-100">
                          <Maximize2 className="h-3.5 w-3.5 inline" /> {t('fullscreen')}
                        </button>
                      )}
                    </div>
                    {previewFile ? (
                      previewContent !== null ? (
                        <div className="flex-1 rounded overflow-hidden border border-border">
                          <Editor
                            height="100%"
                            language={detectLang(previewFile)}
                            theme="vs-dark"
                            value={previewContent}
                            options={{
                              readOnly: true,
                              minimap: { enabled: false },
                              fontSize: 13,
                              lineNumbers: 'on',
                              scrollBeyondLastLine: false,
                              wordWrap: 'on',
                              folding: true,
                              automaticLayout: true,
                            }}
                          />
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

              <div className="flex justify-end">
                <button
                  onClick={() => setDistributeOpen(true)}
                  disabled={!selectedPlatform}
                  className={cn(
                    'px-6 py-2.5 rounded-lg text-sm font-medium transition-colors',
                    selectedPlatform
                      ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                      : 'bg-muted text-muted-foreground cursor-not-allowed'
                  )}
                >
                  {selectedPlatform
                    ? t('distributeTo', { name: selectedPlatformName || selectedPlatform })
                    : t('selectPlatformFirst')}
                </button>
              </div>
            </>
          )}
        </>
      )}

      {fullScreen && previewFile && (
        <div className="fixed inset-0 z-50 bg-black/80 flex flex-col p-4">
          <div className="flex justify-between items-center mb-2 text-white">
            <span className="text-sm font-medium opacity-60">{t('fullscreenPreview')}</span>
            <button onClick={() => setFullScreen(false)}
              className="text-white/70 hover:text-white"><X className="h-5 w-5" /></button>
          </div>
          <div className="flex-1 rounded overflow-hidden">
            <Editor
              height="100%"
              language={detectLang(previewFile)}
              theme="vs-dark"
              value={previewContent || ''}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                fontSize: 14,
                wordWrap: 'on',
                automaticLayout: true,
              }}
            />
          </div>
        </div>
      )}

      <DistributeDialog
        open={distributeOpen}
        onClose={() => setDistributeOpen(false)}
        scope="global"
        initialPlatformId={selectedPlatform}
        onDistributed={() => {
          fetchPlatforms();
        }}
      />
    </div>
  );
}

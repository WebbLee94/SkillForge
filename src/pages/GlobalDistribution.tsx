import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../stores/appStore';
import { cn } from '../lib/utils';
import { getPlatformIcon } from '../components/icons/PlatformIcons';
import { Search } from 'lucide-react';
import type { Platform } from '../types';

export function GlobalDistribution() {
  const { t } = useTranslation('distribution');
  const platforms = useAppStore((s) => s.platforms);
  const skills = useAppStore((s) => s.skills);
  const rules = useAppStore((s) => s.rules);
  const scenes = useAppStore((s) => s.scenes);
  const fetchScenes = useAppStore((s) => s.fetchScenes);
  const fetchSkills = useAppStore((s) => s.fetchSkills);
  const fetchRules = useAppStore((s) => s.fetchRules);
  const fetchPlatforms = useAppStore((s) => s.fetchPlatforms);
  const syncScene = useAppStore((s) => s.syncScene);
  const addToast = useAppStore((s) => s.addToast);

  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [selectedRules, setSelectedRules] = useState<string[]>([]);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [skillSearch, setSkillSearch] = useState('');
  const [expandedDirs, setExpandedDirs] = useState<string[]>(['skills']);
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string>('');

  const enabledPlatforms = platforms.filter((p) => p.enabled) as Platform[];

  const filteredSkills = useMemo(() => {
    const q = skillSearch.toLowerCase();
    if (!q) return skills;
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.description || '').toLowerCase().includes(q)
    );
  }, [skills, skillSearch]);

  const filteredRules = useMemo(() => {
    const q = skillSearch.toLowerCase();
    if (!q) return rules;
    return rules.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.description || '').toLowerCase().includes(q)
    );
  }, [rules, skillSearch]);

  useEffect(() => {
    fetchScenes();
    fetchSkills();
    fetchRules();
    fetchPlatforms();
  }, []);

  const toggleSkill = (id: string) => {
    setSelectedSkills((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const toggleRule = (id: string) => {
    setSelectedRules((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]
    );
  };

  const handleDistribute = async () => {
    if (!selectedPlatform) return;
    await syncScene(
      selectedSkills,
      selectedRules,
      selectedSceneId,
      [selectedPlatform],
      'global'
    );
    addToast('分发完成', 'success');
    await fetchSkills();
    await fetchRules();
  };

  const getPlatformDir = (platformId: string): string => {
    const map: Record<string, string> = {
      'claude-code': '~/.claude/',
      cursor: '~/.cursor/',
      opencode: '~/.opencode/',
      trae: '~/.trae/',
      'trae-cn': '~/.trae-cn/',
      codebuddy: '~/.codebuddy/',
      'codebuddy-cn': '~/.codebuddy-cn/',
      codex: '~/.codex/',
      hermes: '~/.hermes/',
      openclaw: '~/.openclaw/',
      antigravity: '~/.antigravity/',
      windsurf: '~/.windsurf/',
    };
    return map[platformId] || `~/.${platformId}/`;
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      <h1 className="text-2xl font-bold text-foreground mb-1">
        {t('globalTitle')}
      </h1>
      <p className="text-sm text-muted-foreground mb-6">
        {t('globalSubtitle')}
      </p>

      {/* Section 1: Platform selector — single-select, enabled only, with logos */}
      <div className="mb-6">
        <label className="mb-2 block text-sm font-medium text-foreground">
          {t('selectTargetPlatform')}
        </label>
        <div className="flex gap-2 flex-wrap">
          {enabledPlatforms.map((platform) => {
            const isSelected = selectedPlatform === platform.id;
            const IconComp = getPlatformIcon(platform.id);
            return (
              <button
                key={platform.id}
                onClick={() => setSelectedPlatform(platform.id)}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors',
                  isSelected
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-card text-foreground hover:border-primary/50 hover:bg-accent/50'
                )}
              >
                {IconComp && <IconComp className="h-5 w-5 shrink-0" />}
                <span>{platform.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Section 2: Local file tree + content preview */}
      {selectedPlatform && (
        <div className="mb-6">
          <label className="mb-2 block text-sm font-medium text-foreground">
            📂 {getPlatformDir(selectedPlatform)}
            <span className="font-normal opacity-60 text-xs ml-2">
              技能 {filteredSkills.length} · 规则 {filteredRules.length}
            </span>
          </label>
          <div className="flex gap-3 min-h-[150px]">
            {/* Left: File tree */}
            <div className="flex-1 font-mono text-xs bg-muted/50 rounded-lg p-3 overflow-y-auto max-h-[200px] border border-border">
              <div
                className="cursor-pointer py-1 px-1 rounded hover:bg-muted transition-colors"
                onClick={() =>
                  setExpandedDirs((prev) =>
                    prev.includes('skills')
                      ? prev.filter((d) => d !== 'skills')
                      : [...prev, 'skills']
                  )
                }
              >
                {expandedDirs.includes('skills') ? '📂' : '📁'} skills/
              </div>
              {expandedDirs.includes('skills') &&
                filteredSkills.slice(0, 15).map((skill) => (
                  <div
                    key={skill.id}
                    className="pl-4 py-0.5 px-1 rounded cursor-pointer hover:bg-accent/50 transition-colors"
                    onClick={() => {
                      setPreviewFile(`${skill.name}/SKILL.md`);
                      setPreviewContent(
                        `---\nname: ${skill.name}\ndescription: ${skill.description || '-'}\nversion: ${skill.current_ver || '-'}\n---`
                      );
                    }}
                    title={skill.description || ''}
                  >
                    📄 {skill.name}/
                  </div>
                ))}
              <div
                className="cursor-pointer py-1 px-1 rounded hover:bg-muted transition-colors mt-1"
                onClick={() =>
                  setExpandedDirs((prev) =>
                    prev.includes('rules')
                      ? prev.filter((d) => d !== 'rules')
                      : [...prev, 'rules']
                  )
                }
              >
                {expandedDirs.includes('rules') ? '📂' : '📁'} rules/
              </div>
              {expandedDirs.includes('rules') &&
                filteredRules.slice(0, 15).map((rule) => (
                  <div
                    key={rule.id}
                    className="pl-4 py-0.5 px-1 rounded cursor-pointer hover:bg-accent/50 transition-colors"
                    onClick={() => {
                      setPreviewFile(`${rule.name}.${rule.format}`);
                      setPreviewContent(
                        rule.content || rule.description || '(空内容)'
                      );
                    }}
                    title={
                      rule.description
                        ? `${rule.description}\nscope: ${rule.scope || 'global'}`
                        : `scope: ${rule.scope || 'global'}`
                    }
                  >
                    📄 {rule.name}.{rule.format}
                  </div>
                ))}
            </div>

            {/* Right: Content preview */}
            <div className="flex-1 bg-muted/50 rounded-lg p-3 border border-border">
              <div className="opacity-60 text-xs font-medium mb-1">
                {previewFile ? previewFile : '单击树节点 → 右侧预览'}
              </div>
              {previewFile ? (
                <div className="font-mono text-xs bg-background rounded p-2 max-h-[130px] overflow-hidden leading-relaxed whitespace-pre-wrap">
                  {previewContent || '(空内容)'}
                </div>
              ) : (
                <div className="flex items-center justify-center h-[100px] text-xs text-muted-foreground opacity-50">
                  单击左侧文件树节点预览内容
                </div>
              )}
              <div className="mt-2 flex justify-between text-xs opacity-40">
                <span>单击树节点预览 | 无法预览的文件提示从本地打开</span>
                <span className="underline cursor-pointer">
                  📂 在 Finder 中打开 →
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Section 3: Scene selector (optional) */}
      <div className="mb-4">
        <label className="mb-1.5 block text-sm font-medium text-foreground">
          {t('scenePackage')}{' '}
          <span className="font-normal opacity-50 text-xs">
            (可选 — 快速填充)
          </span>
        </label>
        <select
          value={selectedSceneId || ''}
          onChange={(e) => setSelectedSceneId(e.target.value || null)}
          className="w-full max-w-[400px] rounded-lg border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="">全部技能 + 规则（无场景过滤）</option>
          {scenes.map((scene) => (
            <option key={scene.id} value={scene.id}>
              {scene.name}
            </option>
          ))}
        </select>
      </div>

      {/* Section 4: Skills + Rules split columns */}
      <div className="mb-6">
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={skillSearch}
            onChange={(e) => setSkillSearch(e.target.value)}
            placeholder="🔍 搜索技能 / 规则..."
            className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <div className="flex gap-4 max-h-[250px] overflow-y-auto">
          {/* Left: Skills */}
          <div className="flex-1">
            <div className="text-xs font-semibold text-foreground mb-2">
              技能 ({filteredSkills.length})
            </div>
            <div className="space-y-1">
              {filteredSkills.map((skill) => (
                <div
                  key={skill.id}
                  onClick={() => toggleSkill(skill.id)}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors',
                    selectedSkills.includes(skill.id)
                      ? 'bg-primary/10 text-primary'
                      : 'bg-card border border-border hover:bg-accent/50'
                  )}
                  title={`${skill.name} v${skill.current_ver || '?'}\n${skill.description || ''}\n来源: ${skill.source_type}`}
                >
                  <span className="text-xs">
                    {selectedSkills.includes(skill.id) ? '☑' : '☐'}
                  </span>
                  <span className="flex-1 truncate">{skill.name}</span>
                  {skill.current_ver && (
                    <span className="text-xs opacity-50">
                      v{skill.current_ver}
                    </span>
                  )}
                </div>
              ))}
              {filteredSkills.length === 0 && (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  无匹配技能
                </p>
              )}
            </div>
          </div>
          {/* Right: Rules */}
          <div className="flex-1">
            <div className="text-xs font-semibold text-foreground mb-2">
              规则 ({filteredRules.length})
            </div>
            <div className="space-y-1">
              {filteredRules.map((rule) => (
                <div
                  key={rule.id}
                  onClick={() => toggleRule(rule.id)}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors',
                    selectedRules.includes(rule.id)
                      ? 'bg-primary/10 text-primary'
                      : 'bg-card border border-border hover:bg-accent/50'
                  )}
                  title={`${rule.name}.${rule.format}\n${rule.description || ''}\nscope: ${rule.scope || 'global'}`}
                >
                  <span className="text-xs">
                    {selectedRules.includes(rule.id) ? '☑' : '☐'}
                  </span>
                  <span className="flex-1 truncate">
                    {rule.name}.{rule.format}
                  </span>
                </div>
              ))}
              {filteredRules.length === 0 && (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  无匹配规则
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Section 5: Distribute button */}
      <div className="flex justify-end">
        <button
          onClick={handleDistribute}
          disabled={!selectedPlatform}
          className={cn(
            'px-6 py-2.5 rounded-lg text-sm font-medium transition-colors',
            selectedPlatform
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'bg-muted text-muted-foreground cursor-not-allowed'
          )}
        >
          {selectedPlatform
            ? `分发到 ${enabledPlatforms.find((p) => p.id === selectedPlatform)?.name || selectedPlatform} →`
            : '请先选择平台'}
        </button>
      </div>
    </div>
  );
}
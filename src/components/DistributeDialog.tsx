import { memo, useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../stores/appStore';
import { cn } from '../lib/utils';
import { X, Search } from 'lucide-react';
import { ipc } from '../lib/ipc';
import type { Platform, Project } from '../types';

interface DistributeDialogProps {
  open: boolean;
  onClose: () => void;
  scope: 'global' | 'project';
  project?: Project | null;
  initialPlatformId?: string | null;
  onDistributed?: () => void;
}

export const DistributeDialog = memo(function DistributeDialog({
  open,
  onClose,
  scope,
  project,
  initialPlatformId,
  onDistributed,
}: DistributeDialogProps) {
  const { t } = useTranslation('distribution');

  const platforms = useAppStore((s) => s.platforms);
  const skills = useAppStore((s) => s.skills);
  const rules = useAppStore((s) => s.rules);
  const scenes = useAppStore((s) => s.scenes);
  const syncScene = useAppStore((s) => s.syncScene);
  const addToast = useAppStore((s) => s.addToast);
  const fetchScenes = useAppStore((s) => s.fetchScenes);
  const fetchSkills = useAppStore((s) => s.fetchSkills);
  const fetchRules = useAppStore((s) => s.fetchRules);
const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [selectedRules, setSelectedRules] = useState<string[]>([]);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [skillSearch, setSkillSearch] = useState('');
  const [distributing, setDistributing] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const [sceneSkillIds, setSceneSkillIds] = useState<Set<string> | null>(null);
  const [sceneRuleIds, setSceneRuleIds] = useState<Set<string> | null>(null);

  const enabledPlatforms = platforms.filter((p) => p.enabled) as Platform[];

  // 打开时重置选择状态
  useEffect(() => {
    if (!open) return;
    setSelectedSkills([]);
    setSelectedRules([]);
    setSelectedSceneId(null);
    setSkillSearch('');
    setResultMsg(null);
    setSceneSkillIds(null);
    setSceneRuleIds(null);

    const store = useAppStore.getState();
    if (store.skills.length === 0) void fetchSkills();
    if (store.rules.length === 0) void fetchRules();
    if (store.scenes.length === 0) void fetchScenes();

    const fallback = scope === 'global'
      ? store.globalDistSelectedPlatform
      : store.projectDistSelectedPlatform;
    const candidate = initialPlatformId || fallback;
    if (candidate && enabledPlatforms.some((p) => p.id === candidate)) {
      setSelectedPlatform(candidate);
    } else if (enabledPlatforms.length > 0) {
      setSelectedPlatform(enabledPlatforms[0].id);
    } else {
      setSelectedPlatform(null);
    }
  }, [open, initialPlatformId, scope, enabledPlatforms, fetchSkills, fetchRules, fetchScenes]);

  // 场景详情（限定技能/规则列表）
  useEffect(() => {
    if (!open) return;
    if (!selectedSceneId) {
      setSceneSkillIds(null);
      setSceneRuleIds(null);
      return;
    }
    ipc.getSceneDetail(selectedSceneId).then((detail) => {
      setSceneSkillIds(new Set(detail.skills.map((s) => s.skill_id)));
      setSceneRuleIds(new Set(detail.rules.map((r) => r.rule_id)));
    });
  }, [open, selectedSceneId]);

  const filteredSkills = useMemo(() => {
    let list = selectedSceneId && sceneSkillIds
      ? skills.filter((s) => sceneSkillIds.has(s.id))
      : skills;
    const q = skillSearch.toLowerCase();
    if (!q) return list;
    return list.filter((s) => s.name.toLowerCase().includes(q));
  }, [skills, skillSearch, selectedSceneId, sceneSkillIds]);

  const filteredRules = useMemo(() => {
    let list = selectedSceneId && sceneRuleIds
      ? rules.filter((r) => sceneRuleIds.has(r.id))
      : rules;
    const q = skillSearch.toLowerCase();
    if (!q) return list;
    return list.filter((r) => r.name.toLowerCase().includes(q));
  }, [rules, skillSearch, selectedSceneId, sceneRuleIds]);

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
    setDistributing(true);
    setResultMsg(null);
    const result = await syncScene(
      selectedSkills,
      selectedRules,
      selectedSceneId,
      [selectedPlatform],
      scope,
      project?.id
    );
    setDistributing(false);
    if (result) {
      setResultMsg(result.errors.length === 0
        ? t('distributeSuccess')
        : t('distributeWarning', { count: result.errors.length }));
      addToast(t('distributeComplete'), 'success');
      await fetchSkills();
      await fetchRules();
      onDistributed?.();
    }
  };

  if (!open) return null;

  const selectedPlatformName = enabledPlatforms.find((p) => p.id === selectedPlatform)?.name;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[820px] max-h-[85vh] overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-xl animate-fade-in">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">
            {t('distributeDialogTitle', { name: selectedPlatformName || selectedPlatform })}
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        {selectedPlatform && (
          <>
            {/* 场景包 */}
            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                {t('scenePackageOptional')}
              </label>
              <select
                value={selectedSceneId || ''}
                onChange={(e) => {
                  setSelectedSceneId(e.target.value || null);
                  setSelectedSkills([]);
                  setSelectedRules([]);
                }}
                className="w-full max-w-[400px] rounded-lg border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">{t('allSkillsRules')}</option>
                {scenes.map((scene) => (
                  <option key={scene.id} value={scene.id}>{scene.name}</option>
                ))}
              </select>
            </div>

            {/* 技能/规则多选 */}
            <div className="mb-4">
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={skillSearch}
                  onChange={(e) => setSkillSearch(e.target.value)}
                  placeholder={t('searchSkillsRules')}
                  className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm"
                />
              </div>
              <div className="flex gap-4 max-h-[220px] overflow-y-auto">
                <div className="flex-1">
                  <div className="text-xs font-semibold text-foreground mb-2">
                    {t('skillsCount', { count: filteredSkills.length })}
                  </div>
                  <div className="space-y-1">
                    {filteredSkills.map((skill) => (
                      <div
                        key={skill.id}
                        onClick={() => toggleSkill(skill.id)}
                        className={cn(
                          'flex items-center gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors',
                          selectedSkills.includes(skill.id)
                            ? 'bg-primary/15 border border-primary text-primary'
                            : 'bg-card border border-border hover:bg-accent/50'
                        )}
                      >
                        <span className="text-xs">
                          {selectedSkills.includes(skill.id) ? '☑' : '☐'}
                        </span>
                        <span className="flex-1 truncate">{skill.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex-1">
                  <div className="text-xs font-semibold text-foreground mb-2">
                    {t('rulesCount', { count: filteredRules.length })}
                  </div>
                  <div className="space-y-1">
                    {filteredRules.map((rule) => (
                      <div
                        key={rule.id}
                        onClick={() => toggleRule(rule.id)}
                        className={cn(
                          'flex items-center gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors',
                          selectedRules.includes(rule.id)
                            ? 'bg-primary/15 border border-primary text-primary'
                            : 'bg-card border border-border hover:bg-accent/50'
                        )}
                      >
                        <span className="text-xs">
                          {selectedRules.includes(rule.id) ? '☑' : '☐'}
                        </span>
                        <span className="flex-1 truncate">{rule.name}.{rule.format}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* 结果反馈 */}
            {resultMsg && (
              <div className={cn(
                'mb-4 rounded-lg border px-3 py-2 text-sm',
                resultMsg.startsWith('✓')
                  ? 'border-success/40 bg-success/10 text-success'
                  : 'border-warning/40 bg-warning/10 text-warning'
              )}>
                {resultMsg}
              </div>
            )}
          </>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
          >
            {t('common:actions.cancel')}
          </button>
          <button
            onClick={handleDistribute}
            disabled={!selectedPlatform || distributing}
            className={cn(
              'px-6 py-2.5 rounded-lg text-sm font-medium transition-colors',
              selectedPlatform && !distributing
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-muted text-muted-foreground cursor-not-allowed'
            )}
          >
            {distributing
              ? t('distributing')
              : selectedPlatform
                ? t('distributeTo', { name: selectedPlatformName || selectedPlatform })
                : t('selectPlatformFirst')}
          </button>
        </div>
      </div>
    </div>
  );
});
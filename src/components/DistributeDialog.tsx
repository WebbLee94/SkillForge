import { memo, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../stores/appStore';
import { cn } from '../lib/utils';
import { X, Search, ShieldCheck, AlertTriangle } from 'lucide-react';
import { ipc } from '../lib/ipc';
import type { DistributionSelection, Platform, Project } from '../types';

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
  const requestSyncConfirm = useAppStore((s) => s.requestSyncConfirm);
  const executeDistribution = useAppStore((s) => s.executeDistribution);
  const takeConfirmedDistribution = useAppStore((s) => s.takeConfirmedDistribution);
  const addToast = useAppStore((s) => s.addToast);
  const fetchScenes = useAppStore((s) => s.fetchScenes);
  const fetchSkills = useAppStore((s) => s.fetchSkills);
  const fetchRules = useAppStore((s) => s.fetchRules);
  const managedState = useAppStore((s) => s.managedDistributionState);
  const fetchManagedState = useAppStore((s) => s.fetchManagedDistributionState);
  const cancelPendingSyncConfirm = useAppStore((s) => s.cancelPendingSyncConfirm);
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [selectedRules, setSelectedRules] = useState<string[]>([]);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [skillSearch, setSkillSearch] = useState('');
  const [distributing, setDistributing] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const [sceneSkillIds, setSceneSkillIds] = useState<Set<string> | null>(null);
  const [sceneRuleIds, setSceneRuleIds] = useState<Set<string> | null>(null);
  const [manageMode, setManageMode] = useState(false);
  const [removeSkills, setRemoveSkills] = useState<string[]>([]);
  const [removeRules, setRemoveRules] = useState<string[]>([]);

  // Guard against double clicks during async flow
  const distributingRef = useRef(false);

  const enabledPlatforms = useMemo(
    () => platforms.filter((p) => p.enabled) as Platform[],
    [platforms]
  );

  const handleClose = useCallback(() => {
    cancelPendingSyncConfirm();
    onClose();
  }, [cancelPendingSyncConfirm, onClose]);

  useEffect(() => {
    if (!open) return;
    return () => cancelPendingSyncConfirm();
  }, [open, cancelPendingSyncConfirm]);

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
    setManageMode(false);
    setRemoveSkills([]);
    setRemoveRules([]);
    useAppStore.setState({ managedDistributionState: null });
    distributingRef.current = false;
    setDistributing(false);

    const store = useAppStore.getState();
    if (store.skills.length === 0) void fetchSkills();
    if (store.rules.length === 0) void fetchRules();
    if (store.scenes.length === 0) void fetchScenes();

    const fallback =
      scope === 'global'
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
  }, [
    open,
    initialPlatformId,
    scope,
    enabledPlatforms,
    fetchSkills,
    fetchRules,
    fetchScenes,
  ]);

  const managedPlatform = managedState?.platforms.find(
    (item) => item.platform_id === selectedPlatform && item.scope === scope
  );
  const managedSkillIds = new Set(managedPlatform?.skills.map((item) => item.id) ?? []);
  const managedRuleIds = new Set(managedPlatform?.rules.map((item) => item.id) ?? []);
  const managedSkills = skills.filter((item) => managedSkillIds.has(item.id));
  const managedRules = rules.filter((item) => managedRuleIds.has(item.id));
  const unknownEntries = [
    ...(managedPlatform?.skills ?? [])
      .filter((item) => !skills.some((skill) => skill.id === item.id))
      .map((item) => ({ kind: 'skill', ...item })),
    ...(managedPlatform?.rules ?? [])
      .filter((item) => !rules.some((rule) => rule.id === item.id))
      .map((item) => ({ kind: 'rule', ...item })),
  ];
  const localEntries = [
    ...(managedPlatform?.local_skills ?? []).map((item) => ({ kind: 'skill', ...item })),
    ...(managedPlatform?.local_rules ?? []).map((item) => ({ kind: 'rule', ...item })),
  ];

  const enterManageMode = useCallback(async () => {
    if (!selectedPlatform || (scope === 'project' && !project?.id)) return;
    if (await fetchManagedState([selectedPlatform], scope, project?.id)) {
      setManageMode(true);
      setRemoveSkills([]);
      setRemoveRules([]);
    }
  }, [selectedPlatform, scope, project, fetchManagedState]);

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
    const list =
      selectedSceneId && sceneSkillIds
        ? skills.filter((s) => sceneSkillIds.has(s.id))
        : skills;
    const q = skillSearch.toLowerCase();
    if (!q) return list;
    return list.filter((s) => s.name.toLowerCase().includes(q));
  }, [skills, skillSearch, selectedSceneId, sceneSkillIds]);

  const filteredRules = useMemo(() => {
    const list =
      selectedSceneId && sceneRuleIds
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

  const handleDistribute = useCallback(async () => {
    if (!selectedPlatform || distributingRef.current) return;
    distributingRef.current = true;
    setDistributing(true);
    setResultMsg(null);

    // Guard: project scope requires a project ID
    if (scope === 'project' && !project?.id) {
      addToast(t('missingProjectId'), 'error');
      setDistributing(false);
      distributingRef.current = false;
      return;
    }

    try {
      const currentSkillIds = new Set(skills.map((skill) => skill.id));
      const currentRuleIds = new Set(rules.map((rule) => rule.id));
      const eligibleSkillIds = new Set(
        (managedPlatform?.skills ?? [])
          .map((item) => item.id)
          .filter((id) => currentSkillIds.has(id))
      );
      const eligibleRuleIds = new Set(
        (managedPlatform?.rules ?? [])
          .map((item) => item.id)
          .filter((id) => currentRuleIds.has(id))
      );
      const filteredRemoveSkills = removeSkills.filter((id) => eligibleSkillIds.has(id));
      const filteredRemoveRules = removeRules.filter((id) => eligibleRuleIds.has(id));
      // Step 1: Preview & confirm
      const selection: DistributionSelection = {
        sceneId: selectedSceneId,
        platformIds: [selectedPlatform],
        scope,
        skills: {
          mode: manageMode ? 'remove_selected' : selectedSkills.length > 0 ? 'add_or_update' : 'preserve',
          ids: manageMode ? filteredRemoveSkills : selectedSkills,
        },
        rules: {
          mode: manageMode ? 'remove_selected' : selectedRules.length > 0 ? 'add_or_update' : 'preserve',
          ids: manageMode ? filteredRemoveRules : selectedRules,
        },
        ...(scope === 'project' && project?.id
          ? { projectId: project.id }
          : {}),
      };
      const confirmResult = await requestSyncConfirm(selection);

      if (confirmResult === 'no_changes') {
        addToast(t('noChanges'), 'info');
        return;
      }

      if (confirmResult !== 'confirmed') {
        // 'cancelled' — user dismissed; 'preview_failed' — toast already shown
        return;
      }

      const confirmed = takeConfirmedDistribution();
      if (!confirmed) return;
      const result = await executeDistribution(
        confirmed.selection,
        confirmed.plan
      );

      if (result) {
        setResultMsg(
          result.errors.length === 0
            ? t('distributeSuccess')
            : t('distributeWarning', { count: result.errors.length })
        );
        addToast(t('distributeComplete'), 'success');
        await fetchSkills();
        await fetchRules();
        onDistributed?.();
      }
    } finally {
      setDistributing(false);
      distributingRef.current = false;
    }
  }, [
    selectedPlatform,
    selectedSkills,
    selectedRules,
    manageMode,
    removeSkills,
    removeRules,
    skills,
    rules,
    managedPlatform,
    selectedSceneId,
    scope,
    project,
    requestSyncConfirm,
    executeDistribution,
    takeConfirmedDistribution,
    addToast,
    t,
    fetchSkills,
    fetchRules,
    onDistributed,
    fetchManagedState,
  ]);

  if (!open) return null;

  const selectedPlatformName = enabledPlatforms.find(
    (p) => p.id === selectedPlatform
  )?.name;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[820px] max-h-[85vh] overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-xl animate-fade-in">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">
            {t('distributeDialogTitle', {
              name: selectedPlatformName || selectedPlatform,
            })}
          </h2>
          <button
            onClick={handleClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {selectedPlatform && (
          <>
            {!manageMode && <>
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
                  <option key={scene.id} value={scene.id}>
                    {scene.name}
                  </option>
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
                        <span className="flex-1 truncate">
                          {rule.name}.{rule.format}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            </>}

            {manageMode && (
              <div className="mb-4 space-y-4">
                <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
                  <div className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" />{t('managedRemovalWarning')}</div>
                  <p className="mt-1 text-xs text-muted-foreground">{t('managedOnlyHint')}</p>
                </div>
                <ManagedList title={t('managedSkills')} entries={managedSkills.map((item) => ({ id: item.id, label: item.name }))} selected={removeSkills} onToggle={(id) => setRemoveSkills((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id])} emptyLabel={t('noManagedSkills')} />
                <ManagedList title={t('managedRules')} entries={managedRules.map((item) => ({ id: item.id, label: `${item.name}.${item.format}` }))} selected={removeRules} onToggle={(id) => setRemoveRules((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id])} emptyLabel={t('noManagedRules')} />
                {unknownEntries.length > 0 && <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground"><div className="mb-2 font-medium text-foreground">{t('unknownContent')}</div>{unknownEntries.map((item) => <div key={`${item.kind}:${item.id}`} className="truncate">{item.path}</div>)}</div>}
                {localEntries.length > 0 && <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground"><div className="mb-2 font-medium text-foreground">{t('localUnmanagedContent')}</div><p className="mb-2">{t('localUnmanagedHint')}</p>{localEntries.map((item) => <div key={`${item.kind}:${item.path}`} className="truncate">{item.name}</div>)}</div>}
              </div>
            )}

            {/* 结果反馈 */}
            {resultMsg && (
              <div
                className={cn(
                  'mb-4 rounded-lg border px-3 py-2 text-sm',
                  resultMsg.startsWith('✓')
                    ? 'border-success/40 bg-success/10 text-success'
                    : 'border-warning/40 bg-warning/10 text-warning'
                )}
              >
                {resultMsg}
              </div>
            )}
          </>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={manageMode ? () => setManageMode(false) : enterManageMode}
            disabled={!selectedPlatform || (scope === 'project' && !project?.id) || distributing}
            className="mr-auto rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          ><span className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4" />{manageMode ? t('backToDistribute') : t('manageDistributedContent')}</span></button>
          <button
            onClick={handleClose}
            className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
          >
            {t('common:actions.cancel')}
          </button>
          <button
            onClick={handleDistribute}
            disabled={!selectedPlatform || distributing || (manageMode && removeSkills.length + removeRules.length === 0)}
            className={cn(
              'px-6 py-2.5 rounded-lg text-sm font-medium transition-colors',
              selectedPlatform && !distributing
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-muted text-muted-foreground cursor-not-allowed'
            )}
          >
            {distributing
              ? t('distributing')
              : manageMode ? t('removeSelected', { count: removeSkills.length + removeRules.length }) : selectedPlatform
                ? t('distributeTo', {
                    name: selectedPlatformName || selectedPlatform,
                  })
                : t('selectPlatformFirst')}
          </button>
        </div>
      </div>
    </div>
  );
});

const ManagedList = memo(function ManagedList({ title, entries, selected, onToggle, emptyLabel }: {
  title: string;
  entries: { id: string; label: string }[];
  selected: string[];
  onToggle: (id: string) => void;
  emptyLabel: string;
}) {
  return <section><h3 className="mb-2 text-xs font-semibold text-foreground">{title}</h3>{entries.length === 0 ? <p className="text-xs text-muted-foreground">{emptyLabel}</p> : <div className="space-y-1">{entries.map((entry) => { const checked = selected.includes(entry.id); return <button key={entry.id} type="button" aria-pressed={checked} onClick={() => onToggle(entry.id)} className={cn('flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors', checked ? 'border-warning bg-warning/15 text-warning' : 'border-border bg-card hover:bg-accent/50')}><span aria-hidden="true">{checked ? '☑' : '☐'}</span><span className="truncate">{entry.label}</span></button>; })}</div>}</section>;
});

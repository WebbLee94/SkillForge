import {
  memo,
  Fragment,
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../stores/appStore';
import { cn, sanitizePath } from '../../lib/utils';
import { SELECT_CLASSES } from '../../lib/ui-tokens';
import {
  ShieldCheck,
  AlertTriangle,
  FolderOpen,
  RefreshCw,
  ArrowLeft,
  Settings,
  OctagonX,
  ChevronDown,
} from 'lucide-react';
import { ipc } from '../../lib/ipc';
import { ConfirmDialog } from '../../components/common/ConfirmDialog';
import type {
  DistributionSelection,
  DistributionPlan,
  Platform,
  Project,
  RemoveDistributionSelection,
  SyncResult,
} from '../../types';

interface DistributionWorkspaceProps {
  scope?: 'global' | 'project';
  initialProjectId?: string | null;
  onDistributed?: () => void;
}

type Step = 1 | 2 | 3 | 4;
type Phase = 'idle' | 'planning' | 'plan_ready' | 'executing' | 'result';

const STEP_LABELS: { title: string; desc: string }[] = [
  { title: 'ws.step1.title', desc: 'ws.step1.desc' },
  { title: 'ws.step2.title', desc: 'ws.step2.desc' },
  { title: 'ws.step3.title', desc: 'ws.step3.desc' },
  { title: 'ws.step4.title', desc: 'ws.step4.desc' },
];

const isMacOS = () =>
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

/** 个别平台 global_skills_dir 本身即平台配置根目录（无父目录语义），揭示其自身而非父目录。
 * 当前 10 个内置平台均为 `~/.xxx/skills` 子目录，集合为空；新增平台时按
 * `skills_global == 平台配置根目录` 判定加入（29 号 §4.1 白名单，验收时逐平台人工复核）。
 */
const REVEAL_ROOT_SELF_PLATFORMS: ReadonlySet<string> = new Set([]);

/** 是否应让 Rust 推导主目录（as_skills_dir）。项目目标恒 false；全局目标仅白名单平台为 false。
 * `rootSelf` 可注入便于测试锁定白名单语义；生产默认使用 REVEAL_ROOT_SELF_PLATFORMS（当前为空）。 */
export function resolveRevealAsSkillsDir(
  platformId: string,
  isProjectTarget: boolean,
  rootSelf: ReadonlySet<string> = REVEAL_ROOT_SELF_PLATFORMS
): boolean {
  if (isProjectTarget) return false;
  return !rootSelf.has(platformId);
}

/** 33 号 A1：Step1 项目目标下路径展示为平台内相对路径；{project}/ 前缀剥离。
 * 绝对 / ~ / 相对 pattern 原样（无法进一步相对化）；目标不可用时原样返回（渲染层回退 pathUnavailable）。 */
export function resolveStep1PathDisplay(
  rawPath: string,
  isProjectTarget: boolean,
  pattern: string | null
): string {
  if (!isProjectTarget) return rawPath;
  if (!rawPath) return rawPath;
  if (pattern && pattern.startsWith('{project}/')) {
    const rel = pattern.slice('{project}/'.length);
    return rel || rawPath;
  }
  return pattern || rawPath;
}

export const DistributionWorkspace = memo(function DistributionWorkspace({
  scope = 'global',
  initialProjectId = null,
  onDistributed,
}: DistributionWorkspaceProps) {
  const { t } = useTranslation('distribution');

  const platforms = useAppStore((s) => s.platforms);
  const projects = useAppStore((s) => s.projects);
  const skills = useAppStore((s) => s.skills);
  const rules = useAppStore((s) => s.rules);
  const scenes = useAppStore((s) => s.scenes);
  const fetchPlatforms = useAppStore((s) => s.fetchPlatforms);
  const fetchProjects = useAppStore((s) => s.fetchProjects);
  const fetchSkills = useAppStore((s) => s.fetchSkills);
  const fetchRules = useAppStore((s) => s.fetchRules);
  const fetchScenes = useAppStore((s) => s.fetchScenes);
  const executeDistribution = useAppStore((s) => s.executeDistribution);
  const removeDistributed = useAppStore((s) => s.removeDistributed);
  const fetchManagedState = useAppStore((s) => s.fetchManagedDistributionState);
  const managedState = useAppStore((s) => s.managedDistributionState);
  const addToast = useAppStore((s) => s.addToast);

  const [mode, setMode] = useState<'loading' | 'error' | 'empty' | 'normal'>(
    'loading'
  );
  const [step, setStep] = useState<Step>(1);
  const [phase, setPhase] = useState<Phase>('idle');
  const [target, setTarget] = useState<string>('global');
  const [platformId, setPlatformId] = useState<string | null>(null);
  const [source, setSource] = useState('all');
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [selectedRules, setSelectedRules] = useState<string[]>([]);
  const [pendingRemoveSkills, setPendingRemoveSkills] = useState<string[]>([]);
  const [pendingRemoveRules, setPendingRemoveRules] = useState<string[]>([]);
  const [pendingRemoveResult, setPendingRemoveResult] = useState<{
    status: 'idle' | 'running' | 'success' | 'partial' | 'failed';
    removed: string[];
    errors: string[];
  } | null>(null);
  const [managedOpen, setManagedOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const [sceneSkillIds, setSceneSkillIds] = useState<Set<string> | null>(null);
  const [sceneRuleIds, setSceneRuleIds] = useState<Set<string> | null>(null);
  const [sceneSourceLoadFailed, setSceneSourceLoadFailed] = useState(false);
  const [invalidSceneRefs, setInvalidSceneRefs] = useState<{
    skills: number;
    rules: number;
  } | null>(null);
  const [plan, setPlan] = useState<DistributionPlan | null>(null);
  const [planStale, setPlanStale] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const [backgroundRunning, setBackgroundRunning] = useState(false);
  const execToken = useRef(0);
  const sceneLoadToken = useRef(0);

  const enabledPlatforms = useMemo(
    () => platforms.filter((p) => p.enabled) as Platform[],
    [platforms]
  );

  const init = useCallback(async () => {
    setMode('loading');
    try {
      const state = useAppStore.getState();
      if (state.platforms.length === 0 && !(await fetchPlatforms())) {
        throw new Error('platforms');
      }
      if (state.projects.length === 0 && !(await fetchProjects())) {
        throw new Error('projects');
      }
      if (state.skills.length === 0 && !(await fetchSkills())) {
        throw new Error('skills');
      }
      if (state.rules.length === 0 && !(await fetchRules())) {
        throw new Error('rules');
      }
      if (state.scenes.length === 0 && !(await fetchScenes())) {
        throw new Error('scenes');
      }
      const fresh = useAppStore.getState();
      if (scope === 'project' && fresh.projects.length === 0) {
        setMode('empty');
        return;
      }
      const enabled = fresh.platforms.filter((p) => p.enabled) as Platform[];
      if (enabled.length === 0) {
        setMode('empty');
        return;
      }
      // 差异3（交互稿 §7.8）：项目页「去工作区分发」携带项目上下文；全局工作区挂载时
      // 消费 projectDistSelectedProjectId 作为默认目标并清除，使后续直接进入
      // 工作区时默认回到全局目标。
      const carriedProjectId =
        scope === 'global' ? fresh.projectDistSelectedProjectId : null;
      let initialTarget: string;
      if (scope === 'project' && fresh.projects.length > 0) {
        initialTarget = `project:${initialProjectId || fresh.projects[0].id}`;
      } else if (
        carriedProjectId &&
        fresh.projects.some((p) => p.id === carriedProjectId)
      ) {
        initialTarget = `project:${carriedProjectId}`;
      } else {
        initialTarget = 'global';
      }
      if (scope === 'global') {
        useAppStore.getState().setProjectDistSelectedProjectId(null);
      }
      setTarget(initialTarget);
      const savedPlatform =
        scope === 'global'
          ? fresh.globalDistSelectedPlatform
          : fresh.projectDistSelectedPlatform;
      const defaultPlatform =
        savedPlatform && enabled.some((p) => p.id === savedPlatform)
          ? savedPlatform
          : enabled[0].id;
      setPlatformId(defaultPlatform);
      setMode('normal');
    } catch {
      setMode('error');
    }
  }, [
    fetchPlatforms,
    fetchProjects,
    fetchSkills,
    fetchRules,
    fetchScenes,
    scope,
    initialProjectId,
  ]);

  const initRanRef = useRef(false);
  useEffect(() => {
    if (initRanRef.current) return;
    initRanRef.current = true;
    void init();
  }, [init]);

  // Default target / platform from route scope + store memory
  useEffect(() => {
    if (mode !== 'normal') return;
    if (!platformId && enabledPlatforms.length > 0) {
      const state = useAppStore.getState();
      const savedPlatform =
        scope === 'global'
          ? state.globalDistSelectedPlatform
          : state.projectDistSelectedPlatform;
      setPlatformId(
        savedPlatform && enabledPlatforms.some((p) => p.id === savedPlatform)
          ? savedPlatform
          : enabledPlatforms[0].id
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, platformId, enabledPlatforms.length]);

  // Consume pendingDistributionSelection from resource library (§3.4)
  useEffect(() => {
    if (mode !== 'normal') return;
    const pending = useAppStore.getState().pendingDistributionSelection;
    if (!pending) return;
    const validSkills = pending.skillIds.filter((id) =>
      useAppStore.getState().skills.some((s) => s.id === id)
    );
    const validRules = pending.ruleIds.filter((id) =>
      useAppStore.getState().rules.some((r) => r.id === id)
    );
    if (validSkills.length > 0 || validRules.length > 0) {
      setSelectedSkills(validSkills);
      setSelectedRules(validRules);
      if (
        pending.sceneId &&
        useAppStore.getState().scenes.some((s) => s.id === pending.sceneId)
      ) {
        setSource(`scene:${pending.sceneId}`);
      }
      setStep(2);
      addToast(
        t('ws.presetToast', { count: validSkills.length + validRules.length }),
        'info'
      );
    }
    useAppStore.getState().setPendingDistributionSelection(null);
  }, [mode, addToast, t]);

  const isProjectTarget = target.startsWith('project:');
  const selectedProject = useMemo<Project | null>(() => {
    if (!isProjectTarget) return null;
    return projects.find((p) => p.id === target.slice(8)) || null;
  }, [isProjectTarget, target, projects]);

  const selectedPlatform =
    enabledPlatforms.find((p) => p.id === platformId) || null;

  const getTargetDir = useCallback((): string => {
    if (!selectedPlatform) return '';
    if (!isProjectTarget) return selectedPlatform.paths.global_skills_dir;
    if (!selectedProject) return '';
    const pattern = selectedPlatform.paths.project_skills_pattern || '';
    if (pattern.includes('{project}')) {
      return pattern.replace('{project}', selectedProject.path);
    }
    if (
      pattern.startsWith('/') ||
      pattern.startsWith('~') ||
      /^[A-Za-z]:[\\/]/.test(pattern)
    ) {
      return pattern;
    }
    return `${selectedProject.path}/${pattern}`;
  }, [selectedPlatform, isProjectTarget, selectedProject]);

  const getRulesTargetDir = useCallback((): string => {
    if (!selectedPlatform) return '';
    if (!isProjectTarget) return selectedPlatform.paths.global_rules_dir || '';
    if (!selectedProject) return '';
    const pattern = selectedPlatform.paths.project_rules_pattern || '';
    if (pattern.includes('{project}')) {
      return pattern.replace('{project}', selectedProject.path);
    }
    if (
      pattern.startsWith('/') ||
      pattern.startsWith('~') ||
      /^[A-Za-z]:[\\/]/.test(pattern)
    ) {
      return pattern;
    }
    return `${selectedProject.path}/${pattern}`;
  }, [selectedPlatform, isProjectTarget, selectedProject]);

  const togglePlatform = useCallback(
    (id: string) => {
      setPlatformId(id);
      setManagedOpen(false);
      setPendingRemoveSkills([]);
      setPendingRemoveRules([]);
      setPendingRemoveResult(null);
      const state = useAppStore.getState();
      if (scope === 'global') state.setGlobalDistSelectedPlatform(id);
      else state.setProjectDistSelectedPlatform(id);
    },
    [scope]
  );

  const toggleTarget = useCallback((value: string) => {
    setTarget(value);
    setManagedOpen(false);
    setPendingRemoveSkills([]);
    setPendingRemoveRules([]);
    setPendingRemoveResult(null);
    setSelectedSkills([]);
    setSelectedRules([]);
    setPlan(null);
    setPlanStale(false);
    if (value.startsWith('project:')) {
      const pid = value.slice(8);
      useAppStore.getState().setProjectDistSelectedProjectId(pid);
    }
  }, []);

  // Scene source members
  useEffect(() => {
    const token = ++sceneLoadToken.current;
    if (!source.startsWith('scene:')) {
      setSceneSkillIds(null);
      setSceneRuleIds(null);
      setSceneSourceLoadFailed(false);
      setInvalidSceneRefs(null);
      return;
    }
    const sceneId = source.slice(6);
    setSceneSourceLoadFailed(false);
    setInvalidSceneRefs(null);
    ipc
      .getSceneDetail(sceneId)
      .then((detail) => {
        if (token !== sceneLoadToken.current) return;
        const validSkillIds = detail.skills
          .filter((s) => s.enabled && s.skill_name)
          .map((s) => s.skill_id);
        const validRuleIds = detail.rules
          .filter((r) => r.enabled && r.rule_name)
          .map((r) => r.rule_id);
        const invalidSkills = detail.skills.filter((s) => !s.skill_name).length;
        const invalidRules = detail.rules.filter((r) => !r.rule_name).length;
        setSceneSkillIds(new Set(validSkillIds));
        setSceneRuleIds(new Set(validRuleIds));
        if (invalidSkills > 0 || invalidRules > 0) {
          setInvalidSceneRefs({ skills: invalidSkills, rules: invalidRules });
          setSelectedSkills([]);
          setSelectedRules([]);
        }
      })
      .catch(() => {
        if (token !== sceneLoadToken.current) return;
        setSceneSkillIds(new Set());
        setSceneRuleIds(new Set());
        setSceneSourceLoadFailed(true);
        setInvalidSceneRefs(null);
        setSelectedSkills([]);
        setSelectedRules([]);
        setPlan(null);
        setPlanStale(false);
        addToast(t('ws.sceneSourceLoadFailed'), 'error');
      });
  }, [source, addToast, t]);

  const continueWithValidOnly = useCallback(() => {
    setInvalidSceneRefs(null);
  }, []);

  const returnToSceneConfig = useCallback(() => {
    setInvalidSceneRefs(null);
    setSource('all');
    setSelectedSkills([]);
    setSelectedRules([]);
    setPlan(null);
    setPlanStale(false);
  }, []);

  const poolSkills = useMemo(() => {
    const list = sceneSkillIds
      ? skills.filter((s) => sceneSkillIds.has(s.id))
      : skills;
    return list;
  }, [skills, sceneSkillIds]);

  const poolRules = useMemo(() => {
    const list = sceneRuleIds
      ? rules.filter((r) => sceneRuleIds.has(r.id))
      : rules;
    return list;
  }, [rules, sceneRuleIds]);

  // T5（33 号 3.4 / A3）：三态全选派生值——全选仅影响当前来源池
  const allSkillsChecked =
    poolSkills.length > 0 &&
    poolSkills.every((s) => selectedSkills.includes(s.id));
  const skillsPartiallyChecked =
    poolSkills.some((s) => selectedSkills.includes(s.id)) && !allSkillsChecked;
  const allRulesChecked =
    poolRules.length > 0 &&
    poolRules.every((r) => selectedRules.includes(r.id));
  const rulesPartiallyChecked =
    poolRules.some((r) => selectedRules.includes(r.id)) && !allRulesChecked;

  const toggleSelect = useCallback((kind: 'skill' | 'rule', id: string) => {
    if (kind === 'skill') {
      setSelectedSkills((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      );
    } else {
      setSelectedRules((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      );
    }
    setPlan(null);
    setPlanStale(false);
  }, []);

  const togglePendingRemove = useCallback(
    (kind: 'skill' | 'rule', id: string) => {
      if (kind === 'skill') {
        setPendingRemoveSkills((prev) =>
          prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
        );
      } else {
        setPendingRemoveRules((prev) =>
          prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
        );
      }
      setPendingRemoveResult(null);
    },
    []
  );

  const buildSelection = useCallback((): DistributionSelection => {
    const projectId = isProjectTarget ? target.slice(8) : undefined;
    return {
      sceneId: source.startsWith('scene:') ? source.slice(6) : null,
      platformIds: platformId ? [platformId] : [],
      scope: isProjectTarget ? 'project' : 'global',
      ...(projectId ? { projectId } : {}),
      skills: {
        mode: selectedSkills.length > 0 ? 'add_or_update' : 'preserve',
        ids: selectedSkills,
      },
      rules: {
        mode: selectedRules.length > 0 ? 'add_or_update' : 'preserve',
        ids: selectedRules,
      },
    };
  }, [
    isProjectTarget,
    target,
    source,
    platformId,
    selectedSkills,
    selectedRules,
  ]);

  // Generate plan when entering step 3
  useEffect(() => {
    if (step !== 3 || phase !== 'planning') return;
    const token = ++execToken.current;
    const selection = buildSelection();
    if (!selection.platformIds.length) {
      setPlanStale(true);
      setPhase('idle');
      return;
    }
    setPlan(null);
    setPlanStale(false);
    ipc
      .previewDistribution(selection)
      .then((p) => {
        if (token !== execToken.current) return;
        setPlan(p);
        setPhase('plan_ready');
      })
      .catch(() => {
        if (token !== execToken.current) return;
        addToast(t('previewFailed'), 'error');
        setPhase('idle');
      });
  }, [step, phase, buildSelection, addToast, t]);

  const nextFromTarget = useCallback(() => {
    if (isProjectTarget) {
      if (!selectedProject || !selectedProject.path?.trim()) {
        addToast(t('ws.targetProjectMissing'), 'error');
        return;
      }
    }
    if (!getTargetDir()) {
      addToast(t('ws.pathUnavailable'), 'error');
      return;
    }
    setStep(2);
  }, [isProjectTarget, selectedProject, getTargetDir, addToast, t]);

  const nextToPlan = useCallback(() => {
    setStep(3);
    setPhase('planning');
  }, []);

  const back = useCallback(() => {
    if (step === 4 && phase === 'executing') {
      execToken.current += 1;
      setStep(1);
      setPhase('idle');
      setPlan(null);
      setResult(null);
      addToast(t('ws.cancelBackgroundContinue'), 'info');
      return;
    }
    if (step === 1) {
      addToast(t('ws.cancelNoRollback'), 'info');
      return;
    }
    setStep((prev) => (prev - 1) as Step);
    setPhase('idle');
  }, [step, phase, addToast, t]);

  const rescan = useCallback(() => {
    setPlanStale(false);
    setPlan(null);
    setPhase('planning');
  }, []);

  const runExecute = useCallback(
    async (selection: DistributionSelection, p: DistributionPlan) => {
      const token = ++execToken.current;
      setStep(4);
      setPhase('executing');
      setBackgroundRunning(true);
      try {
        const res = await executeDistribution(selection, p);
        if (token !== execToken.current) return;
        if (res) {
          setResult(res);
          setPhase('result');
          onDistributed?.();
        } else {
          setPhase('plan_ready');
        }
      } finally {
        setBackgroundRunning(false);
      }
    },
    [executeDistribution, onDistributed]
  );

  const confirmDistribution = useCallback(() => {
    if (!plan || !platformId) return;
    if (backgroundRunning) {
      addToast(t('ws.busyBackground'), 'warning');
      return;
    }
    const selection = buildSelection();
    void runExecute(selection, plan);
  }, [
    plan,
    platformId,
    backgroundRunning,
    buildSelection,
    runExecute,
    addToast,
    t,
  ]);

  const retryFailed = useCallback(() => {
    if (!plan || !platformId) return;
    if (backgroundRunning) {
      addToast(t('ws.busyBackground'), 'warning');
      return;
    }
    void runExecute(buildSelection(), plan);
  }, [
    plan,
    platformId,
    backgroundRunning,
    buildSelection,
    runExecute,
    addToast,
    t,
  ]);

  // T7（33 号 3.6 / A5）：「返回工作区」统一回 Step 1，保留目标/平台/资源选择上下文。
  // 只清理本次执行状态，不清空待移除标记/受管面板状态，也不触发 onDistributed。
  const backToWorkspace = useCallback(() => {
    execToken.current += 1;
    setStep(1);
    setPhase('idle');
    setPlan(null);
    setPlanStale(false);
    setResult(null);
  }, []);

  const runRemoveDistributed = useCallback(async () => {
    setConfirmRemoveOpen(false);
    if (!platformId || backgroundRunning) return;
    const projectId = isProjectTarget ? target.slice(8) : undefined;
    const selection: RemoveDistributionSelection = {
      platformIds: [platformId],
      scope: isProjectTarget ? 'project' : 'global',
      ...(projectId ? { projectId } : {}),
      skillIds: pendingRemoveSkills,
      ruleIds: pendingRemoveRules,
    };
    setBackgroundRunning(true);
    setPendingRemoveResult({ status: 'running', removed: [], errors: [] });
    try {
      const res = await removeDistributed(selection);
      if (res) {
        setPendingRemoveResult({
          status: res.errors.length > 0 ? 'partial' : 'success',
          removed: res.removed,
          errors: res.errors,
        });
        // 部分失败：保留未成功项的选择（成功项从 pending 中剔除，规则 id 为 `rule:{id}` 形式）
        const removedSkillIds = new Set(res.removed);
        setPendingRemoveSkills((prev) =>
          prev.filter((id) => !removedSkillIds.has(id))
        );
        setPendingRemoveRules((prev) =>
          prev.filter((id) => !removedSkillIds.has(`rule:${id}`))
        );
      } else {
        setPendingRemoveResult({ status: 'failed', removed: [], errors: [] });
        // 失败：保留全部选择，可重试
      }
      // 状态失效：清空计划、刷新受管面板与分发状态（无论成败，目标文件系统可能已变化）
      setPlan(null);
      setPlanStale(false);
      const ok = await fetchManagedState(
        selection.platformIds,
        selection.scope,
        selection.projectId
      );
      if (!ok) addToast(t('previewFailed'), 'error');
    } finally {
      setBackgroundRunning(false);
    }
  }, [
    platformId,
    isProjectTarget,
    target,
    pendingRemoveSkills,
    pendingRemoveRules,
    backgroundRunning,
    removeDistributed,
    fetchManagedState,
    addToast,
    t,
  ]);

  const revealDir = useCallback(async () => {
    if (!selectedPlatform) return;
    const target =
      isProjectTarget && selectedProject
        ? selectedProject.path
        : getTargetDir();
    if (!target) {
      addToast(t('ws.revealFailed'), 'error');
      return;
    }
    try {
      const res = await ipc.revealPath(
        target,
        resolveRevealAsSkillsDir(selectedPlatform.id, isProjectTarget)
      );
      if (res.fallback) addToast(t('ws.revealFallback'), 'info');
    } catch {
      addToast(t('ws.revealFailed'), 'error');
    }
  }, [
    isProjectTarget,
    selectedProject,
    selectedPlatform,
    getTargetDir,
    addToast,
    t,
  ]);

  const openManaged = useCallback(async () => {
    if (!platformId) return;
    const projectId = isProjectTarget ? target.slice(8) : undefined;
    const ok = await fetchManagedState(
      [platformId],
      isProjectTarget ? 'project' : 'global',
      projectId
    );
    if (!ok) return;
    setManagedOpen(true);
  }, [platformId, isProjectTarget, target, fetchManagedState]);

  const closeManagedPanel = useCallback(() => {
    setManagedOpen(false);
  }, []);

  useEffect(() => {
    if (managedOpen && drawerRef.current) {
      drawerRef.current.focus();
    } else if (!managedOpen && triggerRef.current) {
      triggerRef.current.focus();
    }
  }, [managedOpen]);

  const managedPlatform = managedState?.platforms.find(
    (item) =>
      item.platform_id === platformId &&
      item.scope === (isProjectTarget ? 'project' : 'global')
  );
  const managedSkillIds = new Set(
    managedPlatform?.skills.map((item) => item.id) ?? []
  );
  const managedRuleIds = new Set(
    managedPlatform?.rules.map((item) => item.id) ?? []
  );
  const managedSkills = skills.filter((item) => managedSkillIds.has(item.id));
  const managedRules = rules.filter((item) => managedRuleIds.has(item.id));

  // T3: 受管面板分区三态全选派生值
  const allManagedSkillsChecked =
    managedSkills.length > 0 &&
    managedSkills.every((s) => pendingRemoveSkills.includes(s.id));
  const managedSkillsPartiallyChecked =
    managedSkills.some((s) => pendingRemoveSkills.includes(s.id)) &&
    !allManagedSkillsChecked;
  const allManagedRulesChecked =
    managedRules.length > 0 &&
    managedRules.every((r) => pendingRemoveRules.includes(r.id));
  const managedRulesPartiallyChecked =
    managedRules.some((r) => pendingRemoveRules.includes(r.id)) &&
    !allManagedRulesChecked;

  // T3: 受管面板分区全选/清空
  const toggleManagedSelectAll = useCallback(
    (kind: 'skill' | 'rule') => {
      if (kind === 'skill') {
        if (allManagedSkillsChecked) {
          setPendingRemoveSkills((prev) =>
            prev.filter((id) => !managedSkills.some((s) => s.id === id))
          );
        } else {
          setPendingRemoveSkills((prev) => {
            const newSet = new Set(prev);
            for (const s of managedSkills) newSet.add(s.id);
            return Array.from(newSet);
          });
        }
      } else {
        if (allManagedRulesChecked) {
          setPendingRemoveRules((prev) =>
            prev.filter((id) => !managedRules.some((r) => r.id === id))
          );
        } else {
          setPendingRemoveRules((prev) => {
            const newSet = new Set(prev);
            for (const r of managedRules) newSet.add(r.id);
            return Array.from(newSet);
          });
        }
      }
      setPendingRemoveResult(null);
    },
    [
      allManagedSkillsChecked,
      allManagedRulesChecked,
      managedSkills,
      managedRules,
    ]
  );

  const clearManagedSelection = useCallback(
    (kind: 'skill' | 'rule') => {
      if (kind === 'skill') {
        setPendingRemoveSkills((prev) =>
          prev.filter((id) => !managedSkills.some((s) => s.id === id))
        );
      } else {
        setPendingRemoveRules((prev) =>
          prev.filter((id) => !managedRules.some((r) => r.id === id))
        );
      }
      setPendingRemoveResult(null);
    },
    [managedSkills, managedRules]
  );

  const unknownEntries = [
    ...(managedPlatform?.skills ?? [])
      .filter((item) => !skills.some((skill) => skill.id === item.id))
      .map((item) => ({
        kind: 'skill' as const,
        path: item.path,
        name: item.id,
      })),
    ...(managedPlatform?.rules ?? [])
      .filter((item) => !rules.some((rule) => rule.id === item.id))
      .map((item) => ({
        kind: 'rule' as const,
        path: item.path,
        name: item.id,
      })),
  ];
  const localEntries = [
    ...(managedPlatform?.local_skills ?? []).map((item) => ({
      kind: 'skill' as const,
      ...item,
    })),
    ...(managedPlatform?.local_rules ?? []).map((item) => ({
      kind: 'rule' as const,
      ...item,
    })),
  ];
  const keepEntries = [
    ...unknownEntries.map((item) => ({
      key: `unknown-${item.kind}-${item.path}`,
      ...item,
    })),
    ...localEntries.map((item) => ({
      key: `local-${item.kind}-${item.path}`,
      ...item,
    })),
  ];

  const planPlatform = plan?.platforms[0];
  const pendingTotal = pendingRemoveSkills.length + pendingRemoveRules.length;
  const hasChanges =
    plan != null &&
    (plan.has_removals ||
      (planPlatform?.skills_to_add.length ?? 0) > 0 ||
      (planPlatform?.skills_to_update.length ?? 0) > 0 ||
      (planPlatform?.rules_to_add.length ?? 0) > 0 ||
      (planPlatform?.rules_to_update.length ?? 0) > 0);

  const revealLabel = isMacOS() ? t('ws.revealMac') : t('ws.revealWin');
  const targetDisplayPath = sanitizePath(getTargetDir());
  const rulesTargetDisplayPath = sanitizePath(getRulesTargetDir());
  const skillsStep1Path = resolveStep1PathDisplay(
    targetDisplayPath,
    isProjectTarget,
    selectedPlatform?.paths.project_skills_pattern ?? null
  );
  const rulesStep1Path = resolveStep1PathDisplay(
    rulesTargetDisplayPath,
    isProjectTarget,
    selectedPlatform?.paths.project_rules_pattern ?? null
  );
  const rulesSingleFile = useMemo(() => {
    if (!selectedPlatform) return false;
    const fmt = isProjectTarget
      ? selectedPlatform.paths.project_rules_format
      : selectedPlatform.paths.global_rules_format;
    return fmt != null && 'SingleFile' in fmt;
  }, [selectedPlatform, isProjectTarget]);

  const nameForSkill = (id: string) =>
    skills.find((s) => s.id === id)?.name || id;
  const nameForRule = (id: string) =>
    rules.find((r) => r.id === id)?.name || id;

  if (mode === 'loading') {
    return (
      <div className="stack" style={{ marginTop: 18 }}>
        <div className="card card-pad stack">
          <div className="skeleton-bar" style={{ width: 140 }} />
          <div className="skeleton-bar" style={{ width: '60%' }} />
        </div>
      </div>
    );
  }

  if (mode === 'error') {
    return (
      <div className="error-state" role="alert">
        <AlertTriangle className="h-8 w-8 text-destructive" />
        <h3>{t('ws.errorTitle')}</h3>
        <p>{t('ws.errorHint')}</p>
        <button className="btn-primary" onClick={() => void init()}>
          {t('ws.retryLoad')}
        </button>
      </div>
    );
  }

  if (mode === 'empty') {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <OctagonX className="h-10 w-10 mb-4 text-muted-foreground" />
        <h2 className="text-lg font-semibold text-foreground mb-2">
          {t('ws.emptyTitle')}
        </h2>
        <p className="text-sm text-muted-foreground mb-6 max-w-md">
          {t('ws.emptyHint')}
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => useAppStore.getState().setActiveNav('settings')}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Settings className="h-4 w-4" /> {t('ws.goSettings')}
          </button>
        </div>
      </div>
    );
  }

  const stepper = (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-3 mb-4"
      aria-label="distribution stepper"
    >
      {STEP_LABELS.map((label, i) => {
        const stepNo = (i + 1) as Step;
        const done = stepNo < step;
        const current = stepNo === step;
        return (
          <Fragment key={stepNo}>
            <div
              className={cn(
                'flex items-center gap-2',
                current && 'text-primary'
              )}
            >
              <span
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium',
                  done && 'bg-primary/15 text-primary',
                  current && 'bg-primary text-primary-foreground',
                  !done && !current && 'bg-muted text-muted-foreground'
                )}
              >
                {done ? '✓' : stepNo}
              </span>
              <div>
                <div className="text-sm font-medium">{t(label.title)}</div>
                <div className="text-xs text-muted-foreground">
                  {t(label.desc)}
                </div>
              </div>
            </div>
            {stepNo < 4 && (
              <span
                aria-hidden
                data-testid="ws-step-connector"
                className="mt-3 flex-1 border-t border-border"
              />
            )}
          </Fragment>
        );
      })}
    </div>
  );

  return (
    <div className="flex flex-col">
      {stepper}

      {/* ── Step 1: Target ── */}
      {step === 1 && (
        <div className="rounded-lg border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3">
            1. {t('ws.step1.title')}
          </h3>
          <div
            className="grid grid-cols-1 sm:grid-cols-2 gap-4"
            data-testid="ws-step1-grid"
          >
            <div>
              <label
                className="mb-1 block text-sm font-medium text-foreground"
                htmlFor="dist-target"
              >
                {t('ws.targetLabel')}
              </label>
              <select
                id="dist-target"
                aria-label={t('ws.targetLabel')}
                value={target}
                onChange={(e) => toggleTarget(e.target.value)}
                className={cn(SELECT_CLASSES, 'w-full max-w-[420px]')}
              >
                <optgroup label={t('ws.targetGlobal')}>
                  <option value="global">{t('ws.targetGlobalOption')}</option>
                </optgroup>
                <optgroup label={t('ws.targetProject')}>
                  {projects.map((p) => (
                    <option key={p.id} value={`project:${p.id}`}>
                      {p.name} · {sanitizePath(p.path)}
                    </option>
                  ))}
                </optgroup>
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('ws.targetHint')}
              </p>
            </div>

            <div>
              <label
                className="mb-1 block text-sm font-medium text-foreground"
                htmlFor="dist-platform"
              >
                {t('ws.platformLabel')}
              </label>
              <select
                id="dist-platform"
                data-testid="dist-platform"
                aria-label={t('ws.platformLabel')}
                value={platformId || ''}
                onChange={(e) => togglePlatform(e.target.value)}
                className={cn(SELECT_CLASSES, 'w-full max-w-[420px]')}
              >
                {enabledPlatforms.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="mb-1 text-sm font-medium text-foreground">
                {t('ws.skillsPathLabel')}
              </div>
              <div
                data-testid="ws-skills-path"
                className="rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-xs text-muted-foreground break-all"
              >
                {skillsStep1Path || t('ws.pathUnavailable')}
              </div>
            </div>
            <div>
              <div className="mb-1 text-sm font-medium text-foreground">
                {t('ws.rulesPathLabel')}
              </div>
              <div
                data-testid="ws-rules-path"
                className="rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-xs text-muted-foreground break-all"
              >
                {rulesStep1Path || t('ws.pathUnavailable')}
              </div>
              {rulesSingleFile && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('ws.rulesSingleFileHint')}
                </p>
              )}
            </div>

            <div className="border-t border-border pt-3 sm:col-span-2">
              <button
                ref={triggerRef}
                type="button"
                aria-expanded={managedOpen}
                aria-controls="ws-managed-panel"
                className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-accent"
                onClick={openManaged}
              >
                <ShieldCheck className="h-4 w-4" />
                <span
                  className={cn(
                    'transition-transform duration-200',
                    managedOpen && 'rotate-180'
                  )}
                >
                  <ChevronDown className="h-4 w-4" />
                </span>
                {managedOpen
                  ? t('ws.managedToggleHide')
                  : t('ws.managedToggle')}
              </button>

              {managedOpen && (
                <>
                  {/* Backdrop */}
                  <div
                    data-testid="ws-managed-backdrop"
                    className="fixed inset-0 z-40 bg-black/50"
                    onClick={closeManagedPanel}
                  />
                  {/* Drawer */}
                  <aside
                    id="ws-managed-panel"
                    data-testid="ws-managed-drawer"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="ws-managed-panel-title"
                    className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col border-l border-border bg-card shadow-2xl"
                    ref={drawerRef}
                    tabIndex={-1}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.stopPropagation();
                        closeManagedPanel();
                      }
                    }}
                  >
                    {/* Header */}
                    <div className="border-b border-border px-4 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <h4
                          id="ws-managed-panel-title"
                          className="min-w-0 truncate text-sm font-semibold text-foreground"
                        >
                          {t('ws.managedPanelTitle')}
                        </h4>
                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-2.5 py-1 text-xs text-foreground hover:bg-accent"
                            onClick={revealDir}
                          >
                            <FolderOpen className="h-3.5 w-3.5" /> {revealLabel}
                          </button>
                          <button
                            type="button"
                            aria-label={t('ws.managed.close')}
                            onClick={closeManagedPanel}
                            className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                      <p
                        data-testid="ws-managed-content-help"
                        className="mt-2 text-xs leading-relaxed text-muted-foreground"
                      >
                        ⓘ {t('ws.managed.managedContentHelp')}
                      </p>
                    </div>
                    {/* Scrollable content */}
                    <div className="flex-1 overflow-y-auto p-4">
                      <p
                        aria-live="polite"
                        data-testid="ws-managed-summary"
                        className="mb-4 text-xs text-muted-foreground"
                      >
                        {t('ws.managed.pendingRemove', {
                          count:
                            pendingRemoveSkills.length +
                            pendingRemoveRules.length,
                        })}
                      </p>

                      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                        {/* Skills section */}
                        <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-border">
                          <div className="flex items-center justify-between px-3 py-2">
                            <span className="text-xs font-semibold text-muted-foreground">
                              {t('ws.managed.sectionSkills', {
                                count: managedSkills.length,
                              })}
                            </span>
                            <div className="flex items-center gap-2">
                              <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer">
                                <input
                                  type="checkbox"
                                  data-testid="ws-managed-select-all-skills"
                                  aria-label={t('ws.managed.selectAllSkills')}
                                  aria-checked={
                                    managedSkillsPartiallyChecked
                                      ? 'mixed'
                                      : allManagedSkillsChecked
                                  }
                                  ref={(el) => {
                                    if (el)
                                      el.indeterminate =
                                        managedSkillsPartiallyChecked;
                                  }}
                                  checked={allManagedSkillsChecked}
                                  disabled={managedSkills.length === 0}
                                  onChange={() =>
                                    toggleManagedSelectAll('skill')
                                  }
                                  className="h-3.5 w-3.5"
                                />
                                {t('ws.managed.selectAllSkills')}
                              </label>
                              <button
                                type="button"
                                data-testid="ws-managed-clear-skills"
                                disabled={managedSkills.length === 0}
                                onClick={() => clearManagedSelection('skill')}
                                className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                              >
                                {t('ws.managed.clearAll')}
                              </button>
                            </div>
                          </div>
                          {managedSkills.map((item) => (
                            <div
                              key={item.id}
                              data-testid={`ws-managed-skill-${item.id}`}
                              className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 border-t border-border px-3 py-2"
                            >
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold text-foreground">
                                  {item.name}
                                </div>
                                <div className="truncate text-xs text-muted-foreground">
                                  {managedPlatform?.skills.find(
                                    (e) => e.id === item.id
                                  )?.path
                                    ? sanitizePath(
                                        managedPlatform.skills.find(
                                          (e) => e.id === item.id
                                        )!.path
                                      )
                                    : t('ws.managed.unknownNote')}
                                </div>
                              </div>
                              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                                {t('ws.managed.badgeManaged')}
                              </span>
                              <input
                                type="checkbox"
                                aria-label={`${t('ws.removeSkill')} ${item.name}`}
                                checked={pendingRemoveSkills.includes(item.id)}
                                onChange={() =>
                                  togglePendingRemove('skill', item.id)
                                }
                                className="h-3.5 w-3.5"
                              />
                            </div>
                          ))}
                        </div>

                        {/* Rules section */}
                        <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-border">
                          <div className="flex items-center justify-between px-3 py-2">
                            <span className="text-xs font-semibold text-muted-foreground">
                              {t('ws.managed.sectionRules', {
                                count: managedRules.length,
                              })}
                            </span>
                            <div className="flex items-center gap-2">
                              <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer">
                                <input
                                  type="checkbox"
                                  data-testid="ws-managed-select-all-rules"
                                  aria-label={t('ws.managed.selectAllRules')}
                                  aria-checked={
                                    managedRulesPartiallyChecked
                                      ? 'mixed'
                                      : allManagedRulesChecked
                                  }
                                  ref={(el) => {
                                    if (el)
                                      el.indeterminate =
                                        managedRulesPartiallyChecked;
                                  }}
                                  checked={allManagedRulesChecked}
                                  disabled={managedRules.length === 0}
                                  onChange={() =>
                                    toggleManagedSelectAll('rule')
                                  }
                                  className="h-3.5 w-3.5"
                                />
                                {t('ws.managed.selectAllRules')}
                              </label>
                              <button
                                type="button"
                                data-testid="ws-managed-clear-rules"
                                disabled={managedRules.length === 0}
                                onClick={() => clearManagedSelection('rule')}
                                className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                              >
                                {t('ws.managed.clearAll')}
                              </button>
                            </div>
                          </div>
                          {managedRules.map((item) => (
                            <div
                              key={item.id}
                              data-testid={`ws-managed-rule-${item.id}`}
                              className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 border-t border-border px-3 py-2"
                            >
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold text-foreground">
                                  {item.name}.{item.format}
                                </div>
                                <div className="truncate text-xs text-muted-foreground">
                                  {managedPlatform?.rules.find(
                                    (e) => e.id === item.id
                                  )?.path
                                    ? sanitizePath(
                                        managedPlatform.rules.find(
                                          (e) => e.id === item.id
                                        )!.path
                                      )
                                    : t('ws.managed.unknownNote')}
                                </div>
                              </div>
                              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                                {t('ws.managed.badgeManaged')}
                              </span>
                              <input
                                type="checkbox"
                                aria-label={`${t('ws.removeRule')} ${item.name}`}
                                checked={pendingRemoveRules.includes(item.id)}
                                onChange={() =>
                                  togglePendingRemove('rule', item.id)
                                }
                                className="h-3.5 w-3.5"
                              />
                            </div>
                          ))}
                        </div>
                      </div>

                      {keepEntries.length > 0 && (
                        <div className="mt-3 rounded-lg border border-border">
                          <div className="px-3 py-2 text-xs font-semibold text-muted-foreground">
                            {t('ws.localUnmanagedContent')}
                          </div>
                          <p className="px-3 pb-1 text-xs text-muted-foreground">
                            {t('ws.localUnmanagedHint')}
                          </p>
                          {keepEntries.map((item) => (
                            <div
                              key={item.key}
                              data-testid={`ws-managed-local-${item.name}`}
                              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-t border-border px-3 py-2"
                            >
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold text-foreground">
                                  {item.name}
                                </div>
                                <div className="truncate text-xs text-muted-foreground">
                                  {sanitizePath(item.path)}
                                </div>
                                <div className="truncate text-xs text-muted-foreground">
                                  {t('ws.managed.unknownNote')}
                                </div>
                              </div>
                              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                                <span className="h-1.5 w-1.5 rounded-full bg-muted" />
                                {t('ws.managed.badgeKeep')}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="mt-3 flex items-center justify-between border-t border-border px-3 pt-2.5">
                        <div className="text-xs text-muted-foreground">
                          {t('ws.managed.confirmHint')}
                        </div>
                        <button
                          type="button"
                          data-testid="ws-managed-confirm-remove"
                          disabled={pendingTotal === 0 || backgroundRunning}
                          onClick={() => setConfirmRemoveOpen(true)}
                          className={cn(
                            'rounded-lg px-4 py-2 text-sm font-medium',
                            pendingTotal > 0 && !backgroundRunning
                              ? 'bg-error text-white hover:opacity-90'
                              : 'bg-muted text-muted-foreground cursor-not-allowed'
                          )}
                        >
                          {t('ws.managed.confirmRemove', {
                            count: pendingTotal,
                          })}
                        </button>
                      </div>

                      {pendingRemoveResult && (
                        <div
                          aria-live="polite"
                          data-testid="ws-managed-remove-result"
                          className={cn(
                            'mt-3 rounded-lg border px-3 py-2 text-sm',
                            pendingRemoveResult.status === 'success' &&
                              'border-success/40 bg-success/10 text-success',
                            (pendingRemoveResult.status === 'partial' ||
                              pendingRemoveResult.status === 'failed') &&
                              'border-warning/40 bg-warning/10 text-warning'
                          )}
                        >
                          {pendingRemoveResult.status === 'running' &&
                            t('ws.executing')}
                          {pendingRemoveResult.status === 'success' &&
                            t('ws.removeResult.success', {
                              count: pendingRemoveResult.removed.length,
                            })}
                          {pendingRemoveResult.status === 'partial' && (
                            <>
                              {t('ws.removeResult.partial', {
                                removed: pendingRemoveResult.removed.length,
                                failed: pendingRemoveResult.errors.length,
                              })}
                              <ul className="mt-1 space-y-0.5 text-xs">
                                {pendingRemoveResult.errors.map((err, i) => (
                                  <li key={i}>{err}</li>
                                ))}
                              </ul>
                            </>
                          )}
                          {pendingRemoveResult.status === 'failed' &&
                            t('ws.removeResult.failed')}
                        </div>
                      )}
                    </div>
                  </aside>
                </>
              )}
            </div>
          </div>

          <div
            data-testid="ws-step1-actions"
            className="workspace-actions mt-5 flex flex-wrap items-center gap-2"
          >
            <button
              type="button"
              className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              onClick={nextFromTarget}
              disabled={!platformId}
            >
              {t('ws.nextToResources')}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Resources ── */}
      {step === 2 && (
        <div className="rounded-lg border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3">
            2. {t('ws.step2.title')}
          </h3>
          <div>
            <label
              className="mb-1 block text-sm font-medium text-foreground"
              htmlFor="dist-source"
            >
              {t('ws.sourceLabel')}
            </label>
            <select
              id="dist-source"
              aria-label={t('ws.sourceLabel')}
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                setSelectedSkills([]);
                setSelectedRules([]);
                setPlan(null);
                setPlanStale(false);
              }}
              className={cn(SELECT_CLASSES, 'w-full max-w-[420px]')}
            >
              <optgroup label={t('ws.sourceAll')}>
                <option value="all">
                  {t('ws.sourceAllOption', {
                    skills: skills.length,
                    rules: rules.length,
                  })}
                </option>
              </optgroup>
              <optgroup label={t('ws.sourceScene')}>
                {scenes.map((sc) => (
                  <option key={sc.id} value={`scene:${sc.id}`}>
                    {t('ws.sourceSceneOption', { name: sc.name })}
                  </option>
                ))}
              </optgroup>
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('ws.sourceHint')}
            </p>
            {source.startsWith('scene:') && (
              <div
                role="status"
                data-testid="ws-scene-source"
                className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-foreground"
              >
                <span className="font-medium">
                  {t('ws.sourceFromScene', {
                    name:
                      scenes.find((s) => s.id === source.slice(6))?.name ||
                      source.slice(6),
                  })}
                </span>
                <span className="text-muted-foreground">
                  {t('ws.noWritebackHint')}
                </span>
                {sceneSourceLoadFailed && (
                  <span
                    role="alert"
                    data-testid="ws-scene-source-failed"
                    className="text-destructive"
                  >
                    {t('ws.sceneSourceLoadFailed')}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-4">
            <fieldset className="min-w-0 flex-1 basis-64 rounded-lg border border-border p-3">
              <legend className="px-1 text-xs text-muted-foreground">
                {t('ws.skillsLegend', { count: selectedSkills.length })}
              </legend>
              <div className="mb-2 flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    data-testid="ws-select-all-skills"
                    aria-label={t('ws.selectAllSkills')}
                    aria-checked={
                      skillsPartiallyChecked ? 'mixed' : allSkillsChecked
                    }
                    ref={(el) => {
                      if (el) el.indeterminate = skillsPartiallyChecked;
                    }}
                    checked={allSkillsChecked}
                    disabled={poolSkills.length === 0}
                    onChange={(e) =>
                      e.target.checked
                        ? setSelectedSkills(poolSkills.map((s) => s.id))
                        : setSelectedSkills([])
                    }
                    className="h-3.5 w-3.5"
                  />
                  {t('ws.selectAllSkills')}
                </label>
                <button
                  type="button"
                  data-testid="ws-clear-skills"
                  disabled={poolSkills.length === 0}
                  onClick={() => setSelectedSkills([])}
                  className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  {t('ws.clearAll')}
                </button>
              </div>
              <div
                data-testid="ws-skills-list"
                className="max-h-[220px] space-y-1 overflow-y-auto pr-1"
              >
                {poolSkills.map((skill) => {
                  const checked = selectedSkills.includes(skill.id);
                  return (
                    <label
                      key={skill.id}
                      className={cn(
                        'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer',
                        checked
                          ? 'bg-primary/10 text-primary'
                          : 'hover:bg-accent/50'
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelect('skill', skill.id)}
                        className="h-3.5 w-3.5"
                      />
                      <span className="flex-1 truncate">{skill.name}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="min-w-0 flex-1 basis-64 rounded-lg border border-border p-3">
              <legend className="px-1 text-xs text-muted-foreground">
                {t('ws.rulesLegend', { count: selectedRules.length })}
              </legend>
              <div className="mb-2 flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    data-testid="ws-select-all-rules"
                    aria-label={t('ws.selectAllRules')}
                    aria-checked={
                      rulesPartiallyChecked ? 'mixed' : allRulesChecked
                    }
                    ref={(el) => {
                      if (el) el.indeterminate = rulesPartiallyChecked;
                    }}
                    checked={allRulesChecked}
                    disabled={poolRules.length === 0}
                    onChange={(e) =>
                      e.target.checked
                        ? setSelectedRules(poolRules.map((r) => r.id))
                        : setSelectedRules([])
                    }
                    className="h-3.5 w-3.5"
                  />
                  {t('ws.selectAllRules')}
                </label>
                <button
                  type="button"
                  data-testid="ws-clear-rules"
                  disabled={poolRules.length === 0}
                  onClick={() => setSelectedRules([])}
                  className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  {t('ws.clearAll')}
                </button>
              </div>
              <div
                data-testid="ws-rules-list"
                className="max-h-[220px] space-y-1 overflow-y-auto pr-1"
              >
                {poolRules.map((rule) => {
                  const checked = selectedRules.includes(rule.id);
                  return (
                    <label
                      key={rule.id}
                      className={cn(
                        'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer',
                        checked
                          ? 'bg-primary/10 text-primary'
                          : 'hover:bg-accent/50'
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelect('rule', rule.id)}
                        className="h-3.5 w-3.5"
                      />
                      <span className="flex-1 truncate">{rule.name}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </div>

          <div className="mt-2 text-xs text-muted-foreground">
            {t('ws.sourceHint')}
          </div>

          <div className="workspace-actions mt-5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              onClick={nextToPlan}
            >
              {t('ws.nextToPlan')}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2.5 text-sm text-foreground hover:bg-accent"
              onClick={back}
            >
              <ArrowLeft className="h-4 w-4" /> {t('ws.backStep')}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Plan ── */}
      {step === 3 && (
        <div className="rounded-lg border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-1">
            3. {t('ws.step3.title')}
          </h3>
          <div className="mb-3 text-sm font-medium text-foreground">
            {t('ws.planTitle')}
          </div>
          {phase === 'planning' && (
            <div className="space-y-2" role="status">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin" />{' '}
                {t('ws.planGenerating')}
              </div>
            </div>
          )}

          {phase === 'plan_ready' && plan && (
            <div className="space-y-3">
              {planStale && (
                <div
                  className="flex items-center justify-between gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning"
                  role="alert"
                >
                  <span>{t('ws.planStale')}</span>
                  <button
                    type="button"
                    className="rounded border border-warning/40 px-2 py-1 text-xs hover:bg-warning/20"
                    onClick={rescan}
                  >
                    {t('ws.rescan')}
                  </button>
                </div>
              )}
              {!hasChanges && (
                <div className="rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
                  {t('ws.planNoChange')}
                </div>
              )}

              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <div className="text-xs text-muted-foreground">
                  {t('ws.skillsPathLabel')}
                </div>
                <div
                  data-testid="ws-step3-skills-path"
                  className="truncate font-mono text-xs text-foreground"
                >
                  {targetDisplayPath || t('ws.pathUnavailable')}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {t('ws.rulesPathLabel')}
                </div>
                <div
                  data-testid="ws-step3-rules-path"
                  className="truncate font-mono text-xs text-foreground"
                >
                  {rulesTargetDisplayPath || t('ws.pathUnavailable')}
                </div>
                {rulesSingleFile && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('ws.rulesSingleFileHint')}
                  </p>
                )}

                {planPlatform && (
                  <div className="mt-3 grid grid-cols-2 gap-4">
                    <PlanSection
                      title={t('ws.planSkills')}
                      adds={planPlatform.skills_to_add.map((id) =>
                        nameForSkill(id)
                      )}
                      updates={planPlatform.skills_to_update.map((id) =>
                        nameForSkill(id)
                      )}
                      removes={planPlatform.skills_to_remove.map((id) =>
                        nameForSkill(id)
                      )}
                      t={t}
                    />
                    <PlanSection
                      title={t('ws.planRules')}
                      adds={planPlatform.rules_to_add.map((id) =>
                        nameForRule(id)
                      )}
                      updates={planPlatform.rules_to_update.map((id) =>
                        nameForRule(id)
                      )}
                      removes={planPlatform.rules_to_remove.map((id) =>
                        nameForRule(id)
                      )}
                      t={t}
                    />
                  </div>
                )}

                <p className="mt-3 text-xs text-muted-foreground">
                  {t('ws.planRuleWriteNote')}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('ws.planConflictNote')}
                </p>
              </div>
            </div>
          )}

          <div className="workspace-actions mt-5 flex flex-wrap items-center gap-2">
            <div role="status" aria-live="polite">
              <button
                type="button"
                disabled={
                  !hasChanges ||
                  planStale ||
                  phase === 'planning' ||
                  backgroundRunning
                }
                onClick={confirmDistribution}
                className={cn(
                  'rounded-lg px-5 py-2.5 text-sm font-medium',
                  hasChanges &&
                    !planStale &&
                    phase === 'plan_ready' &&
                    !backgroundRunning
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'bg-muted text-muted-foreground cursor-not-allowed'
                )}
              >
                {t('ws.confirmDistribute')}
              </button>
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2.5 text-sm text-foreground hover:bg-accent"
              onClick={back}
            >
              <ArrowLeft className="h-4 w-4" /> {t('ws.backStep')}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 4: Execute / Result ── */}
      {step === 4 && (
        <div className="rounded-lg border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3">
            4. {t('ws.step4.title')}
          </h3>
          {phase === 'executing' && (
            <div className="space-y-2" role="status">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin" />{' '}
                {t('ws.executing')}
              </div>
              <p className="text-xs text-muted-foreground">
                {t('ws.executingHint')}
              </p>
              <div className="workspace-actions mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2.5 text-sm text-foreground hover:bg-accent"
                  onClick={back}
                >
                  {t('ws.cancelExecution')}
                </button>
              </div>
            </div>
          )}

          {phase === 'result' && result && (
            <ResultPanel
              result={result}
              t={t}
              onRetry={retryFailed}
              onBack={backToWorkspace}
            />
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmRemoveOpen}
        title={t('ws.removeConfirm.title')}
        message={t('ws.removeConfirm.desc')}
        variant="danger"
        confirmLabel={t('ws.removeConfirm.confirm')}
        cancelLabel={t('ws.removeConfirm.cancel')}
        onConfirm={runRemoveDistributed}
        onCancel={() => setConfirmRemoveOpen(false)}
      >
        <div
          data-testid="ws-remove-confirm-items"
          className="mb-4 max-h-[240px] space-y-1 overflow-y-auto rounded-lg border border-border bg-muted/30 p-3 text-sm"
        >
          {pendingRemoveSkills.length > 0 && (
            <div className="text-xs font-semibold text-foreground">
              {t('ws.planSkills')}
            </div>
          )}
          {pendingRemoveSkills.map((id) => {
            const skill = skills.find((s) => s.id === id);
            const path = managedPlatform?.skills.find((e) => e.id === id)?.path;
            return (
              <div
                key={`skill-${id}`}
                className="flex items-center justify-between gap-2 py-0.5"
              >
                <span className="truncate">{skill?.name || id}</span>
                <span className="truncate font-mono text-xs text-muted-foreground">
                  {path ? sanitizePath(path) : ''}
                </span>
              </div>
            );
          })}
          {pendingRemoveRules.length > 0 && (
            <div className="pt-1 text-xs font-semibold text-foreground">
              {t('ws.planRules')}
            </div>
          )}
          {pendingRemoveRules.map((id) => {
            const rule = rules.find((r) => r.id === id);
            const path = managedPlatform?.rules.find((e) => e.id === id)?.path;
            return (
              <div
                key={`rule-${id}`}
                className="flex items-center justify-between gap-2 py-0.5"
              >
                <span className="truncate">{rule?.name || id}</span>
                <span className="truncate font-mono text-xs text-muted-foreground">
                  {path ? sanitizePath(path) : ''}
                </span>
              </div>
            );
          })}
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={invalidSceneRefs !== null}
        title={t('ws.invalidRefsTitle')}
        message={t('ws.invalidRefsMessage', {
          skills: invalidSceneRefs?.skills ?? 0,
          rules: invalidSceneRefs?.rules ?? 0,
        })}
        confirmLabel={t('ws.invalidRefsUseValid')}
        cancelLabel={t('ws.invalidRefsCleanup')}
        onConfirm={continueWithValidOnly}
        onCancel={returnToSceneConfig}
      />
    </div>
  );
});

const PlanSection = memo(function PlanSection({
  title,
  adds,
  updates,
  removes,
  t,
}: {
  title: string;
  adds: string[];
  updates: string[];
  removes: string[];
  t: (key: string, params?: Record<string, unknown>) => string;
}) {
  const PlanRow = ({
    action,
    label,
  }: {
    action: 'add' | 'update' | 'remove';
    label: string;
  }) => (
    <div className="flex items-center gap-2 py-0.5 text-sm">
      <span
        className={cn(
          'inline-block w-10 shrink-0 text-xs font-medium',
          action === 'add' && 'text-success',
          action === 'update' && 'text-foreground',
          action === 'remove' && 'text-warning'
        )}
      >
        {action === 'add'
          ? t('ws.actionAdd')
          : action === 'update'
            ? t('ws.actionUpdate')
            : t('ws.actionRemove')}
      </span>
      <span className="truncate">{label}</span>
    </div>
  );
  const hasContent = adds.length + updates.length + removes.length > 0;
  return (
    <div>
      <div className="mb-1 text-xs font-semibold text-foreground">{title}</div>
      {!hasContent && (
        <div className="text-xs text-muted-foreground">
          {t('ws.planNoChange')}
        </div>
      )}
      {adds.map((name) => (
        <PlanRow key={`a-${name}`} action="add" label={name} />
      ))}
      {updates.map((name) => (
        <PlanRow key={`u-${name}`} action="update" label={name} />
      ))}
      {removes.map((name) => (
        <PlanRow key={`r-${name}`} action="remove" label={name} />
      ))}
    </div>
  );
});

const ResultPanel = memo(function ResultPanel({
  result,
  t,
  onRetry,
  onBack,
}: {
  result: SyncResult;
  t: (key: string, params?: Record<string, unknown>) => string;
  onRetry: () => void;
  onBack: () => void;
}) {
  const rows = [
    { key: 'ws.resultInstalled', value: result.installed.length },
    { key: 'ws.resultUpdated', value: result.updated.length },
    {
      key: 'ws.resultSkipped',
      value:
        typeof result.skipped === 'number'
          ? result.skipped
          : t('ws.resultSkippedNa'),
      title:
        typeof result.skipped === 'number'
          ? undefined
          : t('ws.resultSkippedHint'),
    },
    { key: 'ws.resultErrors', value: result.errors.length },
  ];
  const hasErrors = result.errors.length > 0;
  return (
    <div data-testid="ws-result-card" aria-live="polite" className="space-y-3">
      <h4 className="text-sm font-semibold text-foreground">
        {t('ws.resultTitle')}
      </h4>
      <div
        className={cn(
          'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm',
          hasErrors
            ? 'border-warning/40 bg-warning/10 text-warning'
            : 'border-success/40 bg-success/10 text-success'
        )}
      >
        <span
          className={cn(
            'h-2 w-2 rounded-full',
            hasErrors ? 'bg-warning' : 'bg-success'
          )}
        />
        {hasErrors ? t('ws.resultPartialFail') : t('ws.resultDone')}
      </div>
      <div className="grid grid-cols-4 gap-2">
        {rows.map((row) => (
          <div
            key={row.key}
            className="rounded-lg border border-border bg-muted/20 p-3 text-center"
          >
            <div className="text-xs text-muted-foreground">{t(row.key)}</div>
            <div
              data-testid={`ws-result-${row.key.split('.').pop()}`}
              title={row.title}
              className="text-xl font-semibold text-foreground"
            >
              {row.value}
            </div>
          </div>
        ))}
      </div>
      {hasErrors && (
        <ul className="space-y-1 text-xs text-destructive">
          {result.errors.map((err, i) => (
            <li key={i}>{err}</li>
          ))}
        </ul>
      )}
      <div className="workspace-actions mt-4 flex flex-wrap items-center gap-2">
        {hasErrors && (
          <button
            type="button"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            onClick={onRetry}
          >
            {t('ws.retryFailed')}
          </button>
        )}
        <button
          type="button"
          className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-accent"
          onClick={onBack}
        >
          {t('ws.backToWorkspace')}
        </button>
      </div>
    </div>
  );
});

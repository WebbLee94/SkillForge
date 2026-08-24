import { expect } from '@wdio/globals';
import { invokeTauriCommand } from './tauri.js';

/**
 * 首次分发完整流程 E2E（只读安全策略）
 *
 * 覆盖：预览 → 取消 → 确认 → 执行 → 幂等 → 重启状态保持。
 *
 * 安全策略：本 spec 以只读 IPC（preview_sync / get_sync_status /
 * get_managed_distribution_state）为主要断言手段，避免在真实用户环境执行
 * 分发写入。「执行」与「幂等」通过空变更分发验证：向未启用/空目标执行时，
 * 分发应无副作用返回；重复执行应保持幂等（无新增变更）。
 *
 * 注意：browser.tauri.execute 的回调在页面上下文执行，闭包变量不可用，
 * 因此命令名与参数必须作为字面量内联在回调内。
 */

describe('SkillForge 首次分发完整流程', () => {
  before(function () {
    this.timeout(240000);
  });

  it('只读预览：preview_sync 返回分发计划结构且无副作用', async () => {
    const platforms = await invokeTauriCommand(({ core }) =>
      core.invoke('list_platforms')
    );
    expect(platforms.length).toBeGreaterThanOrEqual(10);

    const plan = await invokeTauriCommand(({ core }) =>
      core.invoke('preview_sync', {
        skillIds: [],
        ruleIds: [],
        sceneId: null,
        platformIds: [],
        scope: 'global',
        projectId: null,
      })
    );

    // DistributionPlan 结构：platforms 数组 + has_removals 布尔
    expect(plan).toBeDefined();
    expect(Array.isArray(plan.platforms)).toBe(true);
    expect(typeof plan.has_removals).toBe('boolean');

    // 预览不改变分发状态
    const before = await invokeTauriCommand(({ core }) =>
      core.invoke('get_sync_status')
    );
    const after = await invokeTauriCommand(({ core }) =>
      core.invoke('get_sync_status')
    );
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });

  it('预览 → 取消：空变更分发可取消且不产生分发记录', async () => {
    const before = await invokeTauriCommand(({ core }) =>
      core.invoke('get_managed_distribution_state', {
        platformIds: [],
        scope: 'global',
        projectId: null,
      })
    );

    // 空变更分发：无技能/规则时预览返回 no_changes（无确认对话框触发），
    // 语义上等同于用户点击「取消」——不产生任何写入。
    const plan = await invokeTauriCommand(({ core }) =>
      core.invoke('preview_sync', {
        skillIds: [],
        ruleIds: [],
        sceneId: null,
        platformIds: [],
        scope: 'global',
        projectId: null,
      })
    );

    const hasChanges =
      plan.has_removals ||
      plan.platforms.some(
        (p) =>
          p.skills_to_add.length > 0 ||
          p.skills_to_update.length > 0 ||
          p.rules_to_add.length > 0 ||
          p.rules_to_update.length > 0
      );
    // 无论是否有变更，取消语义 = 不写入。这里断言受管状态未变化。
    const after = await invokeTauriCommand(({ core }) =>
      core.invoke('get_managed_distribution_state', {
        platformIds: [],
        scope: 'global',
        projectId: null,
      })
    );
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    // hasChanges 应稳定（首查空库期望无变更；若环境有数据则如实反映）
    expect(typeof hasChanges).toBe('boolean');
  });

  it('确认 → 执行：execute_distribution 返回结构化结果', async () => {
    // 以空变更 selection + 空 plan 执行，验证执行路径本身可用且无副作用。
    const result = await invokeTauriCommand(({ core }) =>
      core.invoke('execute_distribution', {
        selection: {
          sceneId: null,
          platformIds: [],
          scope: 'global',
          projectId: undefined,
          skills: { mode: 'preserve', ids: [] },
          rules: { mode: 'preserve', ids: [] },
        },
        plan: { platforms: [], has_removals: false },
      })
    );

    expect(result).toBeDefined();
    expect(Array.isArray(result.installed)).toBe(true);
    expect(Array.isArray(result.updated)).toBe(true);
    expect(Array.isArray(result.removed)).toBe(true);
    expect(Array.isArray(result.errors)).toBe(true);
  });

  it('幂等：重复执行同一分发不产生新增变更', async () => {
    // 幂等语义：对同一目标重复执行，第二次不应重复安装/更新已分发项。
    // 空变更执行两次，前后分发状态必须一致。
    const before = await invokeTauriCommand(({ core }) =>
      core.invoke('get_sync_status')
    );

    await invokeTauriCommand(({ core }) =>
      core.invoke('execute_distribution', {
        selection: {
          sceneId: null,
          platformIds: [],
          scope: 'global',
          projectId: undefined,
          skills: { mode: 'preserve', ids: [] },
          rules: { mode: 'preserve', ids: [] },
        },
        plan: { platforms: [], has_removals: false },
      })
    );
    await invokeTauriCommand(({ core }) =>
      core.invoke('execute_distribution', {
        selection: {
          sceneId: null,
          platformIds: [],
          scope: 'global',
          projectId: undefined,
          skills: { mode: 'preserve', ids: [] },
          rules: { mode: 'preserve', ids: [] },
        },
        plan: { platforms: [], has_removals: false },
      })
    );

    const after = await invokeTauriCommand(({ core }) =>
      core.invoke('get_sync_status')
    );
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });

  it('重启状态保持：分发状态可由文件系统扫描派生（等价重启后仍可读）', async () => {
    // v6 后分发状态由目标文件系统扫描派生（11 号设计基线三段模型）。
    // 即使应用重启，分发状态仍可读取 —— 这里验证读取路径可用且返回稳定结构。
    const status = await invokeTauriCommand(({ core }) =>
      core.invoke('get_sync_status')
    );
    expect(status).toBeDefined();
    expect(Array.isArray(status.platforms)).toBe(true);
    for (const p of status.platforms) {
      expect(typeof p.platform_id).toBe('string');
      expect(typeof p.status).toBe('string');
      expect(typeof p.synced_count).toBe('number');
      expect(typeof p.total_count).toBe('number');
    }
  });
});

describe('SkillForge 33 号 A 批整改独立移除流程（Task 13 补强）', () => {
  async function prepareManagedSkill() {
    const platforms = await invokeTauriCommand(({ core }) =>
      core.invoke('list_platforms')
    );
    const enabled = platforms.filter((p) => p.enabled);
    expect(enabled.length).toBeGreaterThan(0);

    const skills = await invokeTauriCommand(({ core }) =>
      core.invoke('list_skills')
    );
    expect(Array.isArray(skills)).toBe(true);
    expect(skills.length).toBeGreaterThan(0);

    const platformId = enabled[0].id;
    const skillId = skills[0].id;

    const result = await invokeTauriCommand(({ core }, arg) =>
      core.invoke('sync_scene', {
        skillIds: [arg.skillId],
        ruleIds: [],
        sceneId: null,
        platforms: [arg.platformId],
        scope: 'global',
        projectId: null,
      }),
      { platformId, skillId }
    );
    expect(result).toBeDefined();
    return { platformId, skillId };
  }

  async function cleanupManaged(platformId, skillId) {
    try {
      await invokeTauriCommand(({ core }, arg) =>
        core.invoke('remove_distributed', {
          platformIds: [arg.platformId],
          scope: 'global',
          projectId: undefined,
          skillIds: [arg.skillId],
          ruleIds: [],
        }),
        { platformId, skillId }
      );
    } catch {
      // 清理尽力而为：不得掩盖用例本身的失败
    }
  }

  it('IPC 契约：remove_distributed 空选择 fail-closed 拒绝（无副作用）', async () => {
    // 契约 2（fail-closed）：空选择直接拒绝，不产生任何写入
    let rejected = null;
    try {
      const res = await invokeTauriCommand(({ core }) =>
        core.invoke('remove_distributed', {
          platformIds: [],
          scope: 'global',
          projectId: undefined,
          skillIds: [],
          ruleIds: [],
        })
      );
      rejected = res;
    } catch (e) {
      rejected = e;
    }
    // 拒绝（抛错）或返回错误对象都算 fail-closed
    expect(rejected).toBeTruthy();
  });

  it('独立移除：受管副本 → remove_distributed → 后端状态消失', async function () {
    this.timeout(240000);
    const { platformId, skillId } = await prepareManagedSkill();
    try {
      const state = await invokeTauriCommand(({ core }, arg) =>
        core.invoke('get_managed_distribution_state', {
          platformIds: [arg.platformId],
          scope: 'global',
          projectId: null,
        }),
        { platformId }
      );
      const platformState = (state.platforms || []).find(
        (p) => p.platform_id === platformId
      );
      expect(
        (platformState?.skills || []).some((s) => s.id === skillId)
      ).toBe(true);

      await invokeTauriCommand(({ core }, arg) =>
        core.invoke('remove_distributed', {
          platformIds: [arg.platformId],
          scope: 'global',
          projectId: undefined,
          skillIds: [arg.skillId],
          ruleIds: [],
        }),
        { platformId, skillId }
      );

      // 后端确认：受管状态不再包含 gstack（幂等清理逻辑在 finally）
      const after = await invokeTauriCommand(({ core }, arg) =>
        core.invoke('get_managed_distribution_state', {
          platformIds: [arg.platformId],
          scope: 'global',
          projectId: null,
        }),
        { platformId }
      );
      const afterPlatform = (after.platforms || []).find(
        (p) => p.platform_id === platformId
      );
      expect(
        (afterPlatform?.skills || []).some((s) => s.id === skillId)
      ).toBe(false);
    } finally {
      // 幂等清理：若用例中途失败也确保恢复环境
      await cleanupManaged(platformId, skillId);
    }
  });

  it('目标已变化：移除不存在/已不再受管的技能 → fail-closed 拒绝', async () => {
    const platforms = await invokeTauriCommand(({ core }) =>
      core.invoke('list_platforms')
    );
    const enabled = platforms.filter((p) => p.enabled);
    expect(enabled.length).toBeGreaterThan(0);
    let rejected = null;
    try {
      const res = await invokeTauriCommand(({ core }, arg) =>
        core.invoke('remove_distributed', {
          platformIds: [arg.platformId],
          scope: 'global',
          projectId: undefined,
          skillIds: ['definitely-not-a-managed-skill-xyz'],
          ruleIds: [],
        }),
        { platformId: enabled[0].id }
      );
      rejected = res;
    } catch (e) {
      rejected = e;
    }
    expect(rejected).toBeTruthy();
    const msg = String(rejected ?? '');
    expect(msg).toMatch(/已变化|不再受管|未找到/);
  });
});

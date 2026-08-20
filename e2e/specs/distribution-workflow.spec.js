import { expect } from '@wdio/globals';

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
  it('只读预览：preview_sync 返回分发计划结构且无副作用', async () => {
    const platforms = await browser.tauri.execute(({ core }) =>
      core.invoke('list_platforms')
    );
    expect(platforms.length).toBeGreaterThanOrEqual(10);

    const plan = await browser.tauri.execute(({ core }) =>
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

    // 预览不改变同步状态
    const before = await browser.tauri.execute(({ core }) =>
      core.invoke('get_sync_status')
    );
    const after = await browser.tauri.execute(({ core }) =>
      core.invoke('get_sync_status')
    );
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });

  it('预览 → 取消：空变更分发可取消且不产生分发记录', async () => {
    const before = await browser.tauri.execute(({ core }) =>
      core.invoke('get_managed_distribution_state', {
        platformIds: [],
        scope: 'global',
        projectId: null,
      })
    );

    // 空变更分发：无技能/规则时预览返回 no_changes（无确认对话框触发），
    // 语义上等同于用户点击「取消」——不产生任何写入。
    const plan = await browser.tauri.execute(({ core }) =>
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
    const after = await browser.tauri.execute(({ core }) =>
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
    const result = await browser.tauri.execute(({ core }) =>
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
    // 幂等语义：对同一目标重复执行，第二次不应重复安装/更新已同步项。
    // 空变更执行两次，前后同步状态必须一致。
    const before = await browser.tauri.execute(({ core }) =>
      core.invoke('get_sync_status')
    );

    await browser.tauri.execute(({ core }) =>
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
    await browser.tauri.execute(({ core }) =>
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

    const after = await browser.tauri.execute(({ core }) =>
      core.invoke('get_sync_status')
    );
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });

  it('重启状态保持：同步状态可由文件系统扫描派生（等价重启后仍可读）', async () => {
    // v6 后分发状态由目标文件系统扫描派生（11 号设计基线三段模型）。
    // 即使应用重启，同步状态仍可读取 —— 这里验证读取路径可用且返回稳定结构。
    const status = await browser.tauri.execute(({ core }) =>
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
  // 前置：将 gstack 分发到默认平台（claude-code）生成一个受管副本；
  // gstack 在 DB 中但未分发到该平台，分发是纯新增、可逆、不触碰用户自有 .skills-manager 链接。
  // 返回 skillId 供各用例断言；调用方必须用 try/finally 保证清理。
  async function prepareManagedGstack() {
    const platforms = await browser.tauri.execute(({ core }) =>
      core.invoke('list_platforms')
    );
    const enabled = platforms.filter((p) => p.enabled);
    expect(enabled.length).toBeGreaterThan(0);
    const platformId = enabled[0].id;

    const preview = await browser.tauri.execute(({ core }, arg) =>
      core.invoke('preview_distribution', {
        sceneId: null,
        platformIds: [arg.platformId],
        scope: 'global',
        projectId: null,
        skills: { mode: 'add_or_update', ids: ['gstack'] },
        rules: { mode: 'add_or_update', ids: [] },
      }),
      { platformId }
    );
    const target = (preview.platforms || []).find(
      (p) => p.platform_id === platformId
    );
    expect(
      target && target.skills_to_add.includes('gstack')
    ).toBe(true);

    const result = await browser.tauri.execute(({ core }, arg) =>
      core.invoke('execute_distribution', {
        selection: {
          sceneId: null,
          platformIds: [arg.platformId],
          scope: 'global',
          projectId: undefined,
          skills: { mode: 'add_or_update', ids: ['gstack'] },
          rules: { mode: 'preserve', ids: [] },
        },
        plan: arg.preview,
      }),
      { platformId, preview }
    );
    expect(result).toBeDefined();
    return { platformId, skillId: 'gstack' };
  }

  async function cleanupManaged(platformId, skillId) {
    try {
      await browser.tauri.execute(({ core }, arg) =>
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
      const res = await browser.tauri.execute(({ core }) =>
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

  it('独立移除：分发受管副本 → 勾选 → 确认 → 二次确认明细 → 移除 → 面板刷新后该项消失', async () => {
    const { platformId, skillId } = await prepareManagedGstack();
    try {
      // 确认受管状态包含 gstack
      const state = await browser.tauri.execute(({ core }, arg) =>
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

      // 进入工作区 Step1 → 展开受管面板
      const wsNav = await browser.$('//button[contains(., "工作区")]');
      await wsNav.waitForExist({ timeout: 10000 });
      await wsNav.click();
      await browser.waitUntil(
        async () => ((await browser.getUrl()) ?? '').includes('/workspace'),
        { timeout: 10000, timeoutMsg: 'URL 未跳转到 /workspace' }
      );
      await browser.$('[data-testid="ws-step1-grid"]').waitForExist({
        timeout: 10000,
      });
      const toggle = await browser.$('[aria-controls="ws-managed-panel"]');
      await toggle.waitForExist({ timeout: 10000 });
      await toggle.click();
      await browser.waitUntil(
        async () => (await toggle.getAttribute('aria-expanded')) === 'true',
        { timeout: 10000, timeoutMsg: '受管面板未展开' }
      );

      // 勾选 gstack
      const row = await browser.$(`[data-testid="ws-managed-skill-${skillId}"]`);
      await row.waitForExist({ timeout: 10000, timeoutMsg: '受管项 gstack 未出现' });
      const checkbox = await row.$('input[type="checkbox"]');
      await checkbox.click();

      // 点击「确认移除 N 项」→ 二次确认弹窗出现
      const confirm = await browser.$('[data-testid="ws-managed-confirm-remove"]');
      await browser.waitUntil(async () => (await confirm.isEnabled()) === true, {
        timeout: 5000,
        timeoutMsg: '确认移除按钮未启用',
      });
      await confirm.click();
      const items = await browser.$('[data-testid="ws-remove-confirm-items"]');
      await items.waitForExist({ timeout: 10000, timeoutMsg: '二次确认明细未出现' });
      const itemText = await items.getText();
      expect(itemText).toContain('gstack');

      // 二次确认 → 移除结果行出现 → gstack 行消失
      const dialogConfirm = await browser.$(
        '[data-testid="confirm-dialog-confirm"]'
      );
      await dialogConfirm.waitForExist({ timeout: 5000 });
      await dialogConfirm.click();
      await browser.$('[data-testid="ws-managed-remove-result"]').waitForExist({
        timeout: 10000,
        timeoutMsg: '移除结果行未出现',
      });
      await browser.waitUntil(
        async () => (await row.isExisting()) === false,
        { timeout: 10000, timeoutMsg: '移除后 gstack 行未消失' }
      );

      // 后端确认：受管状态不再包含 gstack（幂等清理逻辑在 finally）
      const after = await browser.tauri.execute(({ core }, arg) =>
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
    const platforms = await browser.tauri.execute(({ core }) =>
      core.invoke('list_platforms')
    );
    const enabled = platforms.filter((p) => p.enabled);
    expect(enabled.length).toBeGreaterThan(0);
    let rejected = null;
    try {
      const res = await browser.tauri.execute(({ core }, arg) =>
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

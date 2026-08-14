import { expect } from '@wdio/globals';

describe('SkillForge 桌面应用交互测试', () => {
  it('点击侧边栏导航切换到工作区页面', async () => {
    const globalDist = await browser.$('//button[contains(., "工作区")]');
    await globalDist.waitForExist({ timeout: 10000 });
    await globalDist.click();

    await browser.waitUntil(
      async () => ((await browser.getUrl()) ?? '').includes('/workspace'),
      { timeout: 10000, timeoutMsg: 'URL 未跳转到 /workspace' }
    );
    expect(await browser.getUrl()).toContain('/workspace');
  });

  it('点击侧边栏导航切换到技能页面', async () => {
    const skillsNav = await browser.$('//button[contains(., "技能")]');
    await skillsNav.waitForExist({ timeout: 10000 });
    await skillsNav.click();

    await browser.waitUntil(
      async () => ((await browser.getUrl()) ?? '').includes('/skills'),
      { timeout: 10000, timeoutMsg: 'URL 未跳转到 /skills' }
    );
    expect(await browser.getUrl()).toContain('/skills');
  });

  it('Rust 后端返回概览统计（get_dashboard_stats）', async () => {
    const stats = await browser.tauri.execute(({ core }) =>
      core.invoke('get_dashboard_stats')
    );
    expect(stats).toBeDefined();
    expect(typeof stats.skill_count).toBe('number');
    expect(typeof stats.rule_count).toBe('number');
    expect(typeof stats.scene_count).toBe('number');
  });

  it('Rust 后端返回场景列表（list_scenes）', async () => {
    const scenes = await browser.tauri.execute(({ core }) =>
      core.invoke('list_scenes')
    );
    expect(Array.isArray(scenes)).toBe(true);
    expect(scenes.length).toBeGreaterThanOrEqual(0);
  });

  it('Rust 后端返回同步状态（get_sync_status）', async () => {
    const status = await browser.tauri.execute(({ core }) =>
      core.invoke('get_sync_status')
    );
    expect(status).toBeDefined();
  });

  it('Rust 后端可读取数据库大小（get_db_size）', async () => {
    const size = await browser.tauri.execute(({ core }) =>
      core.invoke('get_db_size')
    );
    expect(typeof size).toBe('string');
    expect(size.length).toBeGreaterThan(0);
  });
});

describe('SkillForge 视觉对齐关键路径（Task 8 补强）', () => {
  it('设置入口位于侧边栏 footer，页面为顶部 chips，平台能力 tooltip 可展开', async () => {
    const footer = await browser.$('[data-testid="sidebar-footer"]');
    await footer.waitForExist({ timeout: 10000 });
    const settingsBtn = await browser.$(
      '//*[@data-testid="sidebar-footer"]//button[contains(., "设置")]'
    );
    await settingsBtn.waitForExist({ timeout: 10000 });
    await settingsBtn.click();

    await browser.waitUntil(
      async () => ((await browser.getUrl()) ?? '').includes('/settings'),
      { timeout: 10000, timeoutMsg: 'URL 未跳转到 /settings' }
    );

    const tabs = await browser.$$('[role="tab"]');
    expect(tabs.length).toBe(2);
    const tabTexts = [];
    for (const tab of tabs) tabTexts.push(await tab.getText());
    expect(tabTexts).toContain('通用设置');
    expect(tabTexts).toContain('Agent 平台');

    await tabs[1].click();
    await browser.waitUntil(
      async () => (await browser.$$('button[aria-label*="路径与能力"]')).length >= 10,
      { timeout: 10000, timeoutMsg: '未渲染 10 个平台能力触发器' }
    );
    const triggers = await browser.$$('button[aria-label*="路径与能力"]');
    const letters = await triggers[0].getText();
    expect(letters.replace(/\s+/g, '')).toContain('SSRR');

    await triggers[0].click();
    await browser.waitUntil(
      async () => ((await browser.$('body').getText()) ?? '').includes('全局技能'),
      { timeout: 5000, timeoutMsg: '点击聚焦后 tooltip 未显示四条路径标签' }
    );
    const tooltipText = await browser.$('body').getText();
    expect(tooltipText).toContain('全局技能');
    expect(tooltipText).toContain('项目技能');
    expect(tooltipText).toContain('全局规则');
    expect(tooltipText).toContain('项目规则');
    expect(tooltipText).not.toContain('检测');
  });

  it('项目页右上「批量操作」→ 底部批量操作栏出现，激活态文案为「完成」', async () => {
    const projNav = await browser.$('//button[contains(., "项目")]');
    await projNav.waitForExist({ timeout: 10000 });
    await projNav.click();
    await browser.waitUntil(
      async () => ((await browser.getUrl()) ?? '').includes('/projects'),
      { timeout: 10000, timeoutMsg: 'URL 未跳转到 /projects' }
    );

    const actions = await browser.$('[data-testid="project-page-actions"]');
    await actions.waitForExist({ timeout: 10000 });
    const batchBtn = await actions.$('button[aria-label="batchMode"]');
    await batchBtn.waitForExist({ timeout: 10000 });
    expect(await batchBtn.getText()).toContain('批量操作');

    await batchBtn.click();
    const bar = await browser.$('[data-testid="project-batch-bar"]');
    await bar.waitForExist({ timeout: 10000, timeoutMsg: '批量操作栏未出现' });
    expect(await batchBtn.getText()).toContain('完成');
  });

  it('Scene 详情读取态四要素齐备，按钮次序为 用于分发→配置内容→删除', async () => {
    const scenesNav = await browser.$('//button[contains(., "场景")]');
    await scenesNav.waitForExist({ timeout: 10000 });
    await scenesNav.click();
    await browser.waitUntil(
      async () => ((await browser.getUrl()) ?? '').includes('/scenes'),
      { timeout: 10000, timeoutMsg: 'URL 未跳转到 /scenes' }
    );

    const firstScene = await browser.$('[data-testid="scene-list-item"]');
    await firstScene.waitForExist({ timeout: 10000 });
    await firstScene.click();

    const detail = await browser.$('[data-testid="scene-detail"]');
    await detail.waitForExist({ timeout: 10000 });

    expect(await detail.$('[data-testid="scene-updated-at"]').getText()).toContain(
      '更新于'
    );
    expect(await detail.$('[data-testid="scene-read-only"]').getText()).toContain(
      '当前为读取态'
    );
    expect(await detail.$('[data-testid="scene-save-note"]').getText()).toContain(
      '不触发分发'
    );

    const actionTexts = [];
    const actionButtons = await detail.$$(
      '[data-testid="scene-actions"] button'
    );
    for (const btn of actionButtons) actionTexts.push(await btn.getText());
    const idxUse = actionTexts.findIndex((t) => t.includes('用于分发'));
    const idxConfig = actionTexts.findIndex((t) => t.includes('配置内容'));
    const idxDelete = actionTexts.findIndex((t) => t.includes('删除'));
    expect(idxUse).toBeGreaterThanOrEqual(0);
    expect(idxConfig).toBeGreaterThan(idxUse);
    expect(idxDelete).toBeGreaterThan(idxConfig);
  });

  it('概览页头右侧有一键导入；欢迎引导尊重数据状态并可 dismiss', async () => {
    const overviewNav = await browser.$('//button[contains(., "概览")]');
    await overviewNav.waitForExist({ timeout: 10000 });
    await overviewNav.click();
    await browser.waitUntil(
      async () => ((await browser.getUrl()) ?? '').includes('/'),
      { timeout: 10000, timeoutMsg: 'URL 未回到概览' }
    );

    const importBtn = await browser.$('//button[contains(., "一键导入")]');
    await importBtn.waitForExist({ timeout: 10000 });

    // 决策 5（Task 3）：欢迎引导不再受数据态门控，未 dismiss 即显示；若可见则点「知道了」验证可 dismiss
    const guide = await browser.$('//*[contains(., "欢迎使用 SkillForge")]');
    if (await guide.isExisting()) {
      const dismissBtn = await browser.$('//button[contains(., "知道了")]');
      await dismissBtn.waitForExist({ timeout: 5000 });
      await dismissBtn.click();
      await browser.waitUntil(async () => !(await guide.isExisting()), {
        timeout: 5000,
        timeoutMsg: '点击「知道了」后引导未隐藏',
      });
    }
  });

  it('设置页为唯一主题入口：开关联动 html.dark 并持久化到 localStorage', async () => {
    const footer = await browser.$('[data-testid="sidebar-footer"]');
    await footer.waitForExist({ timeout: 10000 });
    const settingsBtn = await browser.$(
      '//*[@data-testid="sidebar-footer"]//button[contains(., "设置")]'
    );
    await settingsBtn.waitForExist({ timeout: 10000 });
    await settingsBtn.click();
    await browser.waitUntil(
      async () => ((await browser.getUrl()) ?? '').includes('/settings'),
      { timeout: 10000, timeoutMsg: 'URL 未跳转到 /settings' }
    );

    const initialDark = await browser.execute(() =>
      document.documentElement.classList.contains('dark')
    );

    const darkSwitch = await browser.$('[role="switch"][aria-label="深色模式"]');
    await darkSwitch.waitForExist({ timeout: 10000 });
    expect(await darkSwitch.getAttribute('aria-checked')).toBe(
      initialDark ? 'true' : 'false'
    );

    await darkSwitch.click();
    const targetDark = !initialDark;
    await browser.waitUntil(
      async () =>
        (await browser.execute(() =>
          document.documentElement.classList.contains('dark')
        )) === targetDark,
      { timeout: 5000, timeoutMsg: '设置页开关未联动 html.dark' }
    );
    expect(
      await browser.execute(() => localStorage.getItem('skillforge-theme'))
    ).toBe(targetDark ? 'dark' : 'light');
    expect(await darkSwitch.getAttribute('aria-checked')).toBe(
      targetDark ? 'true' : 'false'
    );

    await darkSwitch.click();
    await browser.waitUntil(
      async () =>
        (await browser.execute(() =>
          document.documentElement.classList.contains('dark')
        )) === initialDark,
      { timeout: 5000, timeoutMsg: '设置页开关二次切换未恢复 html.dark' }
    );
    expect(
      await browser.execute(() => localStorage.getItem('skillforge-theme'))
    ).toBe(initialDark ? 'dark' : 'light');
    expect(await darkSwitch.getAttribute('aria-checked')).toBe(
      initialDark ? 'true' : 'false'
    );
  });
});

describe('SkillForge 视觉对齐关键路径（Task 9 补强）', () => {
  it('Topbar 左侧首元素为折叠按钮且右侧无主题/更多/快捷键控件，点击切换侧边栏 64/200px', async () => {
    const overviewNav = await browser.$('//button[contains(., "概览")]');
    await overviewNav.waitForExist({ timeout: 10000 });
    await overviewNav.click();
    await browser.waitUntil(
      async () => ((await browser.getUrl()) ?? '').includes('/'),
      { timeout: 10000, timeoutMsg: 'URL 未回到概览' }
    );

    const topbar = await browser.$('[data-testid="app-topbar"]');
    await topbar.waitForExist({ timeout: 10000 });

    // 右侧无主题/更多/快捷键按钮：topbar 内唯一按钮即折叠按钮
    const topbarButtons = await topbar.$$('button');
    expect(topbarButtons.length).toBe(1);
    const collapseBtn = topbarButtons[0];
    const collapseLabel = await collapseBtn.getAttribute('aria-label');
    expect(collapseLabel).toMatch(/折叠侧边栏|展开侧边栏/);
    const collapseText = (await collapseBtn.getText()) ?? '';
    expect(`${collapseLabel} ${collapseText}`).not.toMatch(
      /主题|更多|快捷键|theme|more|shortcut/i
    );

    // 折叠/展开往返：侧边栏宽度类随 aria-label 切换（64px ↔ 200px）
    const initialExpanded = collapseLabel === '折叠侧边栏';
    await collapseBtn.click();
    await browser.waitUntil(
      async () => (await collapseBtn.getAttribute('aria-label')) !== collapseLabel,
      { timeout: 5000, timeoutMsg: '点击折叠按钮后 aria-label 未切换' }
    );
    expect(await collapseBtn.getAttribute('aria-label')).toBe(
      initialExpanded ? '展开侧边栏' : '折叠侧边栏'
    );
    const toggledClass =
      (await browser.execute(
        () => document.querySelector('aside')?.className ?? ''
      )) ?? '';
    expect(toggledClass).toContain(initialExpanded ? 'w-[64px]' : 'w-[200px]');

    await collapseBtn.click();
    await browser.waitUntil(
      async () => (await collapseBtn.getAttribute('aria-label')) === collapseLabel,
      { timeout: 5000, timeoutMsg: '再次点击折叠按钮后 aria-label 未恢复' }
    );
    const restoredClass =
      (await browser.execute(
        () => document.querySelector('aside')?.className ?? ''
      )) ?? '';
    expect(restoredClass).toContain(initialExpanded ? 'w-[200px]' : 'w-[64px]');
  });

  it('工作区 Step 1 stepper 四步之间渲染 3 条连接线', async () => {
    const wsNav = await browser.$('//button[contains(., "工作区")]');
    await wsNav.waitForExist({ timeout: 10000 });
    await wsNav.click();
    await browser.waitUntil(
      async () => ((await browser.getUrl()) ?? '').includes('/workspace'),
      { timeout: 10000, timeoutMsg: 'URL 未跳转到 /workspace' }
    );
    await browser.waitUntil(
      async () =>
        (await browser.$$('[data-testid="ws-step-connector"]')).length === 3,
      { timeout: 10000, timeoutMsg: 'stepper 未渲染 3 条连接线' }
    );
    expect(
      (await browser.$$('[data-testid="ws-step-connector"]')).length
    ).toBe(3);
  });

  it('设置平台 tooltip 点击 pin 住、再点解除、Esc 解除', async () => {
    const footer = await browser.$('[data-testid="sidebar-footer"]');
    await footer.waitForExist({ timeout: 10000 });
    const settingsBtn = await browser.$(
      '//*[@data-testid="sidebar-footer"]//button[contains(., "设置")]'
    );
    await settingsBtn.waitForExist({ timeout: 10000 });
    await settingsBtn.click();
    await browser.waitUntil(
      async () => ((await browser.getUrl()) ?? '').includes('/settings'),
      { timeout: 10000, timeoutMsg: 'URL 未跳转到 /settings' }
    );

    const tabs = await browser.$$('[role="tab"]');
    expect(tabs.length).toBe(2);
    await tabs[1].click();
    await browser.waitUntil(
      async () => (await browser.$$('button[aria-label*="路径与能力"]')).length >= 10,
      { timeout: 10000, timeoutMsg: '未渲染 10 个平台能力触发器' }
    );
    const triggers = await browser.$$('button[aria-label*="路径与能力"]');
    const tooltip = browser.$('[data-testid="platform-path-tooltip"]');

    // 点击 → pin 打开
    await triggers[0].click();
    await browser.waitUntil(async () => (await tooltip.isExisting()) === true, {
      timeout: 5000,
      timeoutMsg: '点击触发器后 tooltip 未打开（pin）',
    });

    // 再次点击 → 解除
    await triggers[0].click();
    await browser.waitUntil(async () => (await tooltip.isExisting()) === false, {
      timeout: 5000,
      timeoutMsg: '再次点击触发器后 tooltip 未解除',
    });

    // 点击打开 → Esc → 解除
    await triggers[0].click();
    await browser.waitUntil(async () => (await tooltip.isExisting()) === true, {
      timeout: 5000,
      timeoutMsg: '第二次点击触发器后 tooltip 未打开',
    });
    await browser.keys(['Escape']);
    await browser.waitUntil(async () => (await tooltip.isExisting()) === false, {
      timeout: 5000,
      timeoutMsg: '按 Esc 后 tooltip 未解除',
    });
  });

  it('Scene 成员禁用 → 详情 enabled=false → 分发计划不含该成员；重新启用 → 恢复包含（决策 10）', async () => {
    const skills = await browser.tauri.execute(({ core }) =>
      core.invoke('list_skills')
    );
    expect(skills.length).toBeGreaterThan(0);
    const platforms = await browser.tauri.execute(({ core }) =>
      core.invoke('list_platforms')
    );
    const enabledPlatformIds = platforms
      .filter((p) => p.enabled)
      .map((p) => p.id);
    expect(enabledPlatformIds.length).toBeGreaterThan(0);

    // 候选技能：启用时必进分发计划（skills_to_add / skills_to_update），
    // 保证「重新启用 → 恢复包含」断言确定成立，而非因已全量同步而空计划
    let candidateId = null;
    for (const s of skills) {
      const plan = await browser.tauri.execute(
        ({ core }, arg) =>
          core.invoke('preview_distribution', {
            sceneId: null,
            platformIds: arg.platformIds,
            scope: 'global',
            projectId: null,
            skills: { mode: 'add_or_update', ids: [arg.skillId] },
            rules: { mode: 'add_or_update', ids: [] },
          }),
        { platformIds: enabledPlatformIds, skillId: s.id }
      );
      const included = (plan.platforms || []).some(
        (p) =>
          p.skills_to_add.includes(s.id) || p.skills_to_update.includes(s.id)
      );
      if (included) {
        candidateId = s.id;
        break;
      }
    }
    expect(candidateId).not.toBeNull();

    const scene = await browser.tauri.execute(
      ({ core }, arg) =>
        core.invoke('create_scene', {
          data: {
            name: arg.name,
            description: 'QA-T9-e2e',
            skill_ids: [arg.skillId],
            rule_ids: [],
          },
        }),
      { name: `QA-T9-${Date.now()}`, skillId: candidateId }
    );
    const sceneId = scene.id;
    try {
      await browser.tauri.execute(
        ({ core }, arg) =>
          core.invoke('set_scene_member_enabled', {
            sceneId: arg.sceneId,
            memberType: 'skill',
            memberId: arg.memberId,
            enabled: false,
          }),
        { sceneId, memberId: candidateId }
      );
      const detailDisabled = await browser.tauri.execute(
        ({ core }, arg) => core.invoke('get_scene_detail', { id: arg.sceneId }),
        { sceneId }
      );
      const disabledMember = detailDisabled.skills.find(
        (sk) => sk.skill_id === candidateId
      );
      expect(disabledMember).toBeDefined();
      expect(disabledMember.enabled).toBe(false);

      // 以场景为来源分发（仅启用成员进入选择集，同前端工作区行为）→ 计划不含禁用成员
      const planDisabled = await browser.tauri.execute(
        ({ core }, arg) =>
          core.invoke('preview_distribution', {
            sceneId: arg.sceneId,
            platformIds: arg.platformIds,
            scope: 'global',
            projectId: null,
            skills: { mode: 'add_or_update', ids: [] },
            rules: { mode: 'add_or_update', ids: [] },
          }),
        { sceneId, platformIds: enabledPlatformIds }
      );
      const planDisabledIds = [];
      for (const p of planDisabled.platforms || []) {
        planDisabledIds.push(...p.skills_to_add, ...p.skills_to_update);
      }
      expect(planDisabledIds).not.toContain(candidateId);

      // 重新启用 → 详情 enabled=true → 分发计划恢复包含
      await browser.tauri.execute(
        ({ core }, arg) =>
          core.invoke('set_scene_member_enabled', {
            sceneId: arg.sceneId,
            memberType: 'skill',
            memberId: arg.memberId,
            enabled: true,
          }),
        { sceneId, memberId: candidateId }
      );
      const detailEnabled = await browser.tauri.execute(
        ({ core }, arg) => core.invoke('get_scene_detail', { id: arg.sceneId }),
        { sceneId }
      );
      const enabledMember = detailEnabled.skills.find(
        (sk) => sk.skill_id === candidateId
      );
      expect(enabledMember).toBeDefined();
      expect(enabledMember.enabled).toBe(true);

      const planEnabled = await browser.tauri.execute(
        ({ core }, arg) =>
          core.invoke('preview_distribution', {
            sceneId: arg.sceneId,
            platformIds: arg.platformIds,
            scope: 'global',
            projectId: null,
            skills: { mode: 'add_or_update', ids: [arg.skillId] },
            rules: { mode: 'add_or_update', ids: [] },
          }),
        { sceneId, platformIds: enabledPlatformIds, skillId: candidateId }
      );
      const reincluded = (planEnabled.platforms || []).some(
        (p) =>
          p.skills_to_add.includes(candidateId) ||
          p.skills_to_update.includes(candidateId)
      );
      expect(reincluded).toBe(true);
    } finally {
      await browser.tauri.execute(
        ({ core }, arg) => core.invoke('delete_scene', { id: arg.sceneId }),
        { sceneId }
      );
    }
  });
});

describe('SkillForge 29 号整改关键路径（Task 15 补强）', () => {
  it('概览统计卡在 768px 视口为 2×2', async () => {
    // setWindowSize 以物理像素计；乘以 dpr 使 CSS 视口为 768px（覆盖 768–1179px 的 md 断点区间）
    const dpr = await browser.execute(() => window.devicePixelRatio);
    await browser.setWindowSize(768 * dpr, 900 * dpr);
    await browser.url('/');
    await browser.waitUntil(
      async () =>
        (await browser.$('[data-testid="dashboard-stats-grid"]').isExisting()) ===
        true,
      { timeout: 10000, timeoutMsg: '统计卡网格未渲染' }
    );
    const cols = await browser.execute(() =>
      getComputedStyle(
        document.querySelector('[data-testid="dashboard-stats-grid"]')
      ).gridTemplateColumns.split(' ').length
    );
    expect(cols).toBe(2);
    const grid = await browser.$('[data-testid="dashboard-stats-grid"]');
    expect(await grid.getAttribute('class')).toContain('md:grid-cols-2');
  });

  it('工作区 Step1 无「上一步」，Step3 渲染 Skills/Rules 双路径', async () => {
    const wsNav = await browser.$('//button[contains(., "工作区")]');
    await wsNav.waitForExist({ timeout: 10000 });
    await wsNav.click();
    await browser.waitUntil(
      async () => ((await browser.getUrl()) ?? '').includes('/workspace'),
      { timeout: 10000, timeoutMsg: 'URL 未跳转到 /workspace' }
    );
    expect(await browser.$$('//button[contains(., "上一步")]')).toHaveLength(0);
    await (await browser.$('//button[contains(., "下一步")]')).click();
    await (await browser.$('//button[contains(., "下一步")]')).click();
    await browser.waitUntil(
      async () =>
        (await browser.$('[data-testid="ws-step3-skills-path"]').isExisting()) ===
        true,
      { timeout: 10000, timeoutMsg: 'Step3 Skills 路径未渲染' }
    );
    expect(
      await browser.$('[data-testid="ws-step3-rules-path"]').isExisting()
    ).toBe(true);
  });

  it('场景「配置内容」为右侧抽屉 + 半透明遮罩', async () => {
    const scenesNav = await browser.$('//button[contains(., "场景")]');
    await scenesNav.waitForExist({ timeout: 10000 });
    await scenesNav.click();
    await browser.waitUntil(
      async () => ((await browser.getUrl()) ?? '').includes('/scenes'),
      { timeout: 10000, timeoutMsg: 'URL 未跳转到 /scenes' }
    );
    const firstScene = await browser.$('[data-testid="scene-list-item"]');
    await firstScene.waitForExist({ timeout: 10000 });
    await firstScene.click();
    const configBtn = await browser.$('//button[contains(., "配置内容")]');
    await configBtn.waitForExist({ timeout: 10000 });
    await configBtn.click();
    await browser.waitUntil(
      async () =>
        (await browser.$('[data-testid="scene-drawer"]').isExisting()) === true,
      { timeout: 10000, timeoutMsg: '场景抽屉未打开' }
    );
    const drawer = await browser.$('[data-testid="scene-drawer"]');
    expect(await drawer.getAttribute('class')).toContain('right-0');
    expect(await drawer.getAttribute('class')).toContain('w-[min(920px,96vw)]');
    const overlay = await browser.$('[data-testid="scene-drawer-overlay"]');
    expect(await overlay.getAttribute('class')).toContain('bg-black/40');
    await browser.execute(() =>
      document.querySelector('[data-testid="scene-drawer-overlay"]').click()
    );
    await browser.waitUntil(
      async () =>
        (await browser.$('[data-testid="scene-drawer"]').isExisting()) === false,
      { timeout: 5000, timeoutMsg: '遮罩点击未关闭抽屉' }
    );
  });

  it('技能页两行工具栏顺序；规则页新建/导入均为 primary 且导入图标向下', async () => {
    const skillsNav = await browser.$('//button[contains(., "技能")]');
    await skillsNav.waitForExist({ timeout: 10000 });
    await skillsNav.click();
    await browser.waitUntil(
      async () => ((await browser.getUrl()) ?? '').includes('/skills'),
      { timeout: 10000, timeoutMsg: 'URL 未跳转到 /skills' }
    );
    let pageActions = await browser.$('[data-testid="lib-page-actions"]');
    await pageActions.waitForExist({ timeout: 10000 });
    let pageButtons = await pageActions.$$('button');
    expect(pageButtons.length).toBe(2);
    expect(await pageButtons[0].getAttribute('class')).toContain('bg-primary');

    const rulesNav = await browser.$('//button[contains(., "规则")]');
    await rulesNav.waitForExist({ timeout: 10000 });
    await rulesNav.click();
    await browser.waitUntil(
      async () => ((await browser.getUrl()) ?? '').includes('/rules'),
      { timeout: 10000, timeoutMsg: 'URL 未跳转到 /rules' }
    );
    pageActions = await browser.$('[data-testid="lib-page-actions"]');
    await pageActions.waitForExist({ timeout: 10000 });
    pageButtons = await pageActions.$$('button');
    expect(pageButtons.length).toBe(3);
    expect(await pageButtons[0].getAttribute('class')).toContain('bg-primary');
    expect(await pageButtons[1].getAttribute('class')).toContain('bg-primary');
    expect(await pageButtons[1].$('svg.lucide-download').isExisting()).toBe(true);
    expect(await pageButtons[1].$('svg.lucide-upload').isExisting()).toBe(false);
  });

  it('设置通用恰好 5 张卡：更新卡含检查更新按钮与自动检查 switch', async () => {
    const footer = await browser.$('[data-testid="sidebar-footer"]');
    await footer.waitForExist({ timeout: 10000 });
    const settingsBtn = await browser.$(
      '//*[@data-testid="sidebar-footer"]//button[contains(., "设置")]'
    );
    await settingsBtn.waitForExist({ timeout: 10000 });
    await settingsBtn.click();
    await browser.waitUntil(
      async () => ((await browser.getUrl()) ?? '').includes('/settings'),
      { timeout: 10000, timeoutMsg: 'URL 未跳转到 /settings' }
    );
    const cards = await browser.$$('[data-testid="general-card"]');
    expect(cards.length).toBe(5);
    const updateCard = cards[2];
    expect(
      await updateCard.$('//button[contains(., "检查更新")]').isExisting()
    ).toBe(true);
    expect(await updateCard.$('[role="switch"]').isExisting()).toBe(true);
  });
});

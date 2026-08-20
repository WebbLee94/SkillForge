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

describe('SkillForge 33 号 A 批整改关键路径（Task 13 补强）', () => {
  // 进入工作区 Step1（默认全局目标 + 首个启用平台），等待 grid 渲染。
  // 先切到概览再回工作区，强制组件重新挂载回 Step1（避免上一用例停留在 Step3）。
  async function openWorkspaceStep1() {
    const overviewNav = await browser.$('//button[contains(., "概览")]');
    await overviewNav.waitForExist({ timeout: 10000 });
    await overviewNav.click();
    await browser.waitUntil(
      async () => ((await browser.getUrl()) ?? '') === '/' || ((await browser.getUrl()) ?? '').endsWith('/'),
      { timeout: 10000, timeoutMsg: 'URL 未回到概览' }
    );
    const wsNav = await browser.$('//button[contains(., "工作区")]');
    await wsNav.waitForExist({ timeout: 10000 });
    await wsNav.click();
    await browser.waitUntil(
      async () => ((await browser.getUrl()) ?? '').includes('/workspace'),
      { timeout: 10000, timeoutMsg: 'URL 未跳转到 /workspace' }
    );
    const grid = await browser.$('[data-testid="ws-step1-grid"]');
    await grid.waitForExist({ timeout: 10000 });
    return grid;
  }

  it('工作区 Step1 为 2×2 grid；Step3 无通用目标路径、有 planTitle', async () => {
    const grid = await openWorkspaceStep1();
    expect(await grid.getAttribute('class')).toContain('sm:grid-cols-2');
    expect(await grid.getAttribute('class')).toContain('grid-cols-1');

    // Step1 → Step2 → Step3
    await (await browser.$('//button[contains(., "下一步")]')).click();
    await (await browser.$('//button[contains(., "下一步")]')).click();
    await browser.waitUntil(
      async () =>
        (await browser.$('[data-testid="ws-step3-skills-path"]').isExisting()) ===
        true,
      { timeout: 10000, timeoutMsg: 'Step3 Skills 路径未渲染' }
    );
    expect(
      await browser.$('[data-testid="ws-step3-skills-path"]').isExisting()
    ).toBe(true);
    // 无通用目标路径（A4：仅 Skills/Rules 两条路径，无第三条通用路径）
    expect(
      await browser.$('[data-testid="ws-step3-general-path"]').isExisting()
    ).toBe(false);
    // planTitle 非原始 key（zh 环境显示「计划明细」）
    const body = await browser.$('body').getText();
    expect(body).not.toContain('ws.planTitle');
    expect(body).toContain('计划明细');
  });

  it('受管面板折叠按钮 aria-expanded 联动 + 独立移除二次确认', async () => {
    await openWorkspaceStep1();
    // 折叠按钮定位：优先 [aria-controls="ws-managed-panel"]（T3 已保证该属性）
    const toggle = await browser.$('[aria-controls="ws-managed-panel"]');
    await toggle.waitForExist({ timeout: 10000 });
    expect(await toggle.getAttribute('aria-expanded')).toBe('false');
    await toggle.click();
    await browser.waitUntil(
      async () => (await toggle.getAttribute('aria-expanded')) === 'true',
      { timeout: 10000, timeoutMsg: '点击后 aria-expanded 未变为 true' }
    );

    const confirm = await browser.$('[data-testid="ws-managed-confirm-remove"]');
    await confirm.waitForExist({ timeout: 10000 });

    // 存在受管项时：勾选 → 点击确认 → 弹窗出现 → 确认 → 面板刷新后该项消失
    const managedCheckboxes = await browser.$$(
      '[data-testid^="ws-managed-skill-"] input[type="checkbox"], [data-testid^="ws-managed-rule-"] input[type="checkbox"]'
    );
    if (managedCheckboxes.length > 0) {
      await managedCheckboxes[0].click();
      await browser.waitUntil(async () => (await confirm.isEnabled()) === true, {
        timeout: 5000,
        timeoutMsg: '勾选受管项后确认移除按钮未启用',
      });
      await confirm.click();
      const items = await browser.$('[data-testid="ws-remove-confirm-items"]');
      await items.waitForExist({
        timeout: 10000,
        timeoutMsg: '二次确认弹窗明细未出现',
      });
      expect((await items.$$('div')).length).toBeGreaterThan(0);
      // 确认后弹窗关闭，移除结果行出现
      const dialogConfirm = await browser.$(
        '[data-testid="confirm-dialog-confirm"]'
      );
      await dialogConfirm.waitForExist({ timeout: 5000 });
      await dialogConfirm.click();
      await browser.$('[data-testid="ws-managed-remove-result"]').waitForExist({
        timeout: 10000,
        timeoutMsg: '移除结果行未出现',
      });
    } else {
      // 无受管项（如默认全局目标仅含用户自有内容）：确认移除按钮应禁用
      expect(await confirm.isEnabled()).toBe(false);
    }
  });

  it('Step2 技能区三态全选', async () => {
    await openWorkspaceStep1();
    await (await browser.$('//button[contains(., "下一步")]')).click();

    const selectAll = await browser.$('[data-testid="ws-select-all-skills"]');
    await selectAll.waitForExist({ timeout: 10000 });
    // 初始未全选
    expect(await selectAll.getAttribute('aria-checked')).toBe('false');
    // 点击 → 全选
    await selectAll.click();
    await browser.waitUntil(
      async () => (await selectAll.getAttribute('aria-checked')) === 'true',
      { timeout: 5000, timeoutMsg: '点击全选后 aria-checked 未变为 true' }
    );
    const poolChecks = await browser.$$(
      '[data-testid="ws-skills-list"] input[type="checkbox"]'
    );
    if (poolChecks.length > 0) {
      for (const c of poolChecks) expect(await c.isSelected()).toBe(true);
    }
    // 取消一项 → indeterminate
    if (poolChecks.length > 1) {
      await poolChecks[0].click();
      await browser.waitUntil(
        async () => (await selectAll.getAttribute('aria-checked')) === 'mixed',
        { timeout: 5000, timeoutMsg: '部分选中后 aria-checked 未变为 mixed' }
      );
      // 清空 → false
      await (await browser.$('[data-testid="ws-clear-skills"]')).click();
      await browser.waitUntil(
        async () => (await selectAll.getAttribute('aria-checked')) === 'false',
        { timeout: 5000, timeoutMsg: '清空后 aria-checked 未恢复 false' }
      );
    }
  });

  it('Step4 无错误时仅「返回工作区」按钮', async () => {
    // 前置：找到一个对默认平台会产生变更（skills_to_add）的技能，确保能真正进入 Step4。
    // 默认全局目标首启用平台（claude-code）现仅含用户自有 .skills-manager 链接，
    // gstack 在 DB 中但未分发 → 分发 gstack 是纯新增、无副作用、可逆。
    const platforms = await browser.tauri.execute(({ core }) =>
      core.invoke('list_platforms')
    );
    const enabled = platforms.filter((p) => p.enabled);
    expect(enabled.length).toBeGreaterThan(0);
    const defaultPlatformId = enabled[0].id;

    const plan = await browser.tauri.execute(({ core }, arg) =>
      core.invoke('preview_distribution', {
        sceneId: null,
        platformIds: [arg.platformId],
        scope: 'global',
        projectId: null,
        skills: { mode: 'add_or_update', ids: ['gstack'] },
        rules: { mode: 'add_or_update', ids: [] },
      }),
      { platformId: defaultPlatformId }
    );
    const target = (plan.platforms || []).find(
      (p) => p.platform_id === defaultPlatformId
    );
    expect(
      target && target.skills_to_add.includes('gstack')
    ).toBe(true);

    try {
      await openWorkspaceStep1();
      await (await browser.$('//button[contains(., "下一步")]')).click();
      // 勾选 gstack
      const gstackLabel = await browser.$(
        '//*[@data-testid="ws-skills-list"]//label[contains(., "gstack")]'
      );
      await gstackLabel.waitForExist({ timeout: 10000 });
      await (await gstackLabel.$('input[type="checkbox"]')).click();
      await (await browser.$('//button[contains(., "下一步")]')).click();
      // Step3：计划就绪后确认分发
      const confirmBtn = await browser.$('//button[contains(., "确认分发")]');
      await browser.waitUntil(async () => (await confirmBtn.isEnabled()) === true, {
        timeout: 15000,
        timeoutMsg: '确认分发按钮未在 15s 内启用',
      });
      await confirmBtn.click();
      // Step4：结果卡 aria-live=polite
      const resultCard = await browser.$('[data-testid="ws-result-card"]');
      await resultCard.waitForExist({ timeout: 15000, timeoutMsg: '结果卡未出现' });
      expect(await resultCard.getAttribute('aria-live')).toBe('polite');
      // 有且仅有「返回工作区」；无「重试失败项」
      const actionButtons = await resultCard.$$('button');
      expect(actionButtons.length).toBe(1);
      expect(await actionButtons[0].getText()).toContain('返回工作区');
      // 无 ws-result-resultRemoved（DEC-1）
      expect(
        await browser.$('[data-testid="ws-result-resultRemoved"]').isExisting()
      ).toBe(false);
      // 结果指标中文化（A5/P0-2）
      const cardText = await resultCard.getText();
      expect(cardText).toContain('已安装');
      expect(cardText).toContain('已更新');
      expect(cardText).toContain('已跳过');
      expect(cardText).toContain('错误');
    } finally {
      // 清理：移除刚分发的 gstack（可逆，恢复原状）；尽力而为，不掩盖用例失败
      try {
        await browser.tauri.execute(({ core }, arg) =>
          core.invoke('remove_distributed', {
            platformIds: [arg.platformId],
            scope: 'global',
            projectId: undefined,
            skillIds: ['gstack'],
            ruleIds: [],
          }),
          { platformId: defaultPlatformId }
        );
      } catch {
        // ignore
      }
    }
  });

  it('Inspector 无底部 reveal 按钮；Rule 详情含本地路径行', async () => {
    // 技能详情
    const skillsNav = await browser.$('//button[contains(., "技能")]');
    await skillsNav.waitForExist({ timeout: 10000 });
    await skillsNav.click();
    await browser.waitUntil(
      async () => ((await browser.getUrl()) ?? '').includes('/skills'),
      { timeout: 10000, timeoutMsg: 'URL 未跳转到 /skills' }
    );
    const firstSkill = await browser.$('[data-testid="resource-item"]');
    await firstSkill.waitForExist({ timeout: 10000 });
    await firstSkill.click();
    const inspectorRoot = await browser.$('[data-testid="inspector-root"]');
    await inspectorRoot.waitForExist({ timeout: 10000 });
    const skillPathRow = await browser.$('[data-testid="skill-local-path-row"]');
    await skillPathRow.waitForExist({ timeout: 10000 });
    // P3：底部操作区无 reveal 按钮（reveal 收敛为路径行内 action-reveal 图标）
    const actionTexts = await browser.execute(() => {
      const el = document.querySelector('[data-testid="inspector-actions"]');
      if (!el) return [];
      return Array.from(el.querySelectorAll('button')).map((b) =>
        `${b.getAttribute('aria-label') || ''} ${b.textContent || ''} ${b.getAttribute('title') || ''}`
      );
    });
    for (const t of actionTexts) {
      expect(t).not.toMatch(/在访达中显示|Show in|在文件管理器中打开/i);
    }

    // 规则详情
    const rulesNav = await browser.$('//button[contains(., "规则")]');
    await rulesNav.waitForExist({ timeout: 10000 });
    await rulesNav.click();
    await browser.waitUntil(
      async () => ((await browser.getUrl()) ?? '').includes('/rules'),
      { timeout: 10000, timeoutMsg: 'URL 未跳转到 /rules' }
    );
    const firstRule = await browser.$('[data-testid="resource-item"]');
    await firstRule.waitForExist({ timeout: 10000 });
    await firstRule.click();
    const rulePathRow = await browser.$('[data-testid="rule-local-path-row"]');
    await rulePathRow.waitForExist({ timeout: 10000 });
    // 受管副本存在或显示「尚未分发到本地目标」
    const rowText = await rulePathRow.getText();
    expect(rowText).toContain('本地路径');
    const revealInRow = await rulePathRow.$('button.action-reveal');
    if (await revealInRow.isExisting()) {
      expect(rowText.replace(/\s+/g, '')).toContain('本地路径');
    } else {
      expect(rowText).toContain('尚未分发到本地目标');
    }
  });
});

import { expect } from '@wdio/globals';

describe('SkillForge 桌面应用冒烟测试', () => {
  it('应用窗口加载并显示根界面', async () => {
    // Wait for the React app to mount
    await browser.waitUntil(
      async () => (await browser.$('#root').isExisting()) === true,
      { timeout: 20000, timeoutMsg: '根节点 #root 未在 20s 内渲染' }
    );

    // The sidebar should render the app name (zh-CN default locale)
    const appName = await browser.$('body').getText();
    expect(appName).toContain('SkillForge');
  });

  it('侧边栏显示中文导航项（看板/技能/规则/设置）', async () => {
    const bodyText = await browser.$('body').getText();
    expect(bodyText).toContain('看板');
    expect(bodyText).toContain('技能');
    expect(bodyText).toContain('规则');
    expect(bodyText).toContain('设置');
  });

  it('通过 Tauri IPC 调用 Rust 后端（list_platforms）', async () => {
    // Execute a real Rust backend command through the Tauri IPC bridge
    const platforms = await browser.tauri.execute(({ core }) =>
      core.invoke('list_platforms')
    );

    expect(platforms).toBeDefined();
    expect(Array.isArray(platforms)).toBe(true);
    expect(platforms.length).toBeGreaterThanOrEqual(10); // 10 built-in platforms
  });

  it('通过 Tauri IPC 读取应用配置（get_app_config）', async () => {
    const cfg = await browser.tauri.execute(({ core }) =>
      core.invoke('get_app_config')
    );
    expect(cfg).toBeDefined();
  });

  it('Rust 后端返回内置平台含 claude-code 与 opencode', async () => {
    const platforms = await browser.tauri.execute(({ core }) =>
      core.invoke('list_platforms')
    );
    const ids = platforms.map((p) => p.id ?? p.platform_id);
    expect(ids).toContain('claude-code');
    expect(ids).toContain('opencode');
  });
});

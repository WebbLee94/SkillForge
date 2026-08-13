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

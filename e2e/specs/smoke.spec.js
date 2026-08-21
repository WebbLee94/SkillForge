import { expect } from '@wdio/globals';
import { invokeTauriCommand } from './tauri.js';

async function waitForText(selector, expected) {
  await browser.waitUntil(
    async () => {
      const text = await browser.$(selector).getText();
      return text.includes(expected);
    },
    {
      timeout: 30000,
      interval: 500,
      timeoutMsg: `页面未在 30s 内在 ${selector} 显示 ${expected}`,
    }
  );
}

async function invokeWithRetry(fn) {
  let lastError;
  let result;
  let probe = null;
  await browser.waitUntil(
    async () =>
      (await browser.execute(() => Boolean(window.__TAURI__?.core?.invoke))) ===
      true,
    {
      timeout: 30000,
      interval: 500,
      timeoutMsg: 'window.__TAURI__.core.invoke 未在 30s 内出现',
    }
  );
  await browser.waitUntil(
    async () => {
      try {
        result = await invokeTauriCommand(fn);
        return true;
      } catch (error) {
        lastError = error;
        probe = await browser.execute(() => ({
          hasWdioTauri: typeof window.wdioTauri !== 'undefined',
          hasWdioExecute: typeof window.wdioTauri?.execute === 'function',
          hasOriginalCore: typeof window.__wdio_original_core__ !== 'undefined',
          hasTauri: typeof window.__TAURI__ !== 'undefined',
          hasCoreInvoke: typeof window.__TAURI__?.core?.invoke === 'function',
        }));
        return false;
      }
    },
    {
      timeout: 30000,
      interval: 1000,
      timeoutMsg: `Tauri IPC 在 30s 内仍不可用: ${String(lastError)} | probe=${JSON.stringify(probe)}`,
    }
  );
  return result;
}

describe('SkillForge 桌面应用冒烟测试', () => {
  it('应用窗口加载并显示根界面', async () => {
    await browser.waitUntil(
      async () => (await browser.$('#root').isExisting()) === true,
      { timeout: 20000, timeoutMsg: '根节点 #root 未在 20s 内渲染' }
    );

    await waitForText('aside', 'SkillForge');
    const appName = await browser.$('aside').getText();
    expect(appName).toContain('SkillForge');
  });

  it('侧边栏显示中文导航项（概览/技能/规则/设置）', async () => {
    await waitForText('aside', '概览');
    const sidebarText = await browser.$('aside').getText();
    expect(sidebarText).toContain('概览');
    expect(sidebarText).toContain('技能');
    expect(sidebarText).toContain('规则');
    expect(sidebarText).toContain('设置');
  });

  it('通过 Tauri IPC 调用 Rust 后端（list_platforms）', async () => {
    // Execute a real Rust backend command through the Tauri IPC bridge
    const platforms = await invokeWithRetry(({ core }) =>
      core.invoke('list_platforms')
    );

    expect(platforms).toBeDefined();
    expect(Array.isArray(platforms)).toBe(true);
    expect(platforms.length).toBeGreaterThanOrEqual(10); // 10 built-in platforms
  });

  it('通过 Tauri IPC 读取应用配置（get_app_config）', async () => {
    const cfg = await invokeWithRetry(({ core }) =>
      core.invoke('get_app_config')
    );
    expect(cfg).toBeDefined();
  });

  it('Rust 后端返回内置平台含 claude-code 与 opencode', async () => {
    const platforms = await invokeWithRetry(({ core }) =>
      core.invoke('list_platforms')
    );
    const ids = platforms.map((p) => p.id ?? p.platform_id);
    expect(ids).toContain('claude-code');
    expect(ids).toContain('opencode');
  });
});

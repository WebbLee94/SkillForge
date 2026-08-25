import { expect } from '@wdio/globals';

/**
 * 概览统计卡响应式 — 运行态级联回归（P1，Task 6 复查）
 *
 * 根因：Tailwind v4 曾将 arbitrary 断点（min-[1180px] 修饰的 grid-cols-4）
 * 规则排在标准 md 变体之前输出（等特异性，同层级），≥1180px 视口下两条
 * media 同时命中，后声明的 md:grid-cols-2 覆盖了前者 → 运行态计算为 2 列。
 *
 * 注意：本文件注释刻意避免书写完整的裸变体候选类名——Tailwind v4 自动
 * 内容扫描会把注释里的裸候选生成为无组件引用的死 CSS 规则（CL-030）。
 *
 * 本 spec 验证的是【编译后/运行态】的 gridTemplateColumns 计算结果，
 * 而非 JSX 类名存在性（后者由 Dashboard.test.tsx 的类契约测试覆盖）。
 */
describe('概览统计卡响应式运行态（P1 级联回归）', () => {
  // WebKit WebView 的 devicePixelRatio 通常为 2（Retina），setWindowSize 的单位是
  // 物理像素，而 CSS media query 按 CSS px（innerWidth）求值。按 DPR 换算物理尺寸，
  // 使 innerWidth 精确落到目标 CSS 断点区间。
  async function setCssWidth(cssWidth) {
    const dpr = await browser.execute(() => window.devicePixelRatio || 1);
    await browser.setWindowSize(Math.round(cssWidth * dpr), 900);
  }

  // 循环 resize 直至 innerWidth 稳定或被窗口 minWidth 钳制不再变化，
  // 返回实际生效的 CSS 宽度（可能高于请求值）
  async function setCssWidthStable(cssWidth, maxAttempts = 4) {
    let previous = -1;
    let current = -1;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await setCssWidth(cssWidth);
      await browser.pause(300);
      current = await browser.execute(() => window.innerWidth);
      if (current === previous) break;
      previous = current;
    }
    return current;
  }

  async function computedCols() {
    return browser.execute(() =>
      getComputedStyle(
        document.querySelector('[data-testid="dashboard-stats-grid"]')
      ).gridTemplateColumns.split(' ').length
    );
  }

  async function openDashboard() {
    await browser.url('/');
    await browser.waitUntil(
      async () =>
        (await browser.$('[data-testid="dashboard-stats-grid"]').isExisting()) ===
        true,
      { timeout: 10000, timeoutMsg: '统计卡网格未渲染' }
    );
  }

  it('≥1180px 视口（1280px）统计卡网格计算为 4 列', async () => {
    await setCssWidth(1280);
    await openDashboard();

    // 确认确实落在 ≥1180px CSS 断点区间（DPR 换算的防护断言）
    const innerWidth = await browser.execute(() => window.innerWidth);
    expect(innerWidth).toBeGreaterThanOrEqual(1180);

    const cols = await computedCols();
    // 期望 4；当前缺陷实现因 min-[1180px] 排在 md 前而被 md:grid-cols-2 覆盖 → 2
    expect(cols).toBe(4);
  });

  it('768px 视口统计卡网格计算为 2 列', async () => {
    await setCssWidth(768);
    await openDashboard();

    const innerWidth = await browser.execute(() => window.innerWidth);
    expect(innerWidth).toBeGreaterThanOrEqual(768);
    expect(innerWidth).toBeLessThan(1180);

    const cols = await computedCols();
    expect(cols).toBe(2);
  });

  it('请求 700px 视口：受产品 minWidth 钳制时按实际可达宽度断言', async () => {
    await setCssWidthStable(700);
    await openDashboard();

    const innerWidth = await browser.execute(() => window.innerWidth);

    if (innerWidth >= 768) {
      // minWidth=900（tauri.conf.json）钳制：<768 断点分支在真实窗口中不可达，
      // 记录原因后退化为验证「可达最小宽度」下的响应式契约，并反向锁定 minWidth≥900
      console.warn(
        `[stats-grid-responsive] 视口请求 700px 被 minWidth 钳制为 ${innerWidth}px，<768 分支不可达`
      );
      expect(innerWidth).toBeGreaterThanOrEqual(900);
    } else {
      expect(innerWidth).toBeLessThan(768);
    }

    const cols = await computedCols();
    const expectedCols = innerWidth >= 1180 ? 4 : innerWidth >= 768 ? 2 : 1;
    expect(cols).toBe(expectedCols);
  });
});

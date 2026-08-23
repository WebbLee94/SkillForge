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

  it('<768px 视口（700px）统计卡网格计算为 1 列', async () => {
    await setCssWidth(700);
    await openDashboard();

    const innerWidth = await browser.execute(() => window.innerWidth);
    expect(innerWidth).toBeLessThan(768);

    const cols = await computedCols();
    expect(cols).toBe(1);
  });
});

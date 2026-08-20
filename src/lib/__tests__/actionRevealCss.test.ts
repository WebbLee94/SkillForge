// @vitest-environment node
// 33 号 P6：全局 .action-reveal 图标操作规范（默认隐藏、hover/focus 显示、触控保持可达）
// 契约测试：用 node:fs 读取 index.css 文本断言规则存在，避免运行时 CSS 解析。
import { describe, it, expect } from 'vitest';
// 项目未安装 @types/node，node:fs 由 vitest 运行时提供，此处仅跳过类型解析
// @ts-expect-error Cannot find module 'node:fs'
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');

describe('33 号 P6：.action-reveal 全局规范', () => {
  it('定义 .action-reveal 基础类（默认隐藏 + 过渡）', () => {
    expect(css).toContain('.action-reveal');
    expect(css).toMatch(/\.action-reveal\s*\{[^}]*opacity:\s*0/s);
  });
  it('hover / focus-within / focus-visible 显示', () => {
    expect(css).toMatch(/\.group:hover\s+\.action-reveal/s);
    expect(css).toMatch(/\.group:focus-within\s+\.action-reveal/s);
    expect(css).toMatch(/\.action-reveal:focus-visible/s);
  });
  it('触控或无 hover 环境保持可达', () => {
    expect(css).toMatch(/@media\s*\(hover:\s*none\)/s);
    expect(css).toMatch(/@media\s*\(hover:\s*none\)[\s\S]*?\.action-reveal\s*\{\s*opacity:\s*1/s);
  });
});

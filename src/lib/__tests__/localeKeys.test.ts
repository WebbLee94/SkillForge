import { describe, it, expect } from 'vitest';
import zhDist from '../../locales/zh-CN/distribution.json';
import enDist from '../../locales/en-US/distribution.json';

describe('33 号 A4/P0-1：distribution.json 键值契约', () => {
  it('ws.planTitle 存在于 zh/en 且不再渲染原始 key', () => {
    expect(zhDist.ws.planTitle).toBe('计划明细');
    expect(enDist.ws.planTitle).toBe('Plan details');
  });
  it('zh/en 的 ws 键集合一致（parity）', () => {
    const zhKeys = Object.keys(zhDist.ws).sort();
    const enKeys = Object.keys(enDist.ws).sort();
    expect(zhKeys).toEqual(enKeys);
  });
  it('结果指标 zh-CN 已中文化（33 号 A5/P0-2）', () => {
    expect(zhDist.ws.resultInstalled).toBe('已安装');
    expect(zhDist.ws.resultUpdated).toBe('已更新');
    expect(zhDist.ws.resultRemoved).toBe('已移除');
    expect(zhDist.ws.resultSkipped).toBe('已跳过');
    expect(zhDist.ws.resultErrors).toBe('错误');
  });
});

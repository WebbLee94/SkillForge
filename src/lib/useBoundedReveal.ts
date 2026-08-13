import { useCallback, useState } from 'react';

/**
 * A16 长列表有界渲染：单批可见切片大小（阈值）。
 * 12 号 §3.3：资源数量较大时按阈值有界渲染，搜索与标签筛选仍作用于全量数据。
 */
export const BOUNDED_STEP = 50;

export interface BoundedReveal {
  /** 当前应渲染的项数（已钳制到总数） */
  revealed: number;
  /** 是否还有未渲染的项 */
  hasMore: boolean;
  /** 展开下一批（+step） */
  revealMore: () => void;
}

/**
 * 增量可见切片：只渲染前 revealed 项，超阈值时提供 revealMore 展开下一批。
 * count 缩小（筛选变窄）时 revealed 自动钳制到 count；count 恢复后沿用已展开的批次。
 */
export function useBoundedReveal(
  count: number,
  step: number = BOUNDED_STEP
): BoundedReveal {
  const [limit, setLimit] = useState(step);
  const revealed = Math.min(limit, count);
  const hasMore = revealed < count;
  const revealMore = useCallback(() => setLimit((prev) => prev + step), [step]);
  return { revealed, hasMore, revealMore };
}

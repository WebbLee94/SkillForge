import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useBoundedReveal, BOUNDED_STEP } from '../useBoundedReveal';

describe('useBoundedReveal (A16 有界渲染)', () => {
  it('renders at most BOUNDED_STEP items when count exceeds the threshold', () => {
    const { result } = renderHook(() => useBoundedReveal(120));
    expect(result.current.revealed).toBe(BOUNDED_STEP);
    expect(result.current.hasMore).toBe(true);
  });

  it('renders the full count when it is within the threshold (no hasMore)', () => {
    const { result } = renderHook(() => useBoundedReveal(BOUNDED_STEP - 1));
    expect(result.current.revealed).toBe(BOUNDED_STEP - 1);
    expect(result.current.hasMore).toBe(false);
  });

  it('revealMore increments the visible slice by BOUNDED_STEP', () => {
    const { result } = renderHook(() => useBoundedReveal(120));
    act(() => result.current.revealMore());
    expect(result.current.revealed).toBe(BOUNDED_STEP * 2);
    expect(result.current.hasMore).toBe(true);
    act(() => result.current.revealMore());
    expect(result.current.revealed).toBe(120);
    expect(result.current.hasMore).toBe(false);
  });

  it('clamps revealed to count when count shrinks below the reveal limit', () => {
    const { result, rerender } = renderHook(
      ({ count }: { count: number }) => useBoundedReveal(count),
      { initialProps: { count: 120 } }
    );
    act(() => result.current.revealMore());
    expect(result.current.revealed).toBe(BOUNDED_STEP * 2);
    // 模拟筛选后结果集缩小
    rerender({ count: 30 });
    expect(result.current.revealed).toBe(30);
    expect(result.current.hasMore).toBe(false);
  });

  it('handles an empty list', () => {
    const { result } = renderHook(() => useBoundedReveal(0));
    expect(result.current.revealed).toBe(0);
    expect(result.current.hasMore).toBe(false);
  });
});

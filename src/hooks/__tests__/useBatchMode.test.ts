import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBatchMode } from '../../hooks/useBatchMode';

describe('useBatchMode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts disabled with empty selection', () => {
    const { result } = renderHook(() => useBatchMode());
    expect(result.current.enabled).toBe(false);
    expect(result.current.selectedCount).toBe(0);
    expect(result.current.isSelected('a')).toBe(false);
  });

  it('enables and tracks selections', () => {
    const { result } = renderHook(() => useBatchMode());
    act(() => result.current.toggle());
    expect(result.current.enabled).toBe(true);
    act(() => result.current.toggleSelect('a'));
    act(() => result.current.toggleSelect('b'));
    expect(result.current.selectedCount).toBe(2);
    expect(result.current.isSelected('a')).toBe(true);
    expect(result.current.isSelected('c')).toBe(false);
    // deselect
    act(() => result.current.toggleSelect('a'));
    expect(result.current.selectedCount).toBe(1);
  });

  it('toggle off clears selection and hides controls', () => {
    const { result } = renderHook(() => useBatchMode());
    act(() => result.current.toggle());
    act(() => result.current.toggleSelect('a'));
    act(() => result.current.toggle());
    expect(result.current.enabled).toBe(false);
    expect(result.current.selectedCount).toBe(0);
  });

  it('exit clears selection and hides controls (清空选择/退出批量模式)', () => {
    const { result } = renderHook(() => useBatchMode());
    act(() => result.current.toggle());
    act(() => result.current.toggleSelect('a'));
    act(() => result.current.exit());
    expect(result.current.enabled).toBe(false);
    expect(result.current.selectedCount).toBe(0);
  });

  it('clear empties selection but stays enabled (armed 状态)', () => {
    const { result } = renderHook(() => useBatchMode());
    act(() => result.current.toggle());
    act(() => result.current.toggleSelect('a'));
    act(() => result.current.toggleSelect('b'));
    act(() => result.current.clear());
    expect(result.current.enabled).toBe(true);
    expect(result.current.selectedCount).toBe(0);
    expect(result.current.isSelected('a')).toBe(false);
    expect(result.current.isSelected('b')).toBe(false);
  });

  it('clear when already empty keeps batch mode enabled', () => {
    const { result } = renderHook(() => useBatchMode());
    act(() => result.current.toggle());
    act(() => result.current.clear());
    expect(result.current.enabled).toBe(true);
    expect(result.current.selectedCount).toBe(0);
  });

  it('Escape while enabled exits batch mode', () => {
    const { result } = renderHook(() => useBatchMode());
    act(() => result.current.toggle());
    act(() => result.current.toggleSelect('a'));
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(result.current.enabled).toBe(false);
    expect(result.current.selectedCount).toBe(0);
  });

  it('Escape while disabled does not change state', () => {
    const { result } = renderHook(() => useBatchMode());
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(result.current.enabled).toBe(false);
  });
});

import { pushModalScope, popModalScope } from '../../lib/modalScope';

describe('useBatchMode — Escape 与模态框共存（M9）', () => {
  it('Escape does not exit batch mode while a modal is open', () => {
    const { result } = renderHook(() => useBatchMode());
    act(() => result.current.toggle());
    act(() => pushModalScope());
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(result.current.enabled).toBe(true);
    act(() => popModalScope());
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(result.current.enabled).toBe(false);
  });
});

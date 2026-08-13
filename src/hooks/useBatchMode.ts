import { useCallback, useEffect, useState } from 'react';
import { hasOpenModal } from '../lib/modalScope';

/**
 * 批量模式状态（Phase 6 §3.7 状态机：默认隐藏 → armed → selected → exit）。
 * - 默认关闭时不渲染任何选择控件（enabled = false）；
 * - 开启后 armed：无选中项，动作禁用（由 BatchActionBar 渲染紧凑引导 + 退出）；
 * - selected：选中 ≥ 1 项，动作矩阵可用；
 * - exit：关闭开关或「清空选择」均清空已选并隐藏选择控件；Escape 同样退出。
 */
export function useBatchMode() {
  const [enabled, setEnabled] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const exit = useCallback(() => {
    setEnabled(false);
    setSelectedIds(new Set());
  }, []);

  /** 清空已选但保持批量模式开启（回到 armed 状态）。 */
  const clear = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      if (prev) setSelectedIds(new Set());
      return !prev;
    });
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const isSelected = useCallback(
    (id: string) => selectedIds.has(id),
    [selectedIds]
  );

  // Esc 退出批量模式（§7：Escape 只关闭当前对话框；有模态框在最上层时不退出批量模式）
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !hasOpenModal()) exit();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled, exit]);

  return {
    enabled,
    selectedIds,
    selectedCount: selectedIds.size,
    toggle,
    exit,
    clear,
    toggleSelect,
    isSelected,
  };
}

import { useEffect, useRef } from 'react';
import { pushModalScope, popModalScope } from '../lib/modalScope';

/**
 * 对话框无障碍行为（§7）：打开时注册模态作用域（供 Escape 判断最上层模态）、
 * 焦点进入对话框、关闭时恢复触发按钮焦点。
 * 返回容器 ref，需配合 role="dialog" aria-modal="true" aria-labelledby 使用。
 */
export function useDialogA11y(open: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    pushModalScope();
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => {
      popModalScope();
      previous?.focus?.();
    };
  }, [open]);
  return ref;
}

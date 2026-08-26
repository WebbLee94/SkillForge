/**
 * 模态框作用域计数器：对话框打开时 push、关闭时 pop。
 * 供 useBatchMode 的 Escape 处理器判断「当前是否有模态框在最上层」，
 * 保证 Escape 只关闭当前对话框而不连带退出批量模式（§7）。
 */
let modalCount = 0;

export function pushModalScope(): void {
  modalCount += 1;
}

export function popModalScope(): void {
  modalCount = Math.max(0, modalCount - 1);
}

export function hasOpenModal(): boolean {
  return modalCount > 0;
}

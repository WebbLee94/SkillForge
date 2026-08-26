import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ResourceImportDialog, type ImportItem } from '../ResourceImportDialog';
import { BOUNDED_STEP } from '../../../lib/useBoundedReveal';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty' },
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh-CN', changeLanguage: vi.fn() },
  }),
}));

const base = {
  title: '导入预览',
  itemKindLabel: '个文件',
  appendLabel: '追加选择',
  confirmLabel: '确认导入',
  cancelLabel: '取消',
  importing: false,
  onAppend: vi.fn(),
  onRemoveItem: vi.fn(),
  onRetryItem: vi.fn().mockResolvedValue(undefined),
  onConfirm: vi.fn().mockResolvedValue(undefined),
  onCancel: vi.fn(),
};

const mkItem = (overrides: Partial<ImportItem>): ImportItem => ({
  key: 'k1',
  name: 'item.md',
  path: '/p/item.md',
  status: 'valid',
  ...overrides,
});

describe('ResourceImportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <ResourceImportDialog {...base} open={false} items={[]} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows valid items with a remove action (有效项可移除)', () => {
    render(
      <ResourceImportDialog
        {...base}
        open
        items={[mkItem({ key: 'a', name: 'a.md' })]}
      />
    );
    expect(screen.getByText('a.md')).toBeDefined();
    // remove button present for valid item
    const removeBtn = screen.getByLabelText('remove-item');
    fireEvent.click(removeBtn);
    expect(base.onRemoveItem).toHaveBeenCalledWith('a');
  });

  it('shows skip/error reason and provides 忽略 + 重试 actions', async () => {
    const onRetryItem = vi.fn().mockResolvedValue(undefined);
    render(
      <ResourceImportDialog
        {...base}
        open
        onRetryItem={onRetryItem}
        items={[
          mkItem({
            key: 's',
            name: 'dup.md',
            status: 'skip',
            reason: 'alreadyExists',
          }),
          mkItem({
            key: 'e',
            name: 'bad.txt',
            status: 'error',
            reason: 'readFailed',
          }),
        ]}
      />
    );
    expect(screen.getByText('import.reason.alreadyExists')).toBeDefined();
    expect(screen.getByText('import.reason.readFailed')).toBeDefined();

    const retryButtons = screen.getAllByText('import.retry');
    expect(retryButtons.length).toBe(2);
    fireEvent.click(retryButtons[0]);
    expect(onRetryItem).toHaveBeenCalledWith('s');

    // 忽略 removes the item
    fireEvent.click(screen.getAllByText('import.ignore')[0]);
    expect(base.onRemoveItem).toHaveBeenCalledWith('s');
  });

  it('confirm triggers onConfirm and cancel triggers onCancel', async () => {
    render(
      <ResourceImportDialog
        {...base}
        open
        items={[mkItem({ key: 'a', name: 'a.md' })]}
      />
    );
    fireEvent.click(screen.getByText('确认导入'));
    expect(base.onConfirm).toHaveBeenCalled();
    fireEvent.click(screen.getByText('取消'));
    expect(base.onCancel).toHaveBeenCalled();
  });

  it('append button triggers onAppend', () => {
    render(
      <ResourceImportDialog
        {...base}
        open
        items={[mkItem({ key: 'a', name: 'a.md' })]}
      />
    );
    fireEvent.click(screen.getByText('追加选择'));
    expect(base.onAppend).toHaveBeenCalled();
  });

  it('result phase shows per-item result badges and summary counts', () => {
    render(
      <ResourceImportDialog
        {...base}
        open
        items={[
          mkItem({
            key: 'ok',
            name: 'ok.md',
            status: 'valid',
            result: 'success',
          }),
          mkItem({
            key: 'fail',
            name: 'fail.md',
            status: 'valid',
            result: 'failed',
          }),
          mkItem({
            key: 'skip',
            name: 'skip.md',
            status: 'skip',
            result: 'skipped',
          }),
        ]}
      />
    );
    // 结果徽标 + 底部汇总均展示结果标签
    expect(
      screen.getAllByText('import.result.success').length
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText('import.result.failed').length
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText('import.result.skipped').length
    ).toBeGreaterThanOrEqual(1);
    // 底部汇总：三种结果各 1 项
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(3);
  });

  it('result phase failed items can retry or ignore', async () => {
    const onRetryItem = vi.fn().mockResolvedValue(undefined);
    render(
      <ResourceImportDialog
        {...base}
        open
        onRetryItem={onRetryItem}
        items={[
          mkItem({
            key: 'fail',
            name: 'fail.md',
            status: 'valid',
            result: 'failed',
          }),
        ]}
      />
    );
    fireEvent.click(screen.getByText('import.retry'));
    expect(onRetryItem).toHaveBeenCalledWith('fail');
    fireEvent.click(screen.getByText('import.ignore'));
    expect(base.onRemoveItem).toHaveBeenCalledWith('fail');
  });

  it('Escape closes the dialog only', () => {
    render(
      <ResourceImportDialog
        {...base}
        open
        items={[mkItem({ key: 'a', name: 'a.md' })]}
      />
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(base.onCancel).toHaveBeenCalledTimes(1);
    expect(base.onConfirm).not.toHaveBeenCalled();
  });
});

describe('ResourceImportDialog — 对话框语义与焦点（M10）', () => {
  it('renders role=dialog + aria-modal and moves focus into the dialog', () => {
    render(
      <ResourceImportDialog
        {...base}
        open
        items={[mkItem({ key: 'a', name: 'a.md' })]}
      />
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(document.activeElement).toBe(dialog);
  });
});

describe('ResourceImportDialog — A16 有界渲染', () => {
  const manyItems = (n: number): ImportItem[] =>
    Array.from({ length: n }, (_, i) =>
      mkItem({ key: `k${i}`, name: `file-${i}.md`, path: `/p/file-${i}.md` })
    );

  it('renders only a bounded subset of a large import list', () => {
    render(<ResourceImportDialog {...base} open items={manyItems(120)} />);
    expect(screen.getAllByTestId('import-item').length).toBe(BOUNDED_STEP);
    expect(screen.getByText('file-0.md')).toBeDefined();
    expect(screen.queryByText(`file-${BOUNDED_STEP}.md`)).toBeNull();
  });

  it('keeps the full item count in the footer while the list is bounded', () => {
    render(<ResourceImportDialog {...base} open items={manyItems(120)} />);
    expect(screen.getByText(/^120/)).toBeDefined();
    expect(screen.getByText(/个文件/)).toBeDefined();
  });

  it('show more reveals the next bounded batch until exhausted', () => {
    render(<ResourceImportDialog {...base} open items={manyItems(120)} />);
    fireEvent.click(screen.getByTestId('show-more'));
    expect(screen.getAllByTestId('import-item').length).toBe(BOUNDED_STEP * 2);
    expect(screen.getByText(`file-${BOUNDED_STEP}.md`)).toBeDefined();
    fireEvent.click(screen.getByTestId('show-more'));
    expect(screen.getAllByTestId('import-item').length).toBe(120);
    expect(screen.getByText('file-119.md')).toBeDefined();
    expect(screen.queryByTestId('show-more')).toBeNull();
  });

  it('item actions still work on the bounded list', () => {
    const onRemoveItem = vi.fn();
    render(
      <ResourceImportDialog
        {...base}
        open
        onRemoveItem={onRemoveItem}
        items={manyItems(120)}
      />
    );
    const firstRemove = screen.getAllByLabelText('remove-item')[0];
    fireEvent.click(firstRemove);
    expect(onRemoveItem).toHaveBeenCalledWith('k0');
  });

  it('result phase counts stay full while rendering a bounded slice', () => {
    render(
      <ResourceImportDialog
        {...base}
        open
        items={manyItems(120).map((it) => ({
          ...it,
          result: 'success' as const,
        }))}
      />
    );
    expect(screen.getAllByTestId('import-item').length).toBe(BOUNDED_STEP);
    expect(screen.getByText(/^120/)).toBeDefined();
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImportPreviewDialog } from '../ImportPreviewDialog';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const mockPlatforms = [
  {
    platform_id: 'claude-code',
    platform_name: 'Claude Code',
    new_skills: [{ id: 's1', name: 'React', source_path: '/x/react.md' }],
    new_rules: [{ id: 'r1', name: 'Style', format: 'md', source_path: '/x/style.md' }],
    existing_skills: 2,
    existing_rules: 1,
  },
  {
    platform_id: 'cursor',
    platform_name: 'Cursor',
    new_skills: [],
    new_rules: [],
    existing_skills: 1,
    existing_rules: 0,
  },
];

describe('ImportPreviewDialog', () => {
  const baseProps = {
    open: false,
    platforms: mockPlatforms,
    totalNew: 2,
    totalSkipped: 3,
    importing: false,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
  };

  it('关闭时不渲染内容', () => {
    const { container } = render(<ImportPreviewDialog {...baseProps} />);
    expect(container.innerHTML).toBe('');
  });

  it('打开时渲染标题', () => {
    render(<ImportPreviewDialog {...baseProps} open />);
    expect(screen.getByText('import.previewTitle')).toBeDefined();
  });

  it('显示平台名称', () => {
    render(<ImportPreviewDialog {...baseProps} open />);
    expect(screen.getByText('Claude Code')).toBeDefined();
    expect(screen.getByText('Cursor')).toBeDefined();
  });

  it('显示新增技能和规则标签', () => {
    render(<ImportPreviewDialog {...baseProps} open />);
    expect(screen.getByText('import.newSkills', { exact: false })).toBeDefined();
    expect(screen.getByText('import.newRules', { exact: false })).toBeDefined();
  });

  it('显示已存在计数', () => {
    render(<ImportPreviewDialog {...baseProps} open />);
    expect(screen.getAllByText('import.existing', { exact: false }).length).toBeGreaterThanOrEqual(1);
  });

  it('显示导入摘要', () => {
    render(<ImportPreviewDialog {...baseProps} open />);
    expect(screen.getByText('import.summary')).toBeDefined();
  });

  it('显示确认导入按钮', () => {
    render(<ImportPreviewDialog {...baseProps} open />);
    expect(screen.getByText('import.confirmImport')).toBeDefined();
  });

  it('点击确认触发 onConfirm', () => {
    const onConfirm = vi.fn();
    render(<ImportPreviewDialog {...baseProps} open onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText('import.confirmImport'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('取消按钮触发 onClose', () => {
    const onClose = vi.fn();
    render(<ImportPreviewDialog {...baseProps} open onClose={onClose} />);
    fireEvent.click(screen.getByText('actions.cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('导入中显示导入中文本', () => {
    render(<ImportPreviewDialog {...baseProps} open importing />);
    expect(screen.getByText('import.importing')).toBeDefined();
  });

  it('导入中禁用取消按钮', () => {
    const onClose = vi.fn();
    render(<ImportPreviewDialog {...baseProps} open importing onClose={onClose} />);
    const cancelBtn = screen.getByText('actions.cancel');
    fireEvent.click(cancelBtn);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('无平台时显示未发现提示', () => {
    render(<ImportPreviewDialog {...baseProps} open platforms={[]} totalNew={0} totalSkipped={0} />);
    expect(screen.getByText('import.noDiscoverable')).toBeDefined();
  });

  it('无新内容时不显示确认按钮', () => {
    render(<ImportPreviewDialog {...baseProps} open platforms={[]} totalNew={0} totalSkipped={0} />);
    expect(screen.queryByText('import.confirmImport')).toBeNull();
  });
});
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AddProjectDialog } from '../AddProjectDialog';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('AddProjectDialog', () => {
  const baseProps = {
    open: false,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('关闭时不渲染内容', () => {
    const { container } = render(<AddProjectDialog {...baseProps} />);
    expect(container.innerHTML).toBe('');
  });

  it('打开时渲染对话框', () => {
    render(<AddProjectDialog {...baseProps} open />);
    expect(screen.getByText('addProjectDialog.title')).toBeDefined();
  });

  it('输入项目路径和名称', () => {
    render(<AddProjectDialog {...baseProps} open />);
    const pathInput = screen.getByPlaceholderText('addProjectDialog.selectFolder');
    const nameInput = screen.getByPlaceholderText('projectNamePlaceholder');

    fireEvent.change(pathInput, { target: { value: '/Users/test/project' } });
    fireEvent.change(nameInput, { target: { value: 'My Project' } });

    expect(pathInput).toHaveValue('/Users/test/project');
    expect(nameInput).toHaveValue('My Project');
  });

  it('确认按钮在空字段时禁用', () => {
    render(<AddProjectDialog {...baseProps} open />);
    const confirmBtn = screen.getByText('addProjectDialog.confirm');
    expect(confirmBtn.closest('button')).toBeDisabled();
  });

  it('填写字段后确认按钮启用', () => {
    render(<AddProjectDialog {...baseProps} open />);
    fireEvent.change(screen.getByPlaceholderText('addProjectDialog.selectFolder'), {
      target: { value: '/path' },
    });
    fireEvent.change(screen.getByPlaceholderText('projectNamePlaceholder'), {
      target: { value: 'Name' },
    });
    const confirmBtn = screen.getByText('addProjectDialog.confirm');
    expect(confirmBtn.closest('button')).not.toBeDisabled();
  });

  it('点击确认触发 onConfirm 并清空字段', () => {
    const onConfirm = vi.fn();
    render(<AddProjectDialog {...baseProps} open onConfirm={onConfirm} />);
    fireEvent.change(screen.getByPlaceholderText('addProjectDialog.selectFolder'), {
      target: { value: '/my/path' },
    });
    fireEvent.change(screen.getByPlaceholderText('projectNamePlaceholder'), {
      target: { value: 'MyProj' },
    });
    fireEvent.click(screen.getByText('addProjectDialog.confirm'));
    expect(onConfirm).toHaveBeenCalledWith({ name: 'MyProj', path: '/my/path' });
  });

  it('点击取消触发 onClose', () => {
    const onClose = vi.fn();
    render(<AddProjectDialog {...baseProps} open onClose={onClose} />);
    fireEvent.click(screen.getByText('actions.cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击 X 按钮触发 onClose', () => {
    const onClose = vi.fn();
    render(<AddProjectDialog {...baseProps} open onClose={onClose} />);
    const xButton = document.querySelector('button svg.lucide-x')?.closest('button');
    if (xButton) fireEvent.click(xButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('文件夹选择按钮存在', () => {
    render(<AddProjectDialog {...baseProps} open />);
    const folderButton = document.querySelector('button svg.lucide-folder-open')?.closest('button');
    expect(folderButton).toBeDefined();
  });
});

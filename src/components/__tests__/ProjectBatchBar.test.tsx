import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProjectBatchBar } from '../ProjectBatchBar';

const baseLabels = {
  selectedLabel: '已选 2 项',
  guideLabel: '勾选项目后操作',
  deleteLabel: '批量删除',
  clearLabel: '清空选择',
  exitLabel: '退出批量模式',
};

function renderBar(overrides: Partial<typeof baseLabels> & { enabled?: boolean; selectedCount?: number } = {}) {
  const props = {
    enabled: true,
    selectedCount: 0,
    ...baseLabels,
    ...overrides,
    onDelete: vi.fn(),
    onClear: vi.fn(),
    onExit: vi.fn(),
  };
  render(<ProjectBatchBar {...props} />);
  return props;
}

describe('ProjectBatchBar', () => {
  it('renders nothing when disabled', () => {
    renderBar({ enabled: false });
    expect(screen.queryByText(baseLabels.guideLabel)).toBeNull();
    expect(screen.queryByText(baseLabels.deleteLabel)).toBeNull();
  });

  it('armed state shows guide + exit and no action buttons', () => {
    renderBar({ selectedCount: 0 });
    expect(screen.getByText(baseLabels.guideLabel)).toBeDefined();
    expect(screen.getByText(baseLabels.exitLabel)).toBeDefined();
    expect(screen.queryByText(baseLabels.deleteLabel)).toBeNull();
    expect(screen.queryByText(baseLabels.clearLabel)).toBeNull();
  });

  it('selected state shows count + delete + clear + exit', () => {
    renderBar({ selectedCount: 2 });
    expect(screen.getByText(baseLabels.selectedLabel)).toBeDefined();
    expect(screen.getByText(baseLabels.deleteLabel)).toBeDefined();
    expect(screen.getByText(baseLabels.clearLabel)).toBeDefined();
    expect(screen.getByText(baseLabels.exitLabel)).toBeDefined();
    expect(screen.queryByText(baseLabels.guideLabel)).toBeNull();
  });

  it('fires onDelete when delete is clicked', () => {
    const props = renderBar({ selectedCount: 1 });
    fireEvent.click(screen.getByText(baseLabels.deleteLabel));
    expect(props.onDelete).toHaveBeenCalledTimes(1);
  });

  it('fires onClear when clear is clicked', () => {
    const props = renderBar({ selectedCount: 1 });
    fireEvent.click(screen.getByText(baseLabels.clearLabel));
    expect(props.onClear).toHaveBeenCalledTimes(1);
  });

  it('fires onExit when exit is clicked in armed state', () => {
    const props = renderBar({ selectedCount: 0 });
    fireEvent.click(screen.getByText(baseLabels.exitLabel));
    expect(props.onExit).toHaveBeenCalledTimes(1);
  });

  it('fires onExit when exit is clicked in selected state', () => {
    const props = renderBar({ selectedCount: 3 });
    fireEvent.click(screen.getByText(baseLabels.exitLabel));
    expect(props.onExit).toHaveBeenCalledTimes(1);
  });
});

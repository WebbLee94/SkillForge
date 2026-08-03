import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SortableRuleList } from '../SortableRuleList';
import type { SceneRule } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string) => defaultValue ?? key,
    i18n: { language: 'zh-CN' },
  }),
}));

const mockRules: SceneRule[] = [
  { rule_id: 'rl-1', rule_name: 'Style Guide', enabled: true, sort_order: 0 },
  { rule_id: 'rl-2', rule_name: 'Lint Config', enabled: false, sort_order: 1 },
  { rule_id: 'rl-3', rule_name: 'Naming Conventions', enabled: true, sort_order: 2 },
];

describe('SortableRuleList', () => {
  it('renders empty state when rules array is empty', () => {
    render(
      <SortableRuleList rules={[]} onRemove={vi.fn()} onToggle={vi.fn()} />
    );
    expect(screen.getByText('dragHint')).toBeDefined();
  });

  it('renders rule items with names', () => {
    render(
      <SortableRuleList rules={mockRules} onRemove={vi.fn()} onToggle={vi.fn()} />
    );
    expect(screen.getByText('Style Guide')).toBeDefined();
    expect(screen.getByText('Lint Config')).toBeDefined();
    expect(screen.getByText('Naming Conventions')).toBeDefined();
  });

  it('shows ToggleRight for enabled rules and ToggleLeft for disabled', () => {
    render(
      <SortableRuleList rules={mockRules} onRemove={vi.fn()} onToggle={vi.fn()} />
    );
    const disableButtons = screen.getAllByTitle('禁用');
    expect(disableButtons).toHaveLength(2);
    const enableButtons = screen.getAllByTitle('启用');
    expect(enableButtons).toHaveLength(1);
  });

  it('calls onToggle when toggle button is clicked', () => {
    const onToggle = vi.fn();
    render(
      <SortableRuleList rules={mockRules} onRemove={vi.fn()} onToggle={onToggle} />
    );
    fireEvent.click(screen.getAllByTitle('禁用')[0]);
    expect(onToggle).toHaveBeenCalledWith('rl-1');
  });

  it('calls onRemove when X button is clicked', () => {
    const onRemove = vi.fn();
    render(
      <SortableRuleList rules={mockRules} onRemove={onRemove} onToggle={vi.fn()} />
    );
    const xSvgElements = document.querySelectorAll('button svg.lucide-x');
    expect(xSvgElements.length).toBe(3);
    const xButtons = Array.from(xSvgElements).map(svg => svg.closest('button')!);
    fireEvent.click(xButtons[0]);
    expect(onRemove).toHaveBeenCalledWith('rl-1');
  });

  it('does not show remove buttons when disabled', () => {
    render(
      <SortableRuleList rules={mockRules} onRemove={vi.fn()} onToggle={vi.fn()} disabled={true} />
    );
    const xIcons = document.querySelectorAll('.lucide-x');
    expect(xIcons.length).toBe(0);
  });

  it('disables drag when disabled', () => {
    render(
      <SortableRuleList rules={mockRules} onRemove={vi.fn()} onToggle={vi.fn()} disabled={true} />
    );
    const draggableItems = document.querySelectorAll('[draggable="true"]');
    expect(draggableItems.length).toBe(0);
  });

  it('enables drag by default', () => {
    render(
      <SortableRuleList rules={mockRules} onRemove={vi.fn()} onToggle={vi.fn()} />
    );
    const draggableItems = document.querySelectorAll('[draggable="true"]');
    expect(draggableItems.length).toBe(3);
  });

  it('uses rule_id fallback when rule_name is falsy', () => {
    const ruleNoName: SceneRule = { rule_id: 'rl-99', rule_name: '', enabled: true, sort_order: 3 };
    render(
      <SortableRuleList rules={[ruleNoName]} onRemove={vi.fn()} onToggle={vi.fn()} />
    );
    expect(screen.getByText('rl-99')).toBeDefined();
  });

  it('fires dragStart handler with dataTransfer when enabled', () => {
    render(
      <SortableRuleList rules={mockRules} onRemove={vi.fn()} onToggle={vi.fn()} />
    );
    const row = document.querySelector('[draggable="true"]') as HTMLElement;
    const dt = { setData: vi.fn(), effectAllowed: '' };
    const event = new Event('dragstart', { bubbles: true });
    (event as any).dataTransfer = dt;
    row.dispatchEvent(event);
    expect(dt.setData).toHaveBeenCalledWith('text/plain', '0');
    expect(dt.effectAllowed).toBe('move');
  });

  it('skips dragStart dataTransfer when disabled', () => {
    render(
      <SortableRuleList rules={mockRules} onRemove={vi.fn()} onToggle={vi.fn()} disabled={true} />
    );
    const row = document.querySelector('[draggable="false"]') as HTMLElement;
    const dt = { setData: vi.fn(), effectAllowed: '' };
    const event = new Event('dragstart', { bubbles: true });
    (event as any).dataTransfer = dt;
    row.dispatchEvent(event);
    expect(dt.setData).not.toHaveBeenCalled();
    expect(dt.effectAllowed).toBe('');
  });
});
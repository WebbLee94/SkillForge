import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SortableSkillList } from '../SortableSkillList';
import type { SceneSkill } from '../../../types';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty' },
  useTranslation: () => ({
    t: (key: string, defaultValue?: string) => defaultValue ?? key,
    i18n: { language: 'zh-CN' },
  }),
}));

const mockSkills: SceneSkill[] = [
  { skill_id: 'sk-1', skill_name: 'TypeScript Mastery', version: '1.2.0', enabled: true, sort_order: 0 },
  { skill_id: 'sk-2', skill_name: 'React Pro', version: '2.0.0', enabled: false, sort_order: 1 },
  { skill_id: 'sk-3', skill_name: 'Rust Basics', version: null, enabled: true, sort_order: 2 },
];

describe('SortableSkillList', () => {
  it('renders empty state when skills array is empty', () => {
    render(<SortableSkillList skills={[]} onRemove={vi.fn()} onToggle={vi.fn()} />);
    expect(screen.getByText('dragHint')).toBeDefined();
  });

  it('renders skill items with names', () => {
    render(<SortableSkillList skills={mockSkills} onRemove={vi.fn()} onToggle={vi.fn()} />);
    expect(screen.getByText('TypeScript Mastery')).toBeDefined();
    expect(screen.getByText('React Pro')).toBeDefined();
    expect(screen.getByText('Rust Basics')).toBeDefined();
  });

  it('renders version badges when version is present', () => {
    render(<SortableSkillList skills={mockSkills} onRemove={vi.fn()} onToggle={vi.fn()} />);
    expect(screen.getByText('v1.2.0')).toBeDefined();
    expect(screen.getByText('v2.0.0')).toBeDefined();
    expect(screen.queryByText('vnull')).toBeNull();
  });

  it('shows ToggleRight icon for enabled skills and ToggleLeft for disabled', () => {
    render(<SortableSkillList skills={mockSkills} onRemove={vi.fn()} onToggle={vi.fn()} />);
    const toggleButtons = screen.getAllByTitle('禁用');
    expect(toggleButtons).toHaveLength(2);
    const enableButtons = screen.getAllByTitle('启用');
    expect(enableButtons).toHaveLength(1);
  });

  it('calls onToggle when toggle button is clicked', () => {
    const onToggle = vi.fn();
    render(<SortableSkillList skills={mockSkills} onRemove={vi.fn()} onToggle={onToggle} />);
    fireEvent.click(screen.getAllByTitle('禁用')[0]);
    expect(onToggle).toHaveBeenCalledWith('sk-1');
  });

  it('calls onRemove when X button is clicked', () => {
    const onRemove = vi.fn();
    render(<SortableSkillList skills={mockSkills} onRemove={onRemove} onToggle={vi.fn()} />);
    const xIcons = document.querySelectorAll('button svg.lucide-x');
    const xButtons = Array.from(xIcons).map((svg) => svg.closest('button')!);
    fireEvent.click(xButtons[0]);
    expect(onRemove).toHaveBeenCalledWith('sk-1');
  });

  it('does not show remove buttons when disabled', () => {
    render(<SortableSkillList skills={mockSkills} onRemove={vi.fn()} onToggle={vi.fn()} disabled={true} />);
    expect(document.querySelectorAll('.lucide-x').length).toBe(0);
  });

  it('adds disabled styling to toggle and grip when disabled', () => {
    render(<SortableSkillList skills={mockSkills} onRemove={vi.fn()} onToggle={vi.fn()} disabled={true} />);
    const gripIcons = document.querySelectorAll('.lucide-grip-vertical');
    expect(gripIcons.length).toBe(3);
    const notAllowedEls = document.querySelectorAll('.cursor-not-allowed');
    expect(notAllowedEls.length).toBeGreaterThan(0);
  });

  it('uses skill_id fallback when skill_name is falsy', () => {
    const skillNoName: SceneSkill = { skill_id: 'sk-4', skill_name: '', version: null, enabled: true, sort_order: 3 };
    render(<SortableSkillList skills={[skillNoName]} onRemove={vi.fn()} onToggle={vi.fn()} />);
    expect(screen.getByText('sk-4')).toBeDefined();
  });

  it('sets draggable attribute on skill rows by default', () => {
    render(<SortableSkillList skills={mockSkills} onRemove={vi.fn()} onToggle={vi.fn()} />);
    expect(document.querySelectorAll('[draggable="true"]').length).toBe(3);
  });

  it('removes draggable attribute when disabled', () => {
    render(<SortableSkillList skills={mockSkills} onRemove={vi.fn()} onToggle={vi.fn()} disabled={true} />);
    expect(document.querySelectorAll('[draggable="true"]').length).toBe(0);
  });

  it('fires dragStart handler which sets dataTransfer when enabled', () => {
    render(<SortableSkillList skills={mockSkills} onRemove={vi.fn()} onToggle={vi.fn()} />);
    const row = document.querySelector('[draggable="true"]') as HTMLElement;
    const dt = { setData: vi.fn(), effectAllowed: '' };
    const event = new Event('dragstart', { bubbles: true });
    (event as any).dataTransfer = dt;
    row.dispatchEvent(event);
    expect(dt.setData).toHaveBeenCalledWith('text/plain', '0');
    expect(dt.effectAllowed).toBe('move');
  });

  it('skips dragStart dataTransfer when disabled', () => {
    render(<SortableSkillList skills={mockSkills} onRemove={vi.fn()} onToggle={vi.fn()} disabled={true} />);
    const row = document.querySelector('[draggable="false"]') as HTMLElement;
    const dt = { setData: vi.fn(), effectAllowed: '' };
    const event = new Event('dragstart', { bubbles: true });
    (event as any).dataTransfer = dt;
    row.dispatchEvent(event);
    expect(dt.setData).not.toHaveBeenCalled();
    expect(dt.effectAllowed).toBe('');
  });
});

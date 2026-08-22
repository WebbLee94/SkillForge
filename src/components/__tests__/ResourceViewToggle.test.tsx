import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ResourceViewToggle } from '../../components/ui/ResourceViewToggle';

describe('ResourceViewToggle', () => {
  it('renders a tablist with group and list tabs', () => {
    render(
      <ResourceViewToggle
        view="group"
        onChange={vi.fn()}
        groupLabel="分组"
        listLabel="列表"
      />
    );
    expect(screen.getByRole('tablist')).toBeDefined();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveTextContent('分组');
    expect(tabs[1]).toHaveTextContent('列表');
  });

  it('sets aria-selected on the active view only', () => {
    const { rerender } = render(
      <ResourceViewToggle
        view="group"
        onChange={vi.fn()}
        groupLabel="分组"
        listLabel="列表"
      />
    );
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[1].getAttribute('aria-selected')).toBe('false');

    rerender(
      <ResourceViewToggle
        view="list"
        onChange={vi.fn()}
        groupLabel="分组"
        listLabel="列表"
      />
    );
    const tabs2 = screen.getAllByRole('tab');
    expect(tabs2[0].getAttribute('aria-selected')).toBe('false');
    expect(tabs2[1].getAttribute('aria-selected')).toBe('true');
  });

  it('calls onChange when a tab is clicked', () => {
    const onChange = vi.fn();
    render(
      <ResourceViewToggle
        view="group"
        onChange={onChange}
        groupLabel="分组"
        listLabel="列表"
      />
    );
    fireEvent.click(screen.getByRole('tab', { name: '列表' }));
    expect(onChange).toHaveBeenCalledWith('list');
  });

  it('supports arrow-key navigation within the tablist', () => {
    const onChange = vi.fn();
    render(
      <ResourceViewToggle
        view="group"
        onChange={onChange}
        groupLabel="分组"
        listLabel="列表"
      />
    );
    const tabs = screen.getAllByRole('tab');
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('list');
    expect(document.activeElement).toBe(tabs[1]);
  });
});

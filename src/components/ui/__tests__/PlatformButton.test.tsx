import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Globe } from 'lucide-react';
import { PlatformButton } from '../PlatformButton';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty' },
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (key === 'platforms.countTooltip')
        return `${opts?.name}: ${opts?.skills} 技能 / ${opts?.rules} 规则`;
      return key;
    },
    i18n: { language: 'zh-CN' },
  }),
}));

describe('PlatformButton', () => {
  const baseProps = {
    name: 'Cursor',
    icon: Globe,
    skillCount: 5,
    ruleCount: 3,
    isInstalled: true,
    onClick: vi.fn(),
  };

  it('renders platform name and skill/rule counts', () => {
    render(<PlatformButton {...baseProps} />);
    expect(screen.getByText('Cursor')).toBeDefined();
    const countContainer = screen.getByText((content) =>
      content.includes('5') && content.includes('3')
    );
    expect(countContainer).toBeDefined();
  });

  it('renders the icon component', () => {
    const { container } = render(<PlatformButton {...baseProps} />);
    const svg = container.querySelector('svg.lucide-globe');
    expect(svg).toBeDefined();
  });

  it('shows green dot when installed', () => {
    const { container } = render(<PlatformButton {...baseProps} isInstalled={true} />);
    const dot = container.querySelector('button > span:first-child');
    expect(dot?.className).toContain('bg-green-500');
  });

  it('shows muted dot when not installed', () => {
    const { container } = render(<PlatformButton {...baseProps} isInstalled={false} />);
    const dot = container.querySelector('button > span:first-child');
    expect(dot?.className).toContain('bg-muted-foreground');
  });

  it('applies selected styles when isSelected is true', () => {
    const { container } = render(<PlatformButton {...baseProps} isSelected={true} />);
    const btn = container.querySelector('button');
    expect(btn?.className).toContain('border-primary');
    expect(btn?.className).toContain('bg-primary');
  });

  it('applies default styles when not selected', () => {
    const { container } = render(<PlatformButton {...baseProps} isSelected={false} />);
    const btn = container.querySelector('button');
    expect(btn?.className).toContain('border-border');
    expect(btn?.className).toContain('bg-card');
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<PlatformButton {...baseProps} onClick={onClick} />);
    fireEvent.click(screen.getByText('Cursor'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('has title attribute with platform details', () => {
    render(<PlatformButton {...baseProps} />);
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('title')).toContain('Cursor');
    expect(btn.getAttribute('title')).toContain('5');
    expect(btn.getAttribute('title')).toContain('3');
  });
});

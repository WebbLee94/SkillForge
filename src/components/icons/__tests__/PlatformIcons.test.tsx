import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import type { JSX } from 'react';
import { getPlatformIcon, DefaultPlatformIcon } from '../PlatformIcons';

describe('PlatformIcons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a component for every known platform id', () => {
    const knownIds = [
      'claude-code',
      'claude',
      'opencode',
      'cursor',
      'trae',
      'trae-cn',
      'codebuddy',
      'codebuddy-cn',
      'codex',
      'hermes',
      'openclaw',
    ];
    for (const id of knownIds) {
      const Icon = getPlatformIcon(id);
      expect(typeof Icon).toBe('function');
      expect(Icon).not.toBe(DefaultPlatformIcon);
    }
  });

  it('matches platform ids case-insensitively', () => {
    const Icon = getPlatformIcon('CLAUDE-CODE');
    expect(typeof Icon).toBe('function');
    expect(Icon).not.toBe(DefaultPlatformIcon);
  });

  it('returns DefaultPlatformIcon for unknown ids', () => {
    const Icon = getPlatformIcon('does-not-exist');
    expect(Icon).toBe(DefaultPlatformIcon);
  });

  it('returns DefaultPlatformIcon for empty string', () => {
    const Icon = getPlatformIcon('');
    expect(Icon).toBe(DefaultPlatformIcon);
  });

  it('renders an svg with className passed through', () => {
    const Icon = getPlatformIcon('claude');
    const { container } = render(<Icon className="h-5 w-5 text-red-500" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('class')).toContain('h-5 w-5');
    expect(svg!.getAttribute('class')).toContain('text-red-500');
  });

  it('default icon renders an svg with className passed through', () => {
    const { container } = render(<DefaultPlatformIcon className="w-6" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('class')).toContain('w-6');
  });

  it('renders distinct svg content for different platforms', () => {
    const ClaudeIcon = getPlatformIcon('claude') as unknown as (props: {
      className?: string;
    }) => JSX.Element;
    const CursorIcon = getPlatformIcon('cursor') as unknown as (props: {
      className?: string;
    }) => JSX.Element;
    const { container: c1 } = render(<ClaudeIcon className="c" />);
    const { container: c2 } = render(<CursorIcon className="c" />);
    expect(c1.innerHTML).not.toBe(c2.innerHTML);
  });

  it('returns AgentIcon for agent platform id', () => {
    const Icon = getPlatformIcon('agent');
    expect(typeof Icon).toBe('function');
    expect(Icon).not.toBe(DefaultPlatformIcon);
  });

  it('renders agent icon with className passed through', () => {
    const Icon = getPlatformIcon('agent') as unknown as (props: {
      className?: string;
    }) => JSX.Element;
    const { container } = render(<Icon className="h-5 w-5 text-blue-500" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('class')).toContain('h-5 w-5');
    expect(svg!.getAttribute('class')).toContain('text-blue-500');
  });
});

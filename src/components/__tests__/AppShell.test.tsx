import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from '../AppShell';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'app.name': 'SkillForge',
        'app.subtitle': '技能编排与管理',
        'navGroups.overview': '概览',
        'navGroups.distribution': '分发',
        'navGroups.orchestration': '编排',
        'navGroups.resources': '资源',
        'nav.dashboard': '看板',
        'nav.globalDistribution': '全局分发',
        'nav.projectDistribution': '项目分发',
        'nav.scenes': '场景编排',
        'nav.skills': '技能库',
        'nav.rules': '规则管理',
        'nav.settings': '设置',
      };
      return map[key] ?? key;
    },
  }),
}));

describe('AppShell', () => {
  it('renders sidebar with app name', () => {
    render(
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>
    );
    expect(screen.getByText('SkillForge')).toBeDefined();
  });

  it('renders sidebar navigation items', () => {
    render(
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>
    );
    expect(screen.getByText('看板')).toBeDefined();
    expect(screen.getByText('技能库')).toBeDefined();
    expect(screen.getByText('规则管理')).toBeDefined();
    expect(screen.getByText('场景编排')).toBeDefined();
  });

  it('renders sidebar toggle button', () => {
    const { container } = render(
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>
    );
    // Find the toggle button by its icon (only toggle button has PanelLeftClose icon)
    const toggleIcon = container.querySelector('svg.lucide-panel-left-close');
    expect(toggleIcon).toBeDefined();
  });

  it('renders main content area', () => {
    render(
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>
    );
    const main = document.querySelector('main');
    expect(main).toBeDefined();
    expect(main?.className).toContain('flex-1');
  });
});
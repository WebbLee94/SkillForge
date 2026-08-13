import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from '../AppShell';
import { useAppStore } from '../../stores/appStore';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'app.name': 'SkillForge',
        'app.subtitle': '技能编排与管理',
        'navGroups.overview': '概览',
        'navGroups.distribution': '分发',
        'navGroups.orchestration': '场景',
        'navGroups.resources': '资源',
        'navGroups.system': '系统',
        'nav.dashboard': '概览',
        'nav.globalDistribution': '全局分发',
        'nav.projectDistribution': '项目分发',
        'nav.scenes': '场景',
        'nav.skills': '技能库',
        'nav.rules': '规则管理',
        'nav.settings': '设置',
        'breadcrumb.dashboard': '精简概览',
        'breadcrumb.globalDistribution': '工作区',
        'breadcrumb.projectDistribution': '项目',
        'breadcrumb.scenes': '可复用组合',
        'breadcrumb.skills': '技能',
        'breadcrumb.rules': '规则',
        'breadcrumb.settings': '设置',
        'shortcuts.title': '快捷键',
        'shortcuts.search': '搜索资源',
        'shortcuts.create': '新建资源',
        'shortcuts.closeDialog': '关闭当前对话框',
        'shortcuts.implemented': '已实现',
        'shortcuts.notImplemented': '未实现',
        'shortcuts.hint': '以下为常用快捷键指引',
        'actions.close': '关闭',
      };
      return map[key] ?? key;
    },
  }),
}));

beforeEach(() => {
  useAppStore.setState({ activeNav: 'dashboard' });
});

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
    expect(screen.getAllByText('概览').length).toBeGreaterThan(0);
    expect(screen.getByText('技能库')).toBeDefined();
    expect(screen.getByText('规则管理')).toBeDefined();
    expect(screen.getAllByText('场景').length).toBeGreaterThan(0);
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

  it('renders breadcrumb for the current page', () => {
    render(
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>
    );
    const crumb = screen.getByRole('navigation', { name: 'breadcrumb' });
    expect(crumb.textContent).toContain('概览');
    expect(crumb.textContent).toContain('精简概览');
  });

  it('updates breadcrumb when active nav changes', () => {
    useAppStore.setState({ activeNav: 'skills' });
    render(
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>
    );
    const crumb = screen.getByRole('navigation', { name: 'breadcrumb' });
    expect(crumb.textContent).toContain('资源');
    expect(crumb.textContent).toContain('技能');
  });

  it('opens the shortcuts dialog from the topbar button', () => {
    render(
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: '快捷键' }));
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByText('搜索资源')).toBeDefined();
    expect(screen.getByText('新建资源')).toBeDefined();
  });

  it('closes the shortcuts dialog on Escape', () => {
    render(
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: '快捷键' }));
    expect(screen.getByRole('dialog')).toBeDefined();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

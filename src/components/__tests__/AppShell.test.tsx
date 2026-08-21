import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from '../../app/AppShell';
import { useAppStore } from '../../stores/appStore';
import { setTheme, THEME_STORAGE_KEY } from '../../hooks/useTheme';

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
        'navGroups.settings': '设置',
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
        'topbar.collapse.collapse': '折叠侧边栏',
        'topbar.collapse.expand': '展开侧边栏',
      };
      return map[key] ?? key;
    },
  }),
}));

beforeEach(() => {
  useAppStore.setState({ activeNav: 'dashboard', toasts: [] });
  localStorage.removeItem(THEME_STORAGE_KEY);
  setTheme('light');
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

  it('topbar 左侧首元素为折叠按钮，右侧无任何可点击控件', () => {
    render(
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>
    );
    // 左侧折叠按钮：aria-label 区分 展开/折叠（展开态 = 当前已折叠）
    const toggle = screen.getByRole('button', {
      name: /折叠侧边栏|展开侧边栏/i,
    });
    expect(toggle).toBeDefined();
    // 右侧必须无主题/更多/快捷键按钮
    expect(
      screen.queryByRole('button', { name: /切换深色模式|toggle theme/i })
    ).toBeNull();
    expect(screen.queryByRole('button', { name: /更多|more/i })).toBeNull();
    expect(
      screen.queryByRole('button', { name: /快捷键|shortcuts/i })
    ).toBeNull();
    // 折叠按钮位于面包屑之前（DOM 顺序）
    const toggleEl = screen.getByRole('button', {
      name: /折叠侧边栏|展开侧边栏/i,
    });
    const crumb = screen.getByRole('navigation', { name: 'breadcrumb' });
    expect(
      toggleEl.compareDocumentPosition(crumb) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('renders the topbar at 52px height', () => {
    render(
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>
    );
    expect(screen.getByTestId('app-topbar')).toHaveClass('h-[52px]');
  });

  it('内容区使用紧凑壳层 px-5 py-3，宽屏不再限制 1180px', () => {
    render(
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>
    );
    const content = screen.getByTestId('app-content');
    expect(content).toHaveClass('md:px-5');
    expect(content).toHaveClass('py-3');
    expect(content).not.toHaveClass('max-w-[1180px]');
  });

  it('renders settings inside the sidebar footer', () => {
    render(
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>
    );
    expect(screen.getByTestId('sidebar-footer')).toContainElement(
      screen.getByRole('button', { name: /设置|settings/i })
    );
  });
});

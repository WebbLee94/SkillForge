import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from '../Sidebar';
import { useAppStore } from '../../stores/appStore';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string) => defaultValue ?? key,
    i18n: { language: 'zh-CN' },
  }),
}));

beforeEach(() => {
  useAppStore.setState({
    activeNav: 'dashboard',
    sidebarCollapsed: false,
  });
});

describe('Sidebar', () => {
  it('renders the app name and subtitle when not collapsed', () => {
    render(<Sidebar />);
    expect(screen.getByText('app.name')).toBeDefined();
    expect(screen.getByText('app.subtitle')).toBeDefined();
  });

  it('renders all nav group labels when not collapsed', () => {
    render(<Sidebar />);
    expect(screen.getByText('navGroups.overview')).toBeDefined();
    expect(screen.getByText('navGroups.distribution')).toBeDefined();
    expect(screen.getByText('navGroups.orchestration')).toBeDefined();
    expect(screen.getByText('navGroups.resources')).toBeDefined();
  });

  it('renders all navigation items', () => {
    render(<Sidebar />);
    expect(screen.getByText('nav.dashboard')).toBeDefined();
    expect(screen.getByText('nav.globalDistribution')).toBeDefined();
    expect(screen.getByText('nav.projectDistribution')).toBeDefined();
    expect(screen.getByText('nav.scenes')).toBeDefined();
    expect(screen.getByText('nav.skills')).toBeDefined();
    expect(screen.getByText('nav.rules')).toBeDefined();
    expect(screen.getByText('nav.settings')).toBeDefined();
  });

  it('highlights the active nav item', () => {
    useAppStore.setState({ activeNav: 'skills' });
    render(<Sidebar />);
    const skillButton = screen.getByText('nav.skills').closest('button');
    expect(skillButton?.className).toContain('bg-primary/10');
    expect(skillButton?.className).toContain('text-primary');
  });

  it('calls setActiveNav when a nav item is clicked', () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByText('nav.rules'));
    expect(useAppStore.getState().activeNav).toBe('rules');
  });

  it('calls setActiveNav when settings is clicked', () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByText('nav.settings'));
    expect(useAppStore.getState().activeNav).toBe('settings');
  });

  it('toggles sidebar collapse when the toggle button is clicked', () => {
    render(<Sidebar />);
    // Not collapsed initially
    expect(useAppStore.getState().sidebarCollapsed).toBe(false);
    // The collapse toggle button is the last button in the aside
    const aside = document.querySelector('aside')!;
    const buttons = aside.querySelectorAll('button');
    const toggleBtn = buttons[buttons.length - 1];
    fireEvent.click(toggleBtn);
    expect(useAppStore.getState().sidebarCollapsed).toBe(true);
  });

  it('hides text labels when collapsed', () => {
    useAppStore.setState({ sidebarCollapsed: true });
    render(<Sidebar />);
    expect(screen.queryByText('app.name')).toBeNull();
    expect(screen.queryByText('app.subtitle')).toBeNull();
    expect(screen.queryByText('nav.dashboard')).toBeNull();
    expect(screen.queryByText('nav.settings')).toBeNull();
    expect(screen.queryByText('navGroups.overview')).toBeNull();
  });

  it('renders nav items with titles for tooltips when collapsed', () => {
    useAppStore.setState({ sidebarCollapsed: true });
    render(<Sidebar />);
    // Settings button should have a title attribute
    const settingsBtn = screen.getByTitle('nav.settings');
    expect(settingsBtn).toBeDefined();
    // Dashboard button should have a title
    const dashBtn = screen.getByTitle('nav.dashboard');
    expect(dashBtn).toBeDefined();
  });
});
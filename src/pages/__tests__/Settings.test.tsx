import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Settings } from '../Settings';
import { useAppStore } from '../../stores/appStore';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh-CN', changeLanguage: vi.fn() },
  }),
}));

/* Ensure localStorage in jsdom */
beforeAll(() => {
  if (typeof globalThis.localStorage === 'undefined' || globalThis.localStorage === null) {
    const store: Record<string, string> = {};
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => { store[k] = v; },
        removeItem: (k: string) => { delete store[k]; },
        clear: () => { Object.keys(store).forEach(k => delete store[k]); },
        get length() { return Object.keys(store).length; },
        key: (i: number) => Object.keys(store)[i] ?? null,
      },
      configurable: true,
      writable: true,
    });
  }
});

async function seedRoutes(routes: Record<string, unknown>) {
  const { invoke } = await import('@tauri-apps/api/core');
  (invoke as any).mockImplementation((cmd: string) => {
    if (cmd in routes) return Promise.resolve(routes[cmd]);
    return Promise.reject(new Error(`Unknown: ${cmd}`));
  });
}

function cleanStore() {
  useAppStore.setState({
    skills: [], rules: [], tags: [], scenes: [], projects: [],
    platforms: [],
    dashboardStats: null, syncStatus: null,
    selectedSkill: null, currentScene: null, currentSceneDetail: null,
    editingRule: null, activeNav: 'dashboard', sidebarCollapsed: false,
    searchQuery: '', tagFilter: [], loading: false, toasts: [],
    globalDistSelectedPlatform: null, projectDistSelectedProjectId: null,
    projectDistSelectedPlatform: null,
    pendingSyncConfirm: null, resolveSyncConfirm: null,
  });
}

describe('Settings', () => {
  beforeEach(() => { cleanStore(); vi.clearAllMocks(); });

  it('renders general tab with all sections', async () => {
    await seedRoutes({
      get_app_config: { data_dir: '/u/test/.skillforge', db_path: '/u/test/.skillforge/db.sqlite', version: '1.1.0' },
      get_db_size: '2.3 MB',
    });
    render(<Settings />);

    await waitFor(() => expect(screen.getByText('settings:title')).toBeDefined());
    expect(screen.getByText('settings:tabs.general')).toBeDefined();
    expect(screen.getByText('~/.skillforge')).toBeDefined();
    expect(screen.getByText('2.3 MB')).toBeDefined();
    expect(screen.getByText('settings:general.language.title')).toBeDefined();
    expect(screen.getByText('settings:general.version.title')).toBeDefined();
    expect(screen.getByText('settings:general.github.title')).toBeDefined();
    expect(screen.getByText('settings:general.distribution.title')).toBeDefined();
  });

  it('switches to platforms tab and shows platform list', async () => {
    const platformData = {
      id: 'claude', name: 'Claude Code', enabled: true, adapter: 'generic', icon: null,
      paths: {
        global_skills_dir: '/home/.claude/skills',
        project_skills_pattern: '/home/.claude/projects/{project}/skills',
        global_rules_dir: '/home/.claude/rules',
        project_rules_pattern: null,
        global_rules_format: null,
        project_rules_format: null,
      },
    };
    const capabilitiesData = {
      skills_global: true, skills_project: true, rules_global: true, rules_project: true,
      rules_format_global: null, rules_format_project: null, limitation_notes: [],
    };

    await seedRoutes({
      get_app_config: { data_dir: '/d/.skillforge', db_path: '', version: '1.1.0' },
      get_db_size: '1.1 MB',
      list_platforms: [platformData],
      get_platform_capabilities: capabilitiesData,
    });
    render(<Settings />);

    await waitFor(() => expect(screen.getByText('settings:title')).toBeDefined());

    fireEvent.click(screen.getByText('settings:tabs.platforms'));

    await waitFor(() => expect(screen.getByText('Claude Code')).toBeDefined());
    expect(screen.getByText('settings:platforms.title')).toBeDefined();
  });

  it('renders toggle switches for each platform', async () => {
    await seedRoutes({
      get_app_config: { data_dir: '/d/.skillforge', db_path: '', version: '1.1.0' },
      get_db_size: '1.1 MB',
      list_platforms: [
        { id: 'claude', name: 'Claude Code', enabled: true, adapter: 'generic', icon: null,
          paths: { global_skills_dir: '/c/skills', project_skills_pattern: '/c/p/{p}/skills', global_rules_dir: null, project_rules_pattern: null, global_rules_format: null, project_rules_format: null } },
        { id: 'github', name: 'GitHub Copilot', enabled: false, adapter: 'generic', icon: null,
          paths: { global_skills_dir: '/g/skills', project_skills_pattern: '/g/p/{p}/skills', global_rules_dir: null, project_rules_pattern: null, global_rules_format: null, project_rules_format: null } },
      ],
      get_platform_capabilities: {
        skills_global: true, skills_project: true, rules_global: true, rules_project: true,
        rules_format_global: null, rules_format_project: null, limitation_notes: [],
      },
      toggle_platform_enabled: {},
    });
    render(<Settings />);

    await waitFor(() => expect(screen.getByText('settings:title')).toBeDefined());
    fireEvent.click(screen.getByText('settings:tabs.platforms'));

    await waitFor(() => {
      const switches = screen.getAllByRole('switch');
      expect(switches.length).toBe(2);
    });
  });

  it('shows database size after loading', async () => {
    await seedRoutes({
      get_app_config: { data_dir: '/d/.skillforge', db_path: '', version: '1.1.0' },
      get_db_size: '3.1 MB',
    });
    render(<Settings />);
    await waitFor(() => expect(screen.getByText('3.1 MB')).toBeDefined());
  });
});
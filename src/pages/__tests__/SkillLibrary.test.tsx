import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SkillLibrary } from '../SkillLibrary';
import { useAppStore } from '../../stores/appStore';
import type { Skill, Tag } from '../../types';

/* ===== Hoisted mocks ===== */
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: vi.fn() }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh-CN', changeLanguage: vi.fn() },
  }),
}));

/* ===== Factories ===== */
const mkSkill = (
  id: string,
  name: string,
  overrides?: Partial<Skill>
): Skill => ({
  id,
  name,
  description: `Description for ${name}`,
  source_type: 'local',
  source_url: null,
  current_ver: '1.0.0',
  installed_at: '2025-01-15T10:00:00Z',
  local_path: `/path/${name}`,
  metadata: null,
  tags: [],
  ...overrides,
});

const mkTag = (id: number, name: string): Tag => ({
  id,
  name,
  color: '#3B82F6',
  tag_type: 'skill' as const,
  count: 2,
});

/* ===== Store reset ===== */
function resetStore() {
  useAppStore.setState({
    skills: [],
    rules: [],
    tags: [],
    scenes: [],
    projects: [],
    platforms: [],
    dashboardStats: null,
    syncStatus: null,
    selectedSkill: null,
    currentScene: null,
    currentSceneDetail: null,
    editingRule: null,
    activeNav: 'skills',
    sidebarCollapsed: false,
    searchQuery: '',
    tagFilter: [],
    loading: false,
    toasts: [],
    globalDistSelectedPlatform: null,
    projectDistSelectedProjectId: null,
    projectDistSelectedPlatform: null,
    pendingSyncConfirm: null,
    resolveSyncConfirm: null,
  });
}

/* ===== Invoke mock helper ===== */
async function setupInvoke(routes: Record<string, unknown>) {
  const { invoke } = await import('@tauri-apps/api/core');
  (invoke as any).mockImplementation((cmd: string) => {
    if (cmd in routes) {
      const val = routes[cmd];
      return val instanceof Error ? Promise.reject(val) : Promise.resolve(val);
    }
    return Promise.reject(new Error(`Unexpected invoke: ${cmd}`));
  });
}

/* =================================================== */
/*  Tests                                              */
/* =================================================== */
describe('SkillLibrary', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('renders loading skeleton when loading is true', async () => {
    // Route the invoke mocks so the mount effect (fetchSkills/fetchTags) resolves
    // to real arrays; otherwise invoke returns undefined and fetchSkills would
    // set skills: undefined, crashing the skills.filter render.
    await setupInvoke({ list_skills: [], list_tags: [] });
    useAppStore.setState({ loading: true });
    render(<SkillLibrary />);
    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThanOrEqual(6);
  });

  it('shows empty state when no skills exist', async () => {
    await setupInvoke({ list_skills: [], list_tags: [] });
    render(<SkillLibrary />);
    // fetchSkills (useEffect) → invoke('list_skills') → [] → set state → re-render
    await waitFor(() => {
      expect(screen.getByText('empty')).toBeDefined();
    });
  });

  it('renders skill cards populated from invoke', async () => {
    const tags: Tag[] = [mkTag(1, 'frontend'), mkTag(2, 'backend')];
    const skills: Skill[] = [
      mkSkill('s1', 'React', { tags: [tags[0]] }),
      mkSkill('s2', 'Express', { tags: [tags[1]] }),
    ];
    await setupInvoke({
      list_skills: skills,
      list_tags: tags,
    });

    render(<SkillLibrary />);

    await waitFor(() => {
      expect(screen.getByText('React')).toBeDefined();
    });
    expect(screen.getByText('Express')).toBeDefined();
  });

  it('filters skills by search query', async () => {
    const tags: Tag[] = [mkTag(1, 'frontend')];
    const skills: Skill[] = [
      mkSkill('s1', 'React', { tags: [tags[0]] }),
      mkSkill('s2', 'Express'),
    ];
    await setupInvoke({
      list_skills: skills,
      list_tags: tags,
    });

    render(<SkillLibrary />);
    await waitFor(() => {
      expect(screen.getByText('React')).toBeDefined();
    });

    // Type in the search box
    const searchInput = screen.getByPlaceholderText('searchPlaceholder');
    fireEvent.change(searchInput, { target: { value: 'React' } });

    // Wait for debounce (300ms) + re-render
    await waitFor(
      () => {
        expect(screen.queryByText('Express')).toBeNull();
      },
      { timeout: 1500 }
    );
    expect(screen.getByText('React')).toBeDefined();
  });

  it('filters skills when a tag chip is clicked', async () => {
    const tags: Tag[] = [mkTag(1, 'frontend'), mkTag(2, 'backend')];
    const skills: Skill[] = [
      mkSkill('s1', 'React', { tags: [tags[0]] }),
      mkSkill('s2', 'Express', { tags: [tags[1]] }),
      mkSkill('s3', 'Node'),
    ];
    await setupInvoke({
      list_skills: skills,
      list_tags: tags,
    });

    render(<SkillLibrary />);
    await waitFor(() => {
      expect(screen.getByText('React')).toBeDefined();
    });

    // Click the tag filter chip for 'frontend' — use role query to find the <button>
    const frontendChip = screen.getByRole('button', { name: /frontend/i });
    fireEvent.click(frontendChip);

    await waitFor(() => {
      expect(screen.getByText('React')).toBeDefined();
    });
    // Express and Node should be filtered out
    expect(screen.queryByText('Express')).toBeNull();
    expect(screen.queryByText('Node')).toBeNull();
  });

  it('shows detail panel when a skill is selected', async () => {
    const skills: Skill[] = [mkSkill('s1', 'React', { metadata: '{"author":"Test Author"}' })];
    await setupInvoke({
      list_skills: skills,
      list_tags: [],
    });

    render(<SkillLibrary />);
    await waitFor(() => {
      expect(screen.getByText('React')).toBeDefined();
    });

    // Click on the skill card
    const card = screen.getByText('React').closest('[style*="cursor: pointer"]') || screen.getByText('React');
    fireEvent.click(card);

    await waitFor(() => {
      // The detail panel heading should show the skill name
      const headings = screen.getAllByText('React');
      expect(headings.length).toBeGreaterThanOrEqual(2);
    });
    expect(screen.getByText('detail.author')).toBeDefined();
    expect(screen.getByText('Test Author')).toBeDefined();
  });

  it('opens uninstall confirm dialog from detail panel', async () => {
    const skills: Skill[] = [mkSkill('s1', 'React')];
    await setupInvoke({
      list_skills: skills,
      list_tags: [],
    });

    render(<SkillLibrary />);
    await waitFor(() => {
      expect(screen.getByText('React')).toBeDefined();
    });

    // Select the skill first
    fireEvent.click(screen.getByText('React'));
    await waitFor(() => {
      const btns = screen.getAllByText('actions.uninstall');
      expect(btns.length).toBeGreaterThanOrEqual(1);
    });

    // Click the uninstall button in detail panel
    const uninstallBtns = screen.getAllByText('actions.uninstall');
    const detailUninstall = uninstallBtns[0];
    fireEvent.click(detailUninstall);

    await waitFor(() => {
      expect(screen.getByText('messages.confirmUninstall')).toBeDefined();
    });
  });

  it('handles fetch failure gracefully', async () => {
    await setupInvoke({
      list_skills: new Error('DB connection failed'),
      list_tags: new Error('DB connection failed'),
    });

    render(<SkillLibrary />);

    await waitFor(() => {
      expect(screen.getByText('empty')).toBeDefined();
    });
  });
});
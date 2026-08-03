import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { DistributeDialog } from '../DistributeDialog';
import { useAppStore } from '../../stores/appStore';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockPlatforms: any[] = [
  { id: 'claude-code', name: 'Claude Code', adapter: 'fs', enabled: true, icon: null, paths: { global_skills_dir: '/x', project_skills_pattern: 'x', global_rules_dir: null, project_rules_pattern: null, global_rules_format: null, project_rules_format: null } },
  { id: 'cursor', name: 'Cursor', adapter: 'fs', enabled: true, icon: null, paths: { global_skills_dir: '/x', project_skills_pattern: 'x', global_rules_dir: null, project_rules_pattern: null, global_rules_format: null, project_rules_format: null } },
];

const mockSkills: any[] = [
  { id: 's1', name: 'React', description: null, source_type: 'custom', source_url: null, current_ver: null, installed_at: '', local_path: '', metadata: null },
  { id: 's2', name: 'Vue', description: null, source_type: 'custom', source_url: null, current_ver: null, installed_at: '', local_path: '', metadata: null },
];

const mockRules: any[] = [
  { id: 'r1', name: 'Style', description: null, format: 'md', content: '# style', platform: null, scope: 'global', version: 1, updated_at: '' },
  { id: 'r2', name: 'Lint', description: null, format: 'yaml', content: 'rules: []', platform: null, scope: 'global', version: 1, updated_at: '' },
];

const mockScenes: any[] = [
  { id: 'scene-1', name: 'Frontend', description: null, icon: null, is_template: false, is_system: false, created_at: '', updated_at: '' },
];

function resetStore() {
  useAppStore.setState({
    skills: mockSkills, rules: mockRules, tags: [], scenes: mockScenes,
    projects: [], platforms: mockPlatforms, distributions: [], recentActivity: [],
    dashboardStats: null, syncStatus: null, globalDistStatus: null,
    selectedSkill: null, currentScene: null, currentSceneDetail: null,
    editingRule: null, activeNav: 'dashboard', sidebarCollapsed: false,
    searchQuery: '', tagFilter: [], loading: false, toasts: [],
    globalDistSelectedPlatform: null, projectDistSelectedProjectId: null,
    projectDistSelectedPlatform: null, pendingSyncConfirm: null, resolveSyncConfirm: null,
  });
}

describe('DistributeDialog', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetStore();
  });

  it('关闭时不渲染内容', () => {
    const { container } = render(
      <DistributeDialog open={false} onClose={vi.fn()} scope="global" />
    );
    expect(container.innerHTML).toBe('');
  });

  it('项目分发模式关闭时不渲染', () => {
    const project = { id: 'p1', name: 'MyProj', path: '/tmp/p', scene_id: null, description: null, created_at: '', updated_at: '' };
    const { container } = render(
      <DistributeDialog open={false} onClose={vi.fn()} scope="project" project={project} />
    );
    expect(container.innerHTML).toBe('');
  });
});
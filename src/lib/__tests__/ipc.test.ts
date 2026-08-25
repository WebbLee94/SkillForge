import { describe, it, expect, vi } from 'vitest';
import { ipc } from '../ipc';
import type { DistributionSelection } from '../../types';

// vi.mock is hoisted — the mock is in place before ../ipc is loaded
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

function mockInvoke() {
  // The mocked invoke is captured via dynamic import inside each test
  // because vi.mock() replaces the module at the hoisted level
  return import('@tauri-apps/api/core').then(
    (m: any) => m.invoke as ReturnType<typeof vi.fn>
  );
}

describe('ipc — Skills', () => {
  it('listSkills passes command and optional args', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue([]);
    await ipc.listSkills('custom', 'tag1');
    expect(invoke).toHaveBeenCalledWith('list_skills', {
      sourceType: 'custom',
      tag: 'tag1',
    });
  });

  it('listSkills works without args', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue([]);
    await ipc.listSkills();
    expect(invoke).toHaveBeenCalledWith('list_skills', {
      sourceType: undefined,
      tag: undefined,
    });
  });

  it('installSkill passes command and args', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue({ id: 'sk-1' });
    await ipc.installSkill('local-fs', 'sk-1');
    expect(invoke).toHaveBeenCalledWith('install_skill', {
      source: 'local-fs',
      skillId: 'sk-1',
    });
  });

  it('installSkillsBatch passes command and args', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue([]);
    await ipc.installSkillsBatch('remote', ['sk-1', 'sk-2']);
    expect(invoke).toHaveBeenCalledWith('install_skills_batch', {
      source: 'remote',
      skillIds: ['sk-1', 'sk-2'],
    });
  });

  it('uninstallSkill passes command and args', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue({ id: 'sk-1' });
    await ipc.uninstallSkill('sk-1');
    expect(invoke).toHaveBeenCalledWith('uninstall_skill', { skillId: 'sk-1' });
  });

  it('updateSkill passes command and args', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue({ id: 'sk-1' });
    await ipc.updateSkill('sk-1');
    expect(invoke).toHaveBeenCalledWith('update_skill', { skillId: 'sk-1' });
  });

  it('searchSkills passes command and args', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue([]);
    await ipc.searchSkills('test');
    expect(invoke).toHaveBeenCalledWith('search_skills', { query: 'test' });
  });
});

describe('ipc — Scenes', () => {
  it('listScenes passes command', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue([]);
    await ipc.listScenes();
    expect(invoke).toHaveBeenCalledWith('list_scenes');
  });

  it('createScene passes command and data', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue({ id: 'sc-1' });
    const data = { name: 'Test', description: 'desc', icon: 'star' };
    await ipc.createScene(data);
    expect(invoke).toHaveBeenCalledWith('create_scene', { data });
  });

  it('updateScene passes command and args', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue(undefined);
    await ipc.updateScene('sc-1', { name: 'Updated' });
    expect(invoke).toHaveBeenCalledWith('update_scene', {
      id: 'sc-1',
      data: { name: 'Updated' },
    });
  });

  it('deleteScene passes command and args', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue(undefined);
    await ipc.deleteScene('sc-1');
    expect(invoke).toHaveBeenCalledWith('delete_scene', { id: 'sc-1' });
  });

  it('addSkillToScene passes command and args', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue(undefined);
    await ipc.addSkillToScene('sc-1', 'sk-1');
    expect(invoke).toHaveBeenCalledWith('add_skill_to_scene', {
      sceneId: 'sc-1',
      skillId: 'sk-1',
    });
  });

  it('removeSkillFromScene passes command and args', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue(undefined);
    await ipc.removeSkillFromScene('sc-1', 'sk-1');
    expect(invoke).toHaveBeenCalledWith('remove_skill_from_scene', {
      sceneId: 'sc-1',
      skillId: 'sk-1',
    });
  });

  it('addRuleToScene passes command and args', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue(undefined);
    await ipc.addRuleToScene('sc-1', 'rl-1');
    expect(invoke).toHaveBeenCalledWith('add_rule_to_scene', {
      sceneId: 'sc-1',
      ruleId: 'rl-1',
    });
  });

  it('removeRuleFromScene passes command and args', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue(undefined);
    await ipc.removeRuleFromScene('sc-1', 'rl-1');
    expect(invoke).toHaveBeenCalledWith('remove_rule_from_scene', {
      sceneId: 'sc-1',
      ruleId: 'rl-1',
    });
  });

  it('getSceneDetail passes command and args', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue({ scene: {} as any, skills: [], rules: [] });
    await ipc.getSceneDetail('sc-1');
    expect(invoke).toHaveBeenCalledWith('get_scene_detail', { id: 'sc-1' });
  });
});

describe('ipc — Distribution', () => {
  it('previewDistribution sends independent global Skills and Rules intents', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue({ platforms: [], has_removals: false });
    const selection: DistributionSelection = {
      sceneId: null,
      platformIds: ['platform-1'],
      scope: 'global',
      skills: { mode: 'preserve', ids: [] },
      rules: { mode: 'add_or_update', ids: ['rule-a'] },
    };

    await ipc.previewDistribution(selection);

    expect(invoke).toHaveBeenCalledWith('preview_distribution', selection);
  });

  it('previewDistribution sends independent project Skills and Rules intents', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue({ platforms: [], has_removals: false });
    const selection: DistributionSelection = {
      sceneId: null,
      platformIds: ['platform-1'],
      scope: 'project',
      projectId: 'project-1',
      skills: { mode: 'add_or_update', ids: ['skill-a'] },
      rules: { mode: 'preserve', ids: [] },
    };

    await ipc.previewDistribution(selection);

    expect(invoke).toHaveBeenCalledWith('preview_distribution', selection);
  });

  it('executeDistribution sends the confirmed selection and plan', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue({
      installed: [],
      updated: [],
      removed: [],
      errors: [],
    });
    const selection: DistributionSelection = {
      sceneId: null,
      platformIds: ['platform-1'],
      scope: 'global',
      skills: { mode: 'remove_selected', ids: ['skill-a'] },
      rules: { mode: 'preserve', ids: [] },
    };
    const plan = { platforms: [], has_removals: true };

    await ipc.executeDistribution(selection, plan);

    expect(invoke).toHaveBeenCalledWith('execute_distribution', {
      selection,
      plan,
    });
  });

  it('getManagedDistributionState sends camelCase scope arguments', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue({ platforms: [] });

    await ipc.getManagedDistributionState(
      ['platform-1'],
      'project',
      'project-1'
    );

    expect(invoke).toHaveBeenCalledWith('get_managed_distribution_state', {
      platformIds: ['platform-1'],
      scope: 'project',
      projectId: 'project-1',
    });
  });

  it('syncScene passes command with all args', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue({ errors: [] });
    await ipc.syncScene(
      ['sk-1'],
      ['rl-1'],
      'sc-1',
      ['platform-1'],
      'global',
      'proj-1'
    );
    expect(invoke).toHaveBeenCalledWith('sync_scene', {
      skillIds: ['sk-1'],
      ruleIds: ['rl-1'],
      sceneId: 'sc-1',
      platforms: ['platform-1'],
      scope: 'global',
      projectId: 'proj-1',
    });
  });

  it('syncScene passes null for optional sceneId and projectId', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue({ errors: [] });
    await ipc.syncScene([], [], null, null, 'local');
    expect(invoke).toHaveBeenCalledWith('sync_scene', {
      skillIds: [],
      ruleIds: [],
      sceneId: null,
      platforms: null,
      scope: 'local',
      projectId: undefined,
    });
  });

  it('getSyncStatus passes command', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue({ platforms: [] });
    await ipc.getSyncStatus();
    expect(invoke).toHaveBeenCalledWith('get_sync_status');
  });
});

describe('ipc — Projects', () => {
  it('listProjects passes command', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue([]);
    await ipc.listProjects();
    expect(invoke).toHaveBeenCalledWith('list_projects');
  });

  it('addProject passes command with all args', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue({ id: 'pj-1' } as any);
    await ipc.addProject('My Project', '/path/to/proj', 'A test project');
    expect(invoke).toHaveBeenCalledWith('add_project', {
      name: 'My Project',
      path: '/path/to/proj',
      description: 'A test project',
    });
  });

  it('addProject passes command without optional args', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue({ id: 'pj-1' } as any);
    await ipc.addProject('Minimal', '/minimal');
    expect(invoke).toHaveBeenCalledWith('add_project', {
      name: 'Minimal',
      path: '/minimal',
      sceneId: undefined,
      description: undefined,
    });
  });

  it('removeProject passes command and args', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue(undefined);
    await ipc.removeProject('pj-1');
    expect(invoke).toHaveBeenCalledWith('remove_project', { id: 'pj-1' });
  });

  it('renameProject passes command and args', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue({ id: 'pj-1' } as any);
    await ipc.renameProject('pj-1', 'New Name');
    expect(invoke).toHaveBeenCalledWith('rename_project', {
      id: 'pj-1',
      name: 'New Name',
    });
  });
});

describe('ipc — Rules', () => {
  it('listRules passes command without platform', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue([]);
    await ipc.listRules();
    expect(invoke).toHaveBeenCalledWith('list_rules', { platform: undefined });
  });

  it('listRules passes command with platform', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue([]);
    await ipc.listRules('claude-code');
    expect(invoke).toHaveBeenCalledWith('list_rules', {
      platform: 'claude-code',
    });
  });

  it('createRule passes command and data', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue({ id: 'rl-1' } as any);
    const data = {
      name: 'Test Rule',
      description: '',
      format: 'markdown',
      content: '# rule',
      platform: 'claude-code',
      scope: 'global',
    };
    await ipc.createRule(data);
    expect(invoke).toHaveBeenCalledWith('create_rule', { data });
  });

  it('updateRule passes command and args', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue(undefined);
    await ipc.updateRule('rl-1', { name: 'Updated' });
    expect(invoke).toHaveBeenCalledWith('update_rule', {
      id: 'rl-1',
      data: { name: 'Updated' },
    });
  });

  it('deleteRule passes command and args', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue(undefined);
    await ipc.deleteRule('rl-1');
    expect(invoke).toHaveBeenCalledWith('delete_rule', { id: 'rl-1' });
  });
});

describe('ipc — Tags', () => {
  it('listTags passes command with all optional args', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue([]);
    await ipc.listTags('skill', 'custom', 'test');
    expect(invoke).toHaveBeenCalledWith('list_tags', {
      category: 'skill',
      tagType: 'custom',
      search: 'test',
    });
  });

  it('listTags passes command without args', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue([]);
    await ipc.listTags();
    expect(invoke).toHaveBeenCalledWith('list_tags', {
      category: undefined,
      tagType: undefined,
      search: undefined,
    });
  });

  it('createTag passes command with all optional args', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue({ id: 1 } as any);
    await ipc.createTag('my-tag', '#ff0000', 'custom', 'skill');
    expect(invoke).toHaveBeenCalledWith('create_tag', {
      name: 'my-tag',
      color: '#ff0000',
      category: 'custom',
      tagType: 'skill',
    });
  });

  it('createTag passes command with only name', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue({ id: 1 } as any);
    await ipc.createTag('simple');
    expect(invoke).toHaveBeenCalledWith('create_tag', {
      name: 'simple',
      color: undefined,
      category: undefined,
      tagType: undefined,
    });
  });

  it('updateTag passes command and args', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue(undefined);
    await ipc.updateTag(1, 'new-name', '#00ff00');
    expect(invoke).toHaveBeenCalledWith('update_tag', {
      id: 1,
      name: 'new-name',
      color: '#00ff00',
      category: undefined,
    });
  });

  it('deleteTag passes command and args', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue(undefined);
    await ipc.deleteTag(1);
    expect(invoke).toHaveBeenCalledWith('delete_tag', { id: 1 });
  });

  it('assignTag passes command and args', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue(undefined);
    await ipc.assignTag('skill', 'sk-1', 1);
    expect(invoke).toHaveBeenCalledWith('assign_tag', {
      targetType: 'skill',
      targetId: 'sk-1',
      tagId: 1,
    });
  });

  it('removeTag passes command and args', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue(undefined);
    await ipc.removeTag('rule', 'rl-1', 2);
    expect(invoke).toHaveBeenCalledWith('remove_tag', {
      targetType: 'rule',
      targetId: 'rl-1',
      tagId: 2,
    });
  });
});

describe('ipc — System', () => {
  it('getAppConfig passes command', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue({
      data_dir: '/data',
      db_path: '/db',
      version: '1.0',
    } as any);
    await ipc.getAppConfig();
    expect(invoke).toHaveBeenCalledWith('get_app_config');
  });

  it('getDashboardStats passes command', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue({} as any);
    await ipc.getDashboardStats();
    expect(invoke).toHaveBeenCalledWith('get_dashboard_stats');
  });

  it('listPlatforms passes command', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue([]);
    await ipc.listPlatforms();
    expect(invoke).toHaveBeenCalledWith('list_platforms');
  });

  it('togglePlatformEnabled passes command and args', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue(undefined);
    await ipc.togglePlatformEnabled('p-1', true);
    expect(invoke).toHaveBeenCalledWith('toggle_platform_enabled', {
      id: 'p-1',
      enabled: true,
    });
  });

  it('getCapabilities passes command and args', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue({} as any);
    await ipc.getCapabilities('p-1');
    expect(invoke).toHaveBeenCalledWith('get_platform_capabilities', {
      platformId: 'p-1',
    });
  });

  it('countPlatformEntries passes command with projectPath', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue({} as any);
    await ipc.countPlatformEntries('p-1', '/some/path');
    expect(invoke).toHaveBeenCalledWith('count_platform_entries', {
      platformId: 'p-1',
      projectPath: '/some/path',
    });
  });

  it('countPlatformEntries passes null for undefined projectPath', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue({} as any);
    await ipc.countPlatformEntries('p-1');
    expect(invoke).toHaveBeenCalledWith('count_platform_entries', {
      platformId: 'p-1',
      projectPath: null,
    });
  });
});

describe('ipc — Import', () => {
  it('scanForImport passes command', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue({
      platforms: [],
      total_new_skills: 0,
      total_new_rules: 0,
      total_existing_skills: 0,
      total_existing_rules: 0,
    } as any);
    await ipc.scanForImport();
    expect(invoke).toHaveBeenCalledWith('scan_for_import');
  });

  it('importScanned passes command and args', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue({ imported_skills: 1, imported_rules: 0 } as any);
    const skills = [{ id: 's1', name: 'S1', source_path: '/p' }];
    const rules = [
      { id: 'r1', name: 'R1', format: 'markdown', source_path: '/p' },
    ];
    await ipc.importScanned(skills, rules);
    expect(invoke).toHaveBeenCalledWith('import_scanned', { skills, rules });
  });

  it('previewSync passes command with all args — null sceneId', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue({
      platforms: [
        {
          platform_id: 'p-1',
          platform_name: 'P1',
          skills_to_add: [],
          skills_to_update: [],
          skills_to_remove: [],
          rules_to_add: [],
          rules_to_update: [],
          rules_to_remove: [],
        },
      ],
      has_removals: false,
    } as any);
    await ipc.previewSync(
      ['sk-1'],
      ['rl-1'],
      null,
      ['p-1'],
      'global',
      'proj-1'
    );
    expect(invoke).toHaveBeenCalledWith('preview_sync', {
      skillIds: ['sk-1'],
      ruleIds: ['rl-1'],
      sceneId: null,
      platformIds: ['p-1'],
      scope: 'global',
      projectId: 'proj-1',
    });
  });

  it('previewSync passes command with non-null sceneId', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue({
      platforms: [],
      has_removals: false,
    } as any);
    await ipc.previewSync([], [], 'sc-1', ['p-1'], 'local');
    expect(invoke).toHaveBeenCalledWith('preview_sync', {
      skillIds: [],
      ruleIds: [],
      sceneId: 'sc-1',
      platformIds: ['p-1'],
      scope: 'local',
      projectId: undefined,
    });
  });
});

describe('ipc — File System', () => {
  it('listDirectoryTree passes command with maxDepth', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue([]);
    await ipc.listDirectoryTree('/root', 3);
    expect(invoke).toHaveBeenCalledWith('list_directory_tree', {
      path: '/root',
      maxDepth: 3,
    });
  });

  it('listDirectoryTree passes command without maxDepth', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue([]);
    await ipc.listDirectoryTree('/root');
    expect(invoke).toHaveBeenCalledWith('list_directory_tree', {
      path: '/root',
      maxDepth: undefined,
    });
  });

  it('readFileContent passes command and args', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue({ content: 'hello', is_text: true });
    await ipc.readFileContent('/path/to/file');
    expect(invoke).toHaveBeenCalledWith('read_file_content', {
      path: '/path/to/file',
    });
  });
});

describe('ipc — Watcher', () => {
  it('getWatcherEvents passes command', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue({ unhandled_count: 0, events: [] });
    await ipc.getWatcherEvents();
    expect(invoke).toHaveBeenCalledWith('get_watcher_events');
  });

  it('handleWatcherEvent passes command and args', async () => {
    const invoke = await mockInvoke();
    invoke.mockResolvedValue(undefined);
    await ipc.handleWatcherEvent(1, 0);
    expect(invoke).toHaveBeenCalledWith('handle_watcher_event', {
      eventId: 1,
      action: 0,
    });
  });
});

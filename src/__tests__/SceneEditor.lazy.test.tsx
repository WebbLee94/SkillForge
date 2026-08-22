import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const loadCounts = vi.hoisted(() => ({
  sceneEditorDrawer: 0,
  sceneInvalidRefsDialog: 0,
}));

const testState = vi.hoisted(() => ({
  scenes: [] as Array<{ id: string; name: string; description: string | null; updated_at: string }>,
  skills: [],
  rules: [],
  currentScene: null,
  currentSceneDetail: null,
}));

vi.mock('../domains/scenes/SceneEditorDrawer.lazy', () => {
  loadCounts.sceneEditorDrawer += 1;
  return {
    default: () => React.createElement('div', { 'data-testid': 'scene-editor-drawer' }),
  };
});

vi.mock('../domains/scenes/SceneInvalidRefsDialog.lazy', () => {
  loadCounts.sceneInvalidRefsDialog += 1;
  return {
    default: () => React.createElement('div', { 'data-testid': 'scene-invalid-refs' }),
  };
});

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../lib/ipc', () => ({
  ipc: {
    listScenes: vi.fn().mockResolvedValue([]),
    listSkills: vi.fn().mockResolvedValue([]),
    listRules: vi.fn().mockResolvedValue([]),
    listTags: vi.fn().mockResolvedValue([]),
    fetchSceneDetail: vi.fn().mockResolvedValue(undefined),
    deleteScene: vi.fn().mockResolvedValue(undefined),
    createScene: vi.fn().mockResolvedValue(undefined),
    saveSceneComposition: vi.fn().mockResolvedValue(true),
  },
}));
vi.mock('../stores/appStore', () => ({
  useAppStore: (selector: (state: typeof testState) => unknown) => selector(testState),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
    i18n: { language: 'zh-CN', changeLanguage: vi.fn() },
  }),
}));

describe('SceneEditor chunk loading', () => {
  it('does not eagerly load drawer and invalid-ref modules on initial render', async () => {
    vi.resetModules();
    loadCounts.sceneEditorDrawer = 0;
    loadCounts.sceneInvalidRefsDialog = 0;
    testState.scenes = [];
    testState.skills = [];
    testState.rules = [];
    testState.currentScene = null;
    testState.currentSceneDetail = null;

    const { SceneEditor } = await import('../pages/SceneEditor');

    expect(loadCounts.sceneEditorDrawer).toBe(0);
    expect(loadCounts.sceneInvalidRefsDialog).toBe(0);

    render(<SceneEditor />);

    await waitFor(() => {
      expect(screen.getByText('loading')).toBeDefined();
    });

    expect(loadCounts.sceneEditorDrawer).toBe(0);
    expect(loadCounts.sceneInvalidRefsDialog).toBe(0);
  });
});

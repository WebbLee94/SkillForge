import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  act,
} from '@testing-library/react';
import { SceneEditorDrawer } from '../SceneEditorDrawer';
import { BOUNDED_STEP } from '../../lib/useBoundedReveal';
import type {
  Scene,
  SceneDetail,
  SceneSkill,
  SceneRule,
  Skill,
  Rule,
} from '../../types';

/* ===== Module-level mocks (hoisted) ===== */
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh-CN', changeLanguage: vi.fn() },
  }),
}));

/* ===== Factories ===== */
const aScene = (id: string, name: string): Scene => ({
  id,
  name,
  description: `D:${name}`,
  icon: 'package',
  is_template: false,
  is_system: false,
  created_at: '',
  updated_at: '',
});

const aSkill = (id: string, name: string): Skill => ({
  id,
  name,
  description: `D:${name}`,
  source_type: 'custom',
  source_url: null,
  current_ver: null,
  installed_at: '',
  local_path: '',
  metadata: null,
});

const aRule = (id: string, name: string): Rule => ({
  id,
  name,
  description: null,
  format: 'markdown',
  content: `# ${name}`,
  platform: 'claude-code',
  scope: 'global',
  version: 1,
  updated_at: '',
});

const aSceneSkill = (id: string, name: string, sortOrder = 0): SceneSkill => ({
  skill_id: id,
  skill_name: name,
  version: null,
  enabled: true,
  sort_order: sortOrder,
});

const aSceneRule = (id: string, name: string, sortOrder = 0): SceneRule => ({
  rule_id: id,
  rule_name: name,
  enabled: true,
  sort_order: sortOrder,
});

const aDetail = (
  scene: Scene,
  skills: SceneSkill[] = [],
  rules: SceneRule[] = []
): SceneDetail => ({ scene, skills, rules });

/* ===== Invoke seeding ===== */
async function seedInvoke(routes: Record<string, unknown>) {
  const { invoke } = await import('@tauri-apps/api/core');
  (invoke as any).mockImplementation((cmd: string) => {
    if (cmd in routes) return Promise.resolve(routes[cmd]);
    return Promise.reject(new Error(`Unexpected invoke: ${cmd}`));
  });
}

/* ===== Render helper ===== */
function renderDrawer(
  overrides: Partial<Parameters<typeof SceneEditorDrawer>[0]> = {}
) {
  const props = {
    saved: aDetail(aScene('s1', 'Scene One')),
    skills: [],
    rules: [],
    tags: [],
    onSave: vi.fn().mockResolvedValue(true),
    onClose: vi.fn(),
    ...overrides,
  };
  const utils = render(<SceneEditorDrawer {...props} />);
  return { props, utils };
}

describe('SceneEditorDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders available pool (skills tab default), current scene sections, and action bar', async () => {
    await seedInvoke({ list_tags: [] });
    renderDrawer({
      saved: aDetail(
        aScene('s1', 'Scene One'),
        [aSceneSkill('sk1', 'S1')],
        [aSceneRule('r1', 'R1')]
      ),
      skills: [aSkill('sk2', 'S2'), aSkill('sk3', 'S3')],
      rules: [aRule('r2', 'R2')],
    });

    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByText('drawer.availableSkills')).toBeDefined();
    expect(screen.getByText('sceneSkills')).toBeDefined();
    expect(screen.getByText('sceneRules')).toBeDefined();
    await waitFor(() => expect(screen.getByText('S2')).toBeDefined());
    expect(screen.getByText('S3')).toBeDefined();
    // Draft member shown in current scene, not in pool
    expect(screen.getByText('S1')).toBeDefined();
  });

  it('switches the pool tab between skills and rules', async () => {
    await seedInvoke({ list_tags: [] });
    renderDrawer({
      saved: aDetail(aScene('s1', 'Scene One')),
      skills: [aSkill('sk1', 'S1')],
      rules: [aRule('r1', 'R1')],
    });

    expect(screen.getByText('S1')).toBeDefined();
    fireEvent.click(screen.getByText('drawer.availableRules'));
    expect(screen.getByText('R1')).toBeDefined();
    expect(screen.queryByText('S1')).toBeNull();
  });

  it('filters the pool by search input', async () => {
    await seedInvoke({ list_tags: [] });
    renderDrawer({
      saved: aDetail(aScene('s1', 'Scene One')),
      skills: [aSkill('sk1', 'React Skill'), aSkill('sk2', 'Vue Skill')],
    });

    fireEvent.change(
      screen.getByPlaceholderText('drawer.poolSearchPlaceholder'),
      {
        target: { value: 'React' },
      }
    );
    expect(screen.getByText('React Skill')).toBeDefined();
    expect(screen.queryByText('Vue Skill')).toBeNull();
  });

  it('batch adds selected pool items into the current scene draft', async () => {
    await seedInvoke({ list_tags: [] });
    renderDrawer({
      saved: aDetail(aScene('s1', 'Scene One')),
      skills: [aSkill('sk1', 'S1'), aSkill('sk2', 'S2'), aSkill('sk3', 'S3')],
    });

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBe(3);
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[2]);
    fireEvent.click(screen.getByText('drawer.addSelected'));

    // Moved into current scene section
    const currentSection = screen.getByTestId('drawer-current-skills');
    expect(within(currentSection).getByText('S1')).toBeDefined();
    expect(within(currentSection).getByText('S3')).toBeDefined();
    // Removed from pool
    expect(screen.getAllByTestId('pool-item').length).toBe(1);
  });

  it('reorders current scene members with move up / move down buttons', async () => {
    await seedInvoke({ list_tags: [] });
    renderDrawer({
      saved: aDetail(aScene('s1', 'Scene One'), [
        aSceneSkill('sk1', 'S1', 0),
        aSceneSkill('sk2', 'S2', 1),
      ]),
    });

    const members = () => screen.getAllByTestId('scene-member');
    expect(within(members()[0]).getByText('S1')).toBeDefined();
    expect(within(members()[1]).getByText('S2')).toBeDefined();

    // Move S2 up
    const downButtons = screen.getAllByTitle('drawer.moveUp');
    fireEvent.click(downButtons[1]);
    expect(within(members()[0]).getByText('S2')).toBeDefined();
    expect(within(members()[1]).getByText('S1')).toBeDefined();

    // Move S2 back down
    const upButtons = screen.getAllByTitle('drawer.moveDown');
    fireEvent.click(upButtons[0]);
    expect(within(members()[0]).getByText('S1')).toBeDefined();
    expect(within(members()[1]).getByText('S2')).toBeDefined();
  });

  it('remove moves a member back to the available pool', async () => {
    await seedInvoke({ list_tags: [] });
    renderDrawer({
      saved: aDetail(aScene('s1', 'Scene One'), [aSceneSkill('sk1', 'S1')]),
      skills: [aSkill('sk1', 'S1'), aSkill('sk2', 'S2')],
    });

    fireEvent.click(screen.getByTitle('drawer.remove'));
    const currentSection = screen.getByTestId('drawer-current-skills');
    expect(within(currentSection).queryByText('S1')).toBeNull();
    // S1 is back in the available pool
    expect(
      within(screen.getByTestId('drawer-pool')).getByText('S1')
    ).toBeDefined();
    expect(screen.getAllByTestId('pool-item').length).toBe(2);
  });

  it('shows a changed-state summary after edits', async () => {
    await seedInvoke({ list_tags: [] });
    renderDrawer({
      saved: aDetail(
        aScene('s1', 'Scene One'),
        [aSceneSkill('sk1', 'S1')],
        [aSceneRule('r1', 'R1')]
      ),
      skills: [aSkill('sk2', 'S2')],
      rules: [aRule('r2', 'R2')],
    });

    const summary = screen.getByTestId('drawer-summary');
    // No changes yet
    expect(within(summary).getByText('drawer.summaryEmpty')).toBeDefined();

    // Add a skill, remove the rule
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByText('drawer.addSelected'));
    const rulesSection = screen.getByTestId('drawer-current-rules');
    fireEvent.click(within(rulesSection).getByTitle('drawer.remove'));

    expect(
      within(summary).getByText('drawer.summaryAddedSkills')
    ).toBeDefined();
    expect(
      within(summary).getByText('drawer.summaryRemovedRules')
    ).toBeDefined();
  });

  it('成员行可切换启用/禁用，保存 draft 携带 enabled', async () => {
    await seedInvoke({ list_tags: [] });
    const { props } = renderDrawer({
      saved: aDetail(
        aScene('s1', 'Scene One'),
        [aSceneSkill('sk1', 'S1')],
        [aSceneRule('r1', 'R1')]
      ),
    });

    const toggles = screen.getAllByTestId('scene-member-toggle');
    expect(toggles.length).toBe(2);
    fireEvent.click(toggles[0]); // 切换为禁用
    fireEvent.click(screen.getByRole('button', { name: 'actions.save' }));

    await waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(1));
    expect(props.onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        skills: expect.arrayContaining([
          expect.objectContaining({ skill_id: 'sk1', enabled: false }),
        ]),
        rules: expect.arrayContaining([
          expect.objectContaining({ rule_id: 'r1', enabled: true }),
        ]),
      })
    );
  });

  it('切换成员启用状态后视为脏状态：取消触发未保存弹窗', async () => {
    await seedInvoke({ list_tags: [] });
    const { props } = renderDrawer({
      saved: aDetail(aScene('s1', 'Scene One'), [aSceneSkill('sk1', 'S1')]),
    });

    fireEvent.click(screen.getAllByTestId('scene-member-toggle')[0]);
    fireEvent.click(screen.getByText('actions.cancel'));

    expect(screen.getByText('drawer.unsavedTitle')).toBeDefined();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('save calls onSave with the draft and closes on success', async () => {
    await seedInvoke({ list_tags: [] });
    const { props } = renderDrawer({
      saved: aDetail(
        aScene('s1', 'Scene One'),
        [aSceneSkill('sk1', 'S1')],
        [aSceneRule('r1', 'R1')]
      ),
      skills: [aSkill('sk2', 'S2')],
      rules: [aRule('r2', 'R2')],
    });

    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByText('drawer.addSelected'));

    fireEvent.click(screen.getByText('actions.save'));
    await waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(1));
    expect(props.onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Scene One',
        skills: [
          { skill_id: 'sk1', enabled: true },
          { skill_id: 'sk2', enabled: true },
        ],
        rules: [{ rule_id: 'r1', enabled: true }],
      })
    );
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when save fails', async () => {
    await seedInvoke({ list_tags: [] });
    const { props } = renderDrawer({
      saved: aDetail(aScene('s1', 'Scene One')),
      onSave: vi.fn().mockResolvedValue(false),
    });

    fireEvent.click(screen.getByText('actions.save'));
    await waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(1));
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('shows a failed-save alert and keeps the drawer open when save fails', async () => {
    await seedInvoke({ list_tags: [] });
    const { props } = renderDrawer({
      saved: aDetail(aScene('s1', 'Scene One')),
      onSave: vi.fn().mockResolvedValue(false),
    });

    fireEvent.click(screen.getByText('actions.save'));
    await waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(1));

    expect(props.onClose).not.toHaveBeenCalled();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('drawer.saveFailed');
  });

  it('clears the prior failure alert while a retry is in flight', async () => {
    await seedInvoke({ list_tags: [] });
    let resolveSecond!: (v: boolean) => void;
    const onSave = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((res) => {
            resolveSecond = res;
          })
      );
    const { props } = renderDrawer({
      saved: aDetail(aScene('s1', 'Scene One')),
      onSave,
    });

    fireEvent.click(screen.getByText('actions.save'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());

    fireEvent.click(screen.getByText('actions.save'));
    expect(screen.queryByRole('alert')).toBeNull();

    resolveSecond(true);
    await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1));
  });

  it('cancel with dirty changes shows the unsaved dialog; discard closes the drawer', async () => {
    await seedInvoke({ list_tags: [] });
    const { props } = renderDrawer({
      saved: aDetail(aScene('s1', 'Scene One')),
      skills: [aSkill('sk1', 'S1')],
    });

    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByText('drawer.addSelected'));

    fireEvent.click(screen.getByText('actions.cancel'));
    expect(screen.getByText('drawer.unsavedTitle')).toBeDefined();
    expect(props.onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('drawer.unsavedDiscard'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('unsaved dialog stay keeps the drawer open', async () => {
    await seedInvoke({ list_tags: [] });
    const { props } = renderDrawer({
      saved: aDetail(aScene('s1', 'Scene One')),
      skills: [aSkill('sk1', 'S1')],
    });

    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByText('drawer.addSelected'));
    fireEvent.click(screen.getByText('actions.cancel'));
    fireEvent.click(screen.getByText('drawer.unsavedStay'));

    expect(screen.queryByText('drawer.unsavedTitle')).toBeNull();
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('unsaved dialog save persists and closes', async () => {
    await seedInvoke({ list_tags: [] });
    const { props } = renderDrawer({
      saved: aDetail(aScene('s1', 'Scene One')),
      skills: [aSkill('sk1', 'S1')],
    });

    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByText('drawer.addSelected'));
    fireEvent.click(screen.getByText('actions.cancel'));
    fireEvent.click(screen.getByText('drawer.unsavedSave'));

    await waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(1));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape closes the drawer when clean', async () => {
    await seedInvoke({ list_tags: [] });
    const { props } = renderDrawer({
      saved: aDetail(aScene('s1', 'Scene One')),
    });

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape with dirty changes shows the unsaved dialog instead of closing', async () => {
    await seedInvoke({ list_tags: [] });
    const { props } = renderDrawer({
      saved: aDetail(aScene('s1', 'Scene One')),
      skills: [aSkill('sk1', 'S1')],
    });

    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByText('drawer.addSelected'));
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.getByText('drawer.unsavedTitle')).toBeDefined();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('focuses the dialog container on mount', async () => {
    await seedInvoke({ list_tags: [] });
    renderDrawer({ saved: aDetail(aScene('s1', 'Scene One')) });
    const dialog = screen.getByRole('dialog') as HTMLElement;
    expect(document.activeElement).toBe(dialog);
  });

  it('drawer header shows the save-scope note (只写 scenes/scene_skills/scene_rules)', async () => {
    await seedInvoke({ list_tags: [] });
    renderDrawer({ saved: aDetail(aScene('s1', 'Scene One')) });
    expect(screen.getByTestId('drawer-save-scope-note').textContent).toBe(
      'drawer.saveScopeNote'
    );
  });

  it('配置内容为右侧抽屉 + 半透明遮罩（不覆盖整个窗口为不透明层）', async () => {
    await seedInvoke({ list_tags: [] });
    renderDrawer({ saved: aDetail(aScene('s1', 'Scene One')) });

    const drawer = screen.getByTestId('scene-drawer');
    expect(drawer.className).toContain('fixed');
    expect(drawer.className).toContain('right-0');
    expect(drawer.className).toContain('w-[min(920px,96vw)]');
    expect(drawer.className).toContain('transition-transform');

    const overlay = screen.getByTestId('scene-drawer-overlay');
    expect(overlay.className).toContain('bg-black/40');
    expect(overlay.className).not.toContain('bg-background');
  });

  it('抽屉初始处于右侧外（translate-x-full/closed），两帧后过渡到稳定态（translate-x-0/open）', async () => {
    vi.useFakeTimers();
    try {
      await seedInvoke({ list_tags: [] });
      renderDrawer({ saved: aDetail(aScene('s1', 'Scene One')) });

      const drawer = screen.getByTestId('scene-drawer');
      expect(drawer.className).toContain('translate-x-full');
      expect(drawer.className).not.toContain('translate-x-0');
      expect(drawer).toHaveAttribute('data-state', 'closed');

      act(() => {
        vi.advanceTimersByTime(40);
      });

      expect(drawer.className).toContain('translate-x-0');
      expect(drawer.className).not.toContain('translate-x-full');
      expect(drawer).toHaveAttribute('data-state', 'open');
      expect(drawer.className).toContain('transition-transform');
      expect(drawer.className).toContain('duration-200');
    } finally {
      vi.useRealTimers();
    }
  });

  it('未保存弹层位于 wrapper 层级，不在带 transform 的抽屉面板内（保持全视口 fixed 几何）', async () => {
    await seedInvoke({ list_tags: [] });
    renderDrawer({
      saved: aDetail(aScene('s1', 'Scene One')),
      skills: [aSkill('sk1', 'S1')],
    });

    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByText('drawer.addSelected'));
    fireEvent.click(screen.getByText('actions.cancel'));

    const unsavedDialog = screen
      .getByText('drawer.unsavedTitle')
      .closest('[role="dialog"]') as HTMLElement;
    const drawer = screen.getByTestId('scene-drawer');
    expect(unsavedDialog).not.toBeNull();
    expect(drawer.contains(unsavedDialog)).toBe(false);
  });
});

describe('SceneEditorDrawer — A16 有界渲染（可用资源池）', () => {
  const manySkills = (n: number): Skill[] =>
    Array.from({ length: n }, (_, i) => aSkill(`sk${i}`, `Pool Skill ${i}`));

  it('renders only a bounded subset of a large skill pool', async () => {
    await seedInvoke({ list_tags: [] });
    renderDrawer({ saved: aDetail(aScene('s1', 'Scene One')), skills: manySkills(120) });
    expect(screen.getAllByTestId('pool-item').length).toBe(BOUNDED_STEP);
    expect(screen.getByText('Pool Skill 0')).toBeDefined();
    expect(screen.queryByText(`Pool Skill ${BOUNDED_STEP}`)).toBeNull();
  });

  it('pool show-more reveals the next bounded batch until exhausted', async () => {
    await seedInvoke({ list_tags: [] });
    renderDrawer({ saved: aDetail(aScene('s1', 'Scene One')), skills: manySkills(120) });
    fireEvent.click(screen.getByTestId('show-more'));
    expect(screen.getAllByTestId('pool-item').length).toBe(BOUNDED_STEP * 2);
    expect(screen.getByText(`Pool Skill ${BOUNDED_STEP}`)).toBeDefined();
    fireEvent.click(screen.getByTestId('show-more'));
    expect(screen.getAllByTestId('pool-item').length).toBe(120);
    expect(screen.getByText('Pool Skill 119')).toBeDefined();
    expect(screen.queryByTestId('show-more')).toBeNull();
  });

  it('selection and batch add still work on the bounded pool', async () => {
    await seedInvoke({ list_tags: [] });
    renderDrawer({ saved: aDetail(aScene('s1', 'Scene One')), skills: manySkills(120) });
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBe(BOUNDED_STEP);
    fireEvent.click(checkboxes[0]);
    fireEvent.click(screen.getByText('drawer.addSelected'));
    const currentSection = screen.getByTestId('drawer-current-skills');
    expect(within(currentSection).getByText('Pool Skill 0')).toBeDefined();
  });

  it('small pools render in full with no show-more button', async () => {
    await seedInvoke({ list_tags: [] });
    renderDrawer({ saved: aDetail(aScene('s1', 'Scene One')), skills: manySkills(3) });
    expect(screen.getAllByTestId('pool-item').length).toBe(3);
    expect(screen.queryByTestId('show-more')).toBeNull();
  });
});

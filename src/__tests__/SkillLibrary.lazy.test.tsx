import { describe, it, expect } from 'vitest';

describe('SkillLibrary lazy wrappers', () => {
  it('exports lazy wrapper modules for dialog-heavy subcomponents', async () => {
    const [{ default: TagManagerDialog }, { default: BatchTagDialog }] =
      await Promise.all([
        import('../domains/tags/TagManagerDialog.lazy'),
        import('../domains/tags/BatchTagDialog.lazy'),
      ]);

    expect(TagManagerDialog).toBeDefined();
    expect(BatchTagDialog).toBeDefined();
  });
});

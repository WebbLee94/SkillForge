import { describe, it, expect } from 'vitest';

describe('Settings lazy wrappers', () => {
  it('exports the platforms panel lazy wrapper', async () => {
    const { default: PlatformsPanel } =
      await import('../domains/settings/PlatformsPanel.lazy');

    expect(PlatformsPanel).toBeDefined();
  });
});

import { describe, it, expect } from 'vitest';

describe('Dashboard lazy wrappers', () => {
  it('exports the import preview dialog lazy wrapper', async () => {
    const { default: ImportPreviewDialog } =
      await import('../domains/resources/ImportPreviewDialog.lazy');

    expect(ImportPreviewDialog).toBeDefined();
  });
});

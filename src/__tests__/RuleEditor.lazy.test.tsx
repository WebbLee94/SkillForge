import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

const loadCounts = vi.hoisted(() => ({
  rulePreviewPanel: 0,
}));

vi.mock('../components/RulePreviewPanel', () => {
  loadCounts.rulePreviewPanel += 1;
  return {
    RulePreviewPanel: () => React.createElement('div', null, 'Preview'),
  };
});

describe('RuleEditor preview panel loading', () => {
  it('does not eagerly load the preview panel when rendering in edit mode', async () => {
    vi.resetModules();
    loadCounts.rulePreviewPanel = 0;

    const { RuleEditor } = await import('../domains/rules/RuleEditor');

    expect(loadCounts.rulePreviewPanel).toBe(0);

    render(
      <RuleEditor
        content="title: test"
        onChange={vi.fn()}
        format="mdc"
        defaultViewMode="edit"
      />
    );

    expect(loadCounts.rulePreviewPanel).toBe(0);
  });
});

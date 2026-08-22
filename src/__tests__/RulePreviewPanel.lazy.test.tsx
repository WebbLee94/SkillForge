import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';

const loadCounts = vi.hoisted(() => ({
  markdownRenderer: 0,
}));

vi.mock('../components/RuleMarkdownRenderer.lazy', () => {
  loadCounts.markdownRenderer += 1;
  return {
    default: () => React.createElement('div', null, 'Markdown'),
  };
});

describe('RulePreviewPanel markdown loading', () => {
  it('does not eagerly load the markdown renderer for markdown content', async () => {
    vi.resetModules();
    loadCounts.markdownRenderer = 0;

    const { RulePreviewPanel } = await import('../components/RulePreviewPanel');

    expect(loadCounts.markdownRenderer).toBe(0);

    render(<RulePreviewPanel content="# title" format="mdc" />);

    await waitFor(() => {
      expect(loadCounts.markdownRenderer).toBe(1);
    });
  });
});

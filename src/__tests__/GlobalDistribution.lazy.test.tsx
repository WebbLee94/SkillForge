import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const loadCounts = vi.hoisted(() => ({
  distributionWorkspace: 0,
}));

vi.mock('../domains/distribution/DistributionWorkspace.lazy', () => {
  loadCounts.distributionWorkspace += 1;
  return {
    default: () => React.createElement('div', { 'data-testid': 'workspace' }),
  };
});

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty' },
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh-CN', changeLanguage: vi.fn() },
  }),
}));

describe('GlobalDistribution chunk loading', () => {
  it('does not eagerly load the distribution workspace module on render', async () => {
    vi.resetModules();
    loadCounts.distributionWorkspace = 0;

    const { GlobalDistribution } = await import('../pages/GlobalDistribution');

    expect(loadCounts.distributionWorkspace).toBe(0);

    render(<GlobalDistribution />);

    await waitFor(() => {
      expect(screen.getByText('globalTitle')).toBeDefined();
    });

    await waitFor(() => {
      expect(loadCounts.distributionWorkspace).toBe(1);
    });
  });
});

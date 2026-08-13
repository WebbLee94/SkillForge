import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WelcomeGuideCard } from '../WelcomeGuideCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('WelcomeGuideCard', () => {
  it('欢迎引导卡承载多层信息，使用 p-5（20px）内边距而非 p-4', () => {
    render(<WelcomeGuideCard onDismiss={() => {}} onNavigate={() => {}} />);
    const card = screen.getByTestId('welcome-guide-card');
    expect(card).toHaveClass('p-5');
    expect(card).not.toHaveClass('p-4');
  });
});

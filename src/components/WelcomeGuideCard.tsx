import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';

interface WelcomeGuideCardProps {
  onDismiss: () => void;
  onNavigate: (nav: string) => void;
}

type StepState = 'done' | 'current' | 'pending';

interface Step {
  navKey: string;
  titleKey: string;
  descKey: string;
  state: StepState;
}

/**
 * 首次引导卡：欢迎标题 + 原型圆点/连接线 3 步 stepper
 * （一键导入 ✓ → 可选组合 Scene → 进入分发工作区）。
 */
export function WelcomeGuideCard({
  onDismiss,
  onNavigate,
}: WelcomeGuideCardProps) {
  const { t } = useTranslation('common');

  const steps: Step[] = [
    {
      navKey: 'skills',
      titleKey: 'dashboard.welcome.step1Title',
      descKey: 'dashboard.welcome.step1Desc',
      state: 'done',
    },
    {
      navKey: 'scenes',
      titleKey: 'dashboard.welcome.step2Title',
      descKey: 'dashboard.welcome.step2Desc',
      state: 'current',
    },
    {
      navKey: 'globalDistribution',
      titleKey: 'dashboard.welcome.step3Title',
      descKey: 'dashboard.welcome.step3Desc',
      state: 'pending',
    },
  ];

  return (
    <div
      data-testid="welcome-guide-card"
      className="mb-4 rounded-lg border border-border bg-card p-5"
    >
      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">
          {t('dashboard.welcome.title')}
        </span>
        <button
          className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          onClick={onDismiss}
        >
          {t('dashboard.welcome.dismiss')}
        </button>
      </div>
      <div className="flex">
        {steps.map((step, i) => {
          const isLast = i === steps.length - 1;
          return (
            <div
              key={step.navKey}
              className={cn('flex items-start gap-3', !isLast && 'flex-1')}
            >
              <button
                onClick={() => onNavigate(step.navKey)}
                className="group flex items-start gap-3 text-left"
              >
                <span
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                    step.state === 'done' &&
                      'border border-success bg-secondary text-success',
                    step.state === 'current' &&
                      'border-transparent bg-primary text-primary-foreground',
                    step.state === 'pending' &&
                      'border-border bg-secondary text-secondary-foreground'
                  )}
                >
                  {step.state === 'done' ? '✓' : i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground">
                    {t(step.titleKey)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t(step.descKey)}
                  </span>
                </span>
              </button>
              {!isLast && (
                <span
                  aria-hidden
                  className="mt-3 flex-1 border-t border-border"
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

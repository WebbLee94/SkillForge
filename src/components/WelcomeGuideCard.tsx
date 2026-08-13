import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';

interface WelcomeGuideCardProps {
  onDismiss: () => void;
  onNavigate: (nav: string) => void;
}

/** 首次引导卡：欢迎标题 + 3 步 stepper（一键导入 → 可选组合 Scene → 进入分发工作区）。 */
export function WelcomeGuideCard({
  onDismiss,
  onNavigate,
}: WelcomeGuideCardProps) {
  const { t } = useTranslation('common');

  const steps = [
    {
      navKey: 'skills',
      titleKey: 'dashboard.welcome.step1Title',
      descKey: 'dashboard.welcome.step1Desc',
      active: true,
    },
    {
      navKey: 'scenes',
      titleKey: 'dashboard.welcome.step2Title',
      descKey: 'dashboard.welcome.step2Desc',
      active: false,
    },
    {
      navKey: 'globalDistribution',
      titleKey: 'dashboard.welcome.step3Title',
      descKey: 'dashboard.welcome.step3Desc',
      active: false,
    },
  ];

  return (
    <div className="mb-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <Sparkles className="h-5 w-5 text-primary shrink-0" />
          <h3 className="text-sm font-semibold text-foreground">
            {t('dashboard.welcome.title')}
          </h3>
        </div>
        <button
          className="rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors"
          onClick={onDismiss}
        >
          {t('dashboard.welcome.dismiss')}
        </button>
      </div>
      <div className="flex items-center gap-3">
        {steps.map((step, i) => (
          <div key={step.navKey} className="flex flex-1 items-center gap-3">
            {i > 0 && (
              <span className="text-lg text-muted-foreground/40 shrink-0">
                →
              </span>
            )}
            <button
              onClick={() => onNavigate(step.navKey)}
              className="flex flex-1 flex-col items-center gap-1 rounded-lg border border-border bg-card px-3 py-2 text-center hover:bg-accent transition-colors"
            >
              <span
                className={
                  step.active
                    ? 'flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground'
                    : 'flex h-6 w-6 items-center justify-center rounded-full border border-border text-xs font-medium text-muted-foreground'
                }
              >
                {i + 1}
              </span>
              <span className="text-xs font-medium text-foreground">
                {t(step.titleKey)}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {t(step.descKey)}
              </span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

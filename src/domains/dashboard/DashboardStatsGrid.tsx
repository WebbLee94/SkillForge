import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

type DashboardStatCard = {
  label: string;
  value: string | number;
  subtitle: string;
  icon: ReactNode;
  color: string;
  bgColor: string;
  navKey: string;
};

interface DashboardStatsGridProps {
  cards: readonly DashboardStatCard[];
  onNavigate: (navKey: string) => void;
}

export function DashboardStatsGrid({ cards, onNavigate }: DashboardStatsGridProps) {
  return (
    <div
      data-testid="dashboard-stats-grid"
      className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2 md:min-[1180px]:grid-cols-4"
    >
      {cards.map((card) => (
        <button
          key={card.navKey}
          className={cn(
            'flex h-auto items-center gap-4 rounded-lg border border-border bg-card p-4',
            'text-left transition-shadow hover:shadow-md'
          )}
          onClick={() => onNavigate(card.navKey)}
        >
          <div
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-lg',
              card.bgColor,
              card.color
            )}
          >
            {card.icon}
          </div>
          <div>
            <div className="text-sm text-muted-foreground">{card.label}</div>
            <div className="text-2xl font-bold text-foreground">{card.value}</div>
            <div className="text-xs text-muted-foreground">{card.subtitle}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

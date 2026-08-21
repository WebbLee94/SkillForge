import { cn } from '../../lib/utils';
import type { ComponentType } from 'react';

interface PlatformButtonProps {
  name: string;
  icon: ComponentType<{ className?: string }>;
  skillCount: number;
  ruleCount: number;
  isInstalled: boolean;
  isSelected?: boolean;
  onClick: () => void;
}

export function PlatformButton({
  name,
  icon: Icon,
  skillCount,
  ruleCount,
  isInstalled,
  isSelected = false,
  onClick,
}: PlatformButtonProps) {
  return (
    <button
      onClick={onClick}
      title={`${name}: ${skillCount} 技能 / ${ruleCount} 规则`}
      className={cn(
        'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
        isSelected
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border bg-card text-foreground hover:border-primary/50 hover:bg-accent/50'
      )}
    >
      <span
        className={cn(
          'h-2 w-2 rounded-full shrink-0',
          isInstalled ? 'bg-green-500' : 'bg-muted-foreground/30'
        )}
      />
      {Icon && <Icon className="h-5 w-5 shrink-0" />}
      <span className="font-medium">{name}</span>
      <span className="text-xs text-muted-foreground">
        {skillCount}<span className="mx-0.5 opacity-40">/</span>{ruleCount}
      </span>
    </button>
  );
}

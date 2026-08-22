import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import type { SceneSkill } from '../../types';
import { GripVertical, X, ToggleLeft, ToggleRight } from 'lucide-react';

interface SortableSkillListProps {
  skills: SceneSkill[];
  onRemove: (skillId: string) => void;
  onToggle: (skillId: string) => void;
  disabled?: boolean;
}

export const SortableSkillList = memo(function SortableSkillList({
  skills,
  onRemove,
  onToggle,
  disabled = false,
}: SortableSkillListProps) {
  const { t } = useTranslation('scenes');

  if (skills.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        {t('dragHint')}
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {skills.map((skill, index) => (
        <div
          key={skill.skill_id}
          className={cn(
            'flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors',
            skill.enabled
              ? 'border-border bg-card'
              : 'border-border bg-muted/30 opacity-60'
          )}
          draggable={!disabled}
          onDragStart={(e) => {
            if (disabled) return;
            e.dataTransfer.setData('text/plain', index.toString());
            e.dataTransfer.effectAllowed = 'move';
          }}
        >
          <GripVertical
            className={cn(
              'h-4 w-4 shrink-0 text-muted-foreground',
              disabled ? 'cursor-not-allowed opacity-30' : 'cursor-grab'
            )}
          />
          <span className="flex-1 text-sm text-foreground truncate">
            {skill.skill_name || skill.skill_id}
          </span>
          {skill.version && (
            <span className="text-xs text-muted-foreground">
              v{skill.version}
            </span>
          )}
          <button
            className={cn(
              'shrink-0 transition-colors',
              disabled
                ? 'cursor-not-allowed opacity-30'
                : 'text-muted-foreground hover:text-primary'
            )}
            onClick={() => !disabled && onToggle(skill.skill_id)}
            title={skill.enabled ? t('disable', '禁用') : t('enable', '启用')}
          >
            {skill.enabled ? (
              <ToggleRight className="h-4 w-4 text-primary" />
            ) : (
              <ToggleLeft className="h-4 w-4" />
            )}
          </button>
          {!disabled && (
            <button
              className="shrink-0 text-muted-foreground hover:text-error transition-colors"
              onClick={() => onRemove(skill.skill_id)}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
});

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../../lib/utils';
import { TagChip } from './TagChip';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { Tag } from '../../../types';

const COLLAPSE_THRESHOLD = 4;

interface TagFilterBarProps {
  tags: Tag[];
  selectedTagIds: number[];
  onToggleTag: (tagId: number) => void;
  onClearAll: () => void;
  showUntagged?: boolean;
  untaggedFilter?: boolean;
  onToggleUntagged?: () => void;
}

export function TagFilterBar({
  tags,
  selectedTagIds,
  onToggleTag,
  onClearAll,
  showUntagged = true,
  untaggedFilter,
  onToggleUntagged,
}: TagFilterBarProps) {
  const hasSelection = selectedTagIds.length > 0 || !!untaggedFilter;
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation('common');

  // Sort tags by count descending
  const sortedTags = [...tags].sort((a, b) => (b.count || 0) - (a.count || 0));
  const needsCollapse = sortedTags.length > COLLAPSE_THRESHOLD;
  const visibleTags =
    needsCollapse && !expanded
      ? sortedTags.slice(0, COLLAPSE_THRESHOLD)
      : sortedTags;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {/* "All" chip */}
      <button
        className={cn(
          'shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
          !hasSelection
            ? 'bg-primary text-primary-foreground'
            : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
        )}
        onClick={onClearAll}
      >
        {t('tag.allTags')}
      </button>

      {/* Tag chips */}
      {visibleTags.map((tag) => {
        const isSelected = selectedTagIds.includes(tag.id);
        return (
          <TagChip
            key={tag.id}
            tag={tag}
            selected={isSelected}
            onClick={() => onToggleTag(tag.id)}
            size="sm"
          />
        );
      })}

      {/* "Untagged" chip */}
      {showUntagged && onToggleUntagged && (
        <button
          className={cn(
            'shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-colors border border-dashed',
            untaggedFilter
              ? 'bg-primary text-primary-foreground border-primary'
              : 'border-muted-foreground/40 text-muted-foreground hover:bg-secondary'
          )}
          onClick={onToggleUntagged}
        >
          {t('tag.untagged')}
        </button>
      )}

      {/* Expand / Collapse toggle */}
      {needsCollapse && (
        <button
          className="shrink-0 rounded-full px-2 py-1 text-xs text-muted-foreground hover:bg-secondary transition-colors flex items-center gap-0.5"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <>
              {t('tag.collapse')} <ChevronUp className="h-3 w-3" />
            </>
          ) : (
            <>
              +{sortedTags.length - COLLAPSE_THRESHOLD}{' '}
              <ChevronDown className="h-3 w-3" />
            </>
          )}
        </button>
      )}
    </div>
  );
}

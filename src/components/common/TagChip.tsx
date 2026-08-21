import { memo } from 'react';
import { cn } from '../../lib/utils';
import type { Tag } from '../../types';

interface TagChipProps {
  tag: Tag;
  selected?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
  removeLabel?: string;
  size?: 'sm' | 'md';
}

const pillClassName = (size: 'sm' | 'md', selected?: boolean) =>
  cn(
    'inline-flex items-center gap-1.5 rounded-full font-medium transition-all',
    size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm',
    selected ? 'ring-2 ring-primary ring-offset-1' : 'hover:shadow-sm'
  );

export const TagChip = memo(function TagChip({
  tag,
  selected,
  onClick,
  onRemove,
  removeLabel,
  size = 'md',
}: TagChipProps) {
  const colorStyle = tag.color
    ? { backgroundColor: tag.color + '20', color: tag.color }
    : undefined;
  const dotStyle = tag.color ? { backgroundColor: tag.color } : undefined;

  return onRemove ? (
    <span className={pillClassName(size, selected)} style={colorStyle}>
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-full"
        onClick={onClick}
      >
        <span className="h-2 w-2 rounded-full" style={dotStyle} />
        <span>{tag.name}</span>
        {tag.count !== undefined && (
          <span className="opacity-60 text-xs">{tag.count}</span>
        )}
      </button>
      <button
        type="button"
        aria-label={removeLabel}
        title={removeLabel}
        className="ml-0.5 opacity-60 hover:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        &times;
      </button>
    </span>
  ) : (
    <button
      className={pillClassName(size, selected)}
      style={colorStyle}
      onClick={onClick}
    >
      <span className="h-2 w-2 rounded-full" style={dotStyle} />
      <span>{tag.name}</span>
      {tag.count !== undefined && (
        <span className="opacity-60 text-xs">{tag.count}</span>
      )}
    </button>
  );
});

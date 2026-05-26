import { cn } from "../lib/utils";
import { TagChip } from "./TagChip";
import type { Tag } from "../types";

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

  // Sort tags by count descending
  const sortedTags = [...tags].sort((a, b) => (b.count || 0) - (a.count || 0));

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
      {/* "All" chip */}
      <button
        className={cn(
          "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
          !hasSelection
            ? "bg-primary text-primary-foreground"
            : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        )}
        onClick={onClearAll}
      >
        全部
      </button>

      {/* Tag chips */}
      {sortedTags.map((tag) => {
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
            "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-colors border border-dashed",
            untaggedFilter
              ? "bg-primary text-primary-foreground border-primary"
              : "border-muted-foreground/40 text-muted-foreground hover:bg-secondary",
          )}
          onClick={onToggleUntagged}
        >
          未分类
        </button>
      )}
    </div>
  );
}

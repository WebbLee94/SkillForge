import { memo } from "react";
import { cn } from "../lib/utils";
import type { Tag } from "../types";

interface TagChipProps {
  tag: Tag;
  selected?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
  size?: "sm" | "md";
}

export const TagChip = memo(function TagChip({ tag, selected, onClick, onRemove, size = "md" }: TagChipProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-medium transition-all",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm",
        selected
          ? "ring-2 ring-primary ring-offset-1"
          : "hover:shadow-sm",
      )}
      style={tag.color ? {
        backgroundColor: tag.color + "20",
        color: tag.color,
      } : undefined}
      onClick={onClick}
    >
      <span className="h-2 w-2 rounded-full" style={tag.color ? { backgroundColor: tag.color } : undefined} />
      <span>{tag.name}</span>
      {(tag.skill_count !== undefined || tag.rule_count !== undefined) && (
        <span className="opacity-60 text-xs">
          {(tag.skill_count || 0) + (tag.rule_count || 0)}
        </span>
      )}
      {onRemove && (
        <span
          className="ml-0.5 opacity-60 hover:opacity-100"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
        >
          &times;
        </span>
      )}
    </button>
  );
});

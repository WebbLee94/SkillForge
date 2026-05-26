import { useState, useRef, useEffect } from "react";
import { cn } from "../lib/utils";
import { X, Plus } from "lucide-react";
import type { Tag } from "../types";

interface InlineTagEditorProps {
  targetType: "skill" | "rule";
  targetId: string;
  tags: Tag[];
  allTags: Tag[];
  onAssign: (tagId: number) => void;
  onRemove: (tagId: number) => void;
}

export function InlineTagEditor({
  tags,
  allTags,
  onAssign,
  onRemove,
}: InlineTagEditorProps) {
  const [showPicker, setShowPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  const assignedIds = new Set(tags.map((t) => t.id));
  const availableTags = allTags.filter((t) => !assignedIds.has(t.id));

  // Close picker on outside click
  useEffect(() => {
    if (!showPicker) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showPicker]);

  return (
    <div className="flex flex-wrap items-center gap-1">
      {tags.map((tag) => (
        <span
          key={tag.id}
          className={cn(
            "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium",
          )}
          style={tag.color ? { backgroundColor: tag.color + "20", color: tag.color } : { backgroundColor: "hsl(var(--secondary))", color: "hsl(var(--secondary-foreground))" }}
        >
          {tag.name}
          <button
            className="ml-0.5 rounded-full p-0.5 hover:bg-black/10 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(tag.id);
            }}
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}

      <div className="relative" ref={pickerRef}>
        <button
          className={cn(
            "inline-flex items-center justify-center rounded-full p-0.5",
            "text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors",
          )}
          onClick={(e) => {
            e.stopPropagation();
            setShowPicker(!showPicker);
          }}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>

        {showPicker && (
          <div className="absolute left-0 top-full z-30 mt-1 min-w-[140px] max-h-[200px] overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
            {availableTags.length > 0 ? (
              availableTags.map((tag) => (
                <button
                  key={tag.id}
                  className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent transition-colors flex items-center gap-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAssign(tag.id);
                    setShowPicker(false);
                  }}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={tag.color ? { backgroundColor: tag.color } : { backgroundColor: "hsl(var(--muted-foreground))" }}
                  />
                  <span className="text-popover-foreground">{tag.name}</span>
                </button>
              ))
            ) : (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">无可用标签</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

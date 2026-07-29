import { useState, useRef, useEffect } from 'react';
import { cn } from '../lib/utils';
import { Plus, Search, Check } from 'lucide-react';
import type { Tag } from '../types';

const PRESET_COLORS = [
  '#3B82F6',
  '#8B5CF6',
  '#EC4899',
  '#EF4444',
  '#F97316',
  '#EAB308',
  '#22C55E',
  '#14B8A6',
  '#06B6D4',
  '#6366F1',
];

interface TagPopoverProps {
  tagType: 'skill' | 'rule';
  targetId: string;
  assignedTags: Tag[];
  allTags: Tag[];
  onAssign: (tagId: number) => void;
  onRemove: (tagId: number) => void;
  onCreate: (name: string, color: string) => Promise<number | void>;
}

export function TagPopover({
  assignedTags,
  allTags,
  onAssign,
  onRemove,
  onCreate,
}: TagPopoverProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [newColor, setNewColor] = useState(
    () => PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)]
  );
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const assignedIds = new Set(assignedTags.map((t) => t.id));

  // Filter tags by search
  const filteredTags = allTags.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase())
  );

  // Check if search matches any tag exactly
  const exactMatch = allTags.some(
    (t) => t.name.toLowerCase() === search.toLowerCase()
  );
  const canCreate = search.trim().length > 0 && !exactMatch;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Auto-focus input
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  const handleCreate = async () => {
    if (!search.trim()) return;
    const newTagId = await onCreate(search.trim(), newColor);
    // Auto-assign the newly created tag
    if (typeof newTagId === 'number' && !assignedIds.has(newTagId)) {
      onAssign(newTagId);
    }
    setSearch('');
    setNewColor(
      PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)]
    );
    setOpen(false);
  };

  const handleToggle = (tagId: number) => {
    if (assignedIds.has(tagId)) {
      onRemove(tagId);
    } else {
      onAssign(tagId);
    }
  };

  return (
    <div className="relative" ref={popoverRef}>
      <button
        data-testid="tag-popover-trigger"
        className={cn(
          'inline-flex items-center justify-center rounded-full p-0.5',
          'text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors'
        )}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-[240px] rounded-lg border border-border bg-popover shadow-lg">
          {/* Search Input */}
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索或输入标签名..."
                className={cn(
                  'w-full rounded-md border border-input bg-background py-1.5 pl-7 pr-2 text-xs',
                  'placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'
                )}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canCreate) handleCreate();
                }}
              />
            </div>
          </div>

          {/* Tag List */}
          <div className="max-h-[200px] overflow-y-auto p-1">
            {filteredTags.length > 0
              ? filteredTags.map((tag) => {
                  const isAssigned = assignedIds.has(tag.id);
                  return (
                    <button
                      key={tag.id}
                      className={cn(
                        'w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent transition-colors flex items-center gap-2'
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggle(tag.id);
                      }}
                    >
                      <span
                        className={cn(
                          'h-4 w-4 rounded border flex items-center justify-center shrink-0',
                          isAssigned
                            ? 'bg-primary border-primary'
                            : 'border-border'
                        )}
                      >
                        {isAssigned && (
                          <Check className="h-2.5 w-2.5 text-primary-foreground" />
                        )}
                      </span>
                      <span
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={
                          tag.color ? { backgroundColor: tag.color } : undefined
                        }
                      />
                      <span className="text-popover-foreground flex-1 truncate">
                        {tag.name}
                      </span>
                      <span className="text-muted-foreground text-[10px]">
                        {tag.count || 0}
                      </span>
                    </button>
                  );
                })
              : search.trim().length === 0 && (
                  <p className="px-2 py-2 text-xs text-muted-foreground text-center">
                    无可用标签
                  </p>
                )}
          </div>

          {/* Create New Tag */}
          {canCreate && (
            <div className="border-t border-border p-2">
              <button
                className={cn(
                  'w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent transition-colors',
                  'flex items-center gap-2 text-primary font-medium'
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  handleCreate();
                }}
              >
                <Plus className="h-3.5 w-3.5" />
                创建 "{search.trim()}"
              </button>
              <div className="mt-2 flex flex-wrap gap-1.5 px-1">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color}
                    className={cn(
                      'h-5 w-5 rounded-md border-2 transition-all',
                      newColor === color
                        ? 'border-foreground scale-110'
                        : 'border-transparent hover:scale-105'
                    )}
                    style={{ backgroundColor: color }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setNewColor(color);
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

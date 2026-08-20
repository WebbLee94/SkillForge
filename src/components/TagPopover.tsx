import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
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
  onCreate?: (name: string, color: string) => Promise<number | void>;
  ariaLabel?: string;
}

export function TagPopover({
  assignedTags,
  allTags,
  onAssign,
  onRemove,
  onCreate,
  ariaLabel,
}: TagPopoverProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [newColor, setNewColor] = useState(
    () => PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)]
  );
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listboxId = useRef(
    `tag-popover-listbox-${Math.random().toString(36).slice(2)}`
  ).current;
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    flip: boolean;
  } | null>(null);

  // 固定宽度与间距用于视口夹紧估算；高度按搜索框 + 列表 max-h + 底部创建区估算。
  const MENU_WIDTH = 240;
  const MENU_GAP = 4;
  const EST_MENU_HEIGHT = 330;

  const assignedIds = new Set(assignedTags.map((t) => t.id));

  const filteredTags = allTags.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase())
  );

  const exactMatch = allTags.some(
    (t) => t.name.toLowerCase() === search.toLowerCase()
  );
  const canCreate = !!onCreate && search.trim().length > 0 && !exactMatch;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        popoverRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
      setSearch('');
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  useEffect(() => {
    if (open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const vw = window.innerWidth || 800;
      const vh = window.innerHeight || 600;

      let top = rect.bottom + MENU_GAP;
      let flip = false;
      if (top + EST_MENU_HEIGHT > vh) {
        top = rect.top - MENU_GAP;
        flip = true;
      }

      // 水平贴近按钮：左缘对齐按钮左缘；右侧溢出时右缘对齐按钮右缘，避免离按钮过远。
      let left = rect.left;
      if (left + MENU_WIDTH > vw - MENU_GAP) {
        left = Math.max(MENU_GAP, rect.right - MENU_WIDTH);
      }
      left = Math.max(MENU_GAP, left);

      setPosition({ top, left, flip });
    }
  }, [open]);

  // 翻转场景：按菜单实际高度二次校正，让菜单底部紧贴按钮顶部而非留有估算空隙。
  useEffect(() => {
    if (!open || !position?.flip || !menuRef.current || !triggerRef.current)
      return;
    const menuHeight = menuRef.current.getBoundingClientRect().height;
    if (!menuHeight) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const nextTop = Math.max(MENU_GAP, rect.top - menuHeight - MENU_GAP);
    if (nextTop !== position.top) {
      setPosition((prev) => (prev ? { ...prev, top: nextTop } : prev));
    }
  }, [open, position]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setSearch('');
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const handleCreate = async () => {
    if (!search.trim()) return;
    const newTagId = await onCreate?.(search.trim(), newColor);
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
        ref={triggerRef}
        data-testid="tag-popover-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
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

      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={listboxId}
            role="listbox"
            className="z-[100] w-[240px] rounded-lg border border-border bg-popover shadow-lg"
            style={
              position
                ? { position: 'fixed', top: position.top, left: position.left }
                : undefined
            }
          >
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
                            tag.color
                              ? { backgroundColor: tag.color }
                              : undefined
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
                  创建 &quot;{search.trim()}&quot;
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
          </div>,
          document.body
        )}
    </div>
  );
}

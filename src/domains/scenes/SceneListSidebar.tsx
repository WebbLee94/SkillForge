import { List, Search } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Scene } from '../../types';

type ListSort = 'recent' | 'name';

interface SceneListSidebarProps {
  readonly scenes: readonly Scene[];
  readonly currentSceneId: string | null;
  readonly listOpen: boolean;
  readonly listSearch: string;
  readonly listSort: ListSort;
  readonly searchPlaceholder: string;
  readonly sortLabel: string;
  readonly sortRecentLabel: string;
  readonly sortNameLabel: string;
  readonly drawerOpenLabel: string;
  readonly noDataLabel: string;
  readonly onSearchChange: (value: string) => void;
  readonly onSortChange: (value: ListSort) => void;
  readonly onSelectScene: (scene: Scene) => void;
  readonly onOpenList: () => void;
  readonly onCloseList: () => void;
}

export function SceneListSidebar({
  scenes,
  currentSceneId,
  listOpen,
  listSearch,
  listSort,
  searchPlaceholder,
  sortLabel,
  sortRecentLabel,
  sortNameLabel,
  drawerOpenLabel,
  noDataLabel,
  onSearchChange,
  onSortChange,
  onSelectScene,
  onOpenList,
  onCloseList,
}: SceneListSidebarProps) {
  return (
    <>
      <div
        className={cn(
          'bg-background',
          listOpen
            ? 'fixed inset-y-0 left-0 z-40 flex w-[280px] flex-col border-r border-border'
            : 'hidden w-[280px] shrink-0 flex-col border-r border-border md:flex'
        )}
      >
        <div className="mb-3 mt-5 border-b border-border px-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={listSearch}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="mb-3 mt-3 flex items-center justify-end gap-2">
            <label className="text-xs text-muted-foreground">{sortLabel}</label>
            <select
              value={listSort}
              onChange={(e) => onSortChange(e.target.value as ListSort)}
              className="rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="recent">{sortRecentLabel}</option>
              <option value="name">{sortNameLabel}</option>
            </select>
          </div>
        </div>

        <div
          className="mb-1 mt-1 min-h-0 flex-1 space-y-1 overflow-y-auto px-2"
          data-testid="scene-list"
        >
          {scenes.length === 0 && (
            <p className="py-4 text-center text-xs text-muted-foreground">
              {noDataLabel}
            </p>
          )}
          {scenes.map((scene) => (
            <button
              key={scene.id}
              data-testid="scene-list-item"
              onClick={() => {
                onSelectScene(scene);
                onCloseList();
              }}
              className={cn(
                'w-full rounded-lg border px-3 py-2 text-left transition-colors',
                currentSceneId === scene.id
                  ? 'border-primary bg-accent/40'
                  : 'border-border bg-card hover:bg-accent/40'
              )}
            >
              <span
                className="block truncate text-sm font-medium text-foreground"
                title={scene.name}
              >
                {scene.name}
              </span>
              <span className="line-clamp-2 block text-xs text-muted-foreground">
                {scene.description}
              </span>
            </button>
          ))}
        </div>
      </div>

      {listOpen && (
        <div
          data-testid="list-backdrop"
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={onCloseList}
        />
      )}

      <button
        data-testid="list-toggle"
        className="mb-3 flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-accent/40 md:hidden"
        onClick={onOpenList}
      >
        <List className="h-4 w-4" />
        {drawerOpenLabel}
      </button>
    </>
  );
}

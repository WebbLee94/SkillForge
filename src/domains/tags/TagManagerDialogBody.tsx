import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { Palette, Plus, X } from 'lucide-react';
import type { Dispatch, KeyboardEventHandler, SetStateAction } from 'react';
import { TagManagerDialogTable } from './TagManagerDialogTable';
import type { Tag } from '../../types';

interface TagManagerDialogBodyProps {
  readonly filteredTags: readonly Tag[];
  readonly searchQuery: string;
  readonly setSearchQuery: Dispatch<SetStateAction<string>>;
  readonly showCreate: boolean;
  readonly setShowCreate: Dispatch<SetStateAction<boolean>>;
  readonly newName: string;
  readonly setNewName: Dispatch<SetStateAction<string>>;
  readonly newColor: string;
  readonly setNewColor: Dispatch<SetStateAction<string>>;
  readonly editingTagId: number | null;
  readonly editName: string;
  readonly setEditName: Dispatch<SetStateAction<string>>;
  readonly colorPickerTagId: number | null;
  readonly setColorPickerTagId: Dispatch<SetStateAction<number | null>>;
  readonly editInputRef: { current: HTMLInputElement | null };
  readonly colorPickerRef: { current: HTMLDivElement | null };
  readonly title: string;
  readonly presetColors: readonly string[];
  readonly onClose: () => void;
  readonly onCreate: () => void;
  readonly onDeleteRequest: (id: number) => void;
  readonly onStartEditName: (tagId: number, currentName: string) => void;
  readonly onSaveEditName: () => void;
  readonly onEditKeyDown: KeyboardEventHandler<HTMLInputElement>;
  readonly onColorSelect: (tagId: number, color: string) => void;
}

export function TagManagerDialogBody({
  filteredTags,
  searchQuery,
  setSearchQuery,
  showCreate,
  setShowCreate,
  newName,
  setNewName,
  newColor,
  setNewColor,
  editingTagId,
  editName,
  setEditName,
  colorPickerTagId,
  setColorPickerTagId,
  editInputRef,
  colorPickerRef,
  title,
  presetColors,
  onClose,
  onCreate,
  onDeleteRequest,
  onStartEditName,
  onSaveEditName,
  onEditKeyDown,
  onColorSelect,
}: TagManagerDialogBodyProps) {
  const { t } = useTranslation('common');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="flex max-h-[80vh] w-[520px] flex-col rounded-lg border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold text-foreground">
            {t('actions.manage')}
            {title}
          </h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-border px-6 py-3">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('actions.search')}
            className={cn(
              'flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm',
              'placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'
            )}
          />
          <button
            className={cn(
              'flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5',
              'text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors'
            )}
            onClick={() => setShowCreate(true)}
          >
            <Plus className="h-4 w-4" />
            {t('actions.create')}
          </button>
        </div>

        <TagManagerDialogTable
          filteredTags={filteredTags}
          editingTagId={editingTagId}
          editName={editName}
          setEditName={setEditName}
          colorPickerTagId={colorPickerTagId}
          setColorPickerTagId={setColorPickerTagId}
          editInputRef={editInputRef}
          colorPickerRef={colorPickerRef}
          presetColors={presetColors}
          onDeleteRequest={onDeleteRequest}
          onStartEditName={onStartEditName}
          onSaveEditName={onSaveEditName}
          onEditKeyDown={onEditKeyDown}
          onColorSelect={onColorSelect}
          t={t}
        />

        {showCreate && (
          <div className="space-y-3 border-t border-border px-6 py-4">
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t('tag.namePlaceholder')}
                className={cn(
                  'flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm',
                  'placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'
                )}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onCreate();
                }}
              />
              <button
                className="rounded-lg bg-secondary px-3 py-1.5 text-sm text-secondary-foreground hover:bg-secondary/80"
                onClick={() => {
                  setShowCreate(false);
                  setNewName('');
                }}
              >
                {t('actions.cancel')}
              </button>
              <button
                className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                onClick={onCreate}
              >
                {t('actions.save')}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <Palette className="h-4 w-4 text-muted-foreground" />
              {presetColors.map((color) => (
                <button
                  key={color}
                  className={cn(
                    'h-6 w-6 rounded-md border-2 transition-all',
                    newColor === color
                      ? 'border-foreground scale-110'
                      : 'border-transparent hover:scale-105'
                  )}
                  style={{ backgroundColor: color }}
                  onClick={() => setNewColor(color)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

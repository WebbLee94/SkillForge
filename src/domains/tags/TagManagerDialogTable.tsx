import { cn } from '../../lib/utils';
import { Trash2 } from 'lucide-react';
import type {
  Dispatch,
  KeyboardEventHandler,
  MutableRefObject,
  SetStateAction,
} from 'react';
import type { Tag } from '../../types';

interface TagManagerDialogTableProps {
  readonly filteredTags: readonly Tag[];
  readonly editingTagId: number | null;
  readonly editName: string;
  readonly setEditName: Dispatch<SetStateAction<string>>;
  readonly colorPickerTagId: number | null;
  readonly setColorPickerTagId: Dispatch<SetStateAction<number | null>>;
  readonly editInputRef: MutableRefObject<HTMLInputElement | null>;
  readonly colorPickerRef: MutableRefObject<HTMLDivElement | null>;
  readonly presetColors: readonly string[];
  readonly onDeleteRequest: (id: number) => void;
  readonly onStartEditName: (tagId: number, currentName: string) => void;
  readonly onSaveEditName: () => void;
  readonly onEditKeyDown: KeyboardEventHandler<HTMLInputElement>;
  readonly onColorSelect: (tagId: number, color: string) => void;
  readonly t: (key: string, options?: Record<string, unknown>) => string;
}

export function TagManagerDialogTable({
  filteredTags,
  editingTagId,
  editName,
  setEditName,
  colorPickerTagId,
  setColorPickerTagId,
  editInputRef,
  colorPickerRef,
  presetColors,
  onDeleteRequest,
  onStartEditName,
  onSaveEditName,
  onEditKeyDown,
  onColorSelect,
  t,
}: TagManagerDialogTableProps) {
  return (
    <div className="flex-1 overflow-y-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            <th className="w-32 px-4 py-2 text-left font-medium text-muted-foreground">
              {t('tag.color')}
            </th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">
              {t('tag.name')}
            </th>
            <th className="w-20 px-4 py-2 text-left font-medium text-muted-foreground">
              {t('tag.associatedCount')}
            </th>
            <th className="w-16 px-4 py-2 text-right font-medium text-muted-foreground">
              {t('actions.delete')}
            </th>
          </tr>
        </thead>
        <tbody>
          {filteredTags.map((tag) => (
            <tr
              key={tag.id}
              className="group border-b border-border last:border-0"
            >
              <td className="px-4 py-2">
                <div className="relative">
                  <button
                    data-color-btn={tag.id}
                    className="h-5 w-5 shrink-0 rounded-full border border-white/30 transition-transform hover:scale-125"
                    style={{ backgroundColor: tag.color || '#888' }}
                    onClick={() =>
                      setColorPickerTagId(
                        colorPickerTagId === tag.id ? null : tag.id
                      )
                    }
                    title={t('tag.selectColor')}
                  />
                  {colorPickerTagId === tag.id && (
                    <div
                      ref={colorPickerRef}
                      className="fixed z-[9999] rounded-lg border border-border bg-popover p-2 shadow-lg"
                      style={{
                        top: (() => {
                          const btn = document.querySelector(
                            `[data-color-btn="${tag.id}"]`
                          );
                          if (btn) {
                            const rect = btn.getBoundingClientRect();
                            return `${rect.bottom + 4}px`;
                          }
                          return '0px';
                        })(),
                        left: (() => {
                          const btn = document.querySelector(
                            `[data-color-btn="${tag.id}"]`
                          );
                          if (btn) {
                            const rect = btn.getBoundingClientRect();
                            return `${rect.left}px`;
                          }
                          return '0px';
                        })(),
                      }}
                    >
                      <div className="grid grid-cols-5 gap-1.5">
                        {presetColors.map((color) => (
                          <button
                            key={color}
                            className={cn(
                              'h-6 w-6 rounded-md border-2 transition-all',
                              tag.color === color
                                ? 'border-foreground scale-110'
                                : 'border-transparent hover:scale-105'
                            )}
                            style={{ backgroundColor: color }}
                            onClick={() => onColorSelect(tag.id, color)}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </td>
              <td className="px-4 py-2">
                {editingTagId === tag.id ? (
                  <input
                    ref={editInputRef}
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={onSaveEditName}
                    onKeyDown={onEditKeyDown}
                    className="w-40 rounded border border-input px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                ) : (
                  <button
                    className="cursor-text text-foreground hover:underline"
                    onClick={() => onStartEditName(tag.id, tag.name)}
                  >
                    {tag.name}
                  </button>
                )}
              </td>
              <td className="px-4 py-2 text-muted-foreground">
                {tag.count || 0}
              </td>
              <td className="px-4 py-2 text-right">
                <button
                  className="text-muted-foreground transition-colors hover:text-error"
                  onClick={() => onDeleteRequest(tag.id)}
                  title={t('actions.delete')}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </td>
            </tr>
          ))}
          {filteredTags.length === 0 && (
            <tr>
              <td
                colSpan={4}
                className="px-4 py-8 text-center text-sm text-muted-foreground"
              >
                {t('messages.noData')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

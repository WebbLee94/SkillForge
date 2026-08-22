import { Save, Undo2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Tag } from '../../types';
import { TagChip } from '../../components/ui/tags/TagChip';
import { TagPopover } from '../skills/TagPopover';

interface InspectorBodyProps {
  resourceType: 'skill' | 'rule';
  source?: string | null;
  updatedAt: string;
  contentPreview: string;
  draftTags: Tag[];
  allTags: Tag[];
  onToggleTag: (tagId: number) => void;
  onAssignTag: (tagId: number) => void;
  onRemoveTag: (tagId: number) => void;
  onCreateTag?: (name: string, color: string) => Promise<number | void>;
  children?: React.ReactNode;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onUndo: () => void;
}

export function InspectorBody({
  resourceType,
  source,
  updatedAt,
  contentPreview,
  draftTags,
  allTags,
  onToggleTag,
  onAssignTag,
  onRemoveTag,
  onCreateTag,
  children,
  dirty,
  saving,
  onSave,
  onUndo,
}: InspectorBodyProps) {
  const { t } = useTranslation('common');

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="space-y-2 text-sm">
        {resourceType === 'skill' && source ? (
          <div className="flex justify-between gap-3">
            <span className="shrink-0 text-muted-foreground">
              {t('detail.source')}
            </span>
            <span className="truncate text-foreground">{source}</span>
          </div>
        ) : null}
        <div className="flex justify-between gap-3">
          <span className="shrink-0 text-muted-foreground">
            {t('detail.updatedAt')}
          </span>
          <span className="text-xs text-foreground">{updatedAt}</span>
        </div>
      </div>

      {children}

      <div className="mt-4">
        <h3 className="mb-1 text-xs font-semibold text-muted-foreground">
          {t('detail.preview')}
        </h3>
        <p className="line-clamp-6 whitespace-pre-wrap text-xs text-muted-foreground">
          {contentPreview || t('messages.noData')}
        </p>
      </div>

      <div className="mt-4">
        <h3 className="mb-2 text-xs font-semibold text-muted-foreground">
          {t('nav.tags')}
        </h3>
        {draftTags.length === 0 ? (
          <p className="mb-2 text-xs text-muted-foreground">
            {t('messages.noData')}
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5" data-testid="inspector-tag-chips">
            {draftTags.map((tag) => (
              <TagChip
                key={tag.id}
                tag={tag}
                size="sm"
                removeLabel={t('inspector.removeTagLabel', { name: tag.name })}
                onRemove={() => onToggleTag(tag.id)}
              />
            ))}
          </div>
        )}
        <TagPopover
          tagType={resourceType}
          targetId={''}
          ariaLabel={t('inspector.addTag')}
          assignedTags={draftTags}
          allTags={allTags}
          onAssign={onAssignTag}
          onRemove={onRemoveTag}
          onCreate={onCreateTag}
        />
      </div>

      {dirty && (
        <div className="mt-4 flex items-center gap-2">
          <button
            className={
              'flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90' +
              (saving ? ' pointer-events-none opacity-60' : '')
            }
            onClick={onSave}
          >
            <Save className="h-3.5 w-3.5" />
            {t('actions.save')}
          </button>
          <button
            className={
              'flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent' +
              (saving ? ' pointer-events-none opacity-60' : '')
            }
            onClick={onUndo}
          >
            <Undo2 className="h-3.5 w-3.5" />
            {t('actions.undo')}
          </button>
        </div>
      )}
    </div>
  );
}

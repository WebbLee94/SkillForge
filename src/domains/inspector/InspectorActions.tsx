import { Send, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';

interface InspectorActionsProps {
  onGoDistribute?: () => void;
  onEdit?: () => void;
  onDelete: () => void;
  goDistributeLabel: string;
  editLabel: string;
  deleteLabel: string;
}

export function InspectorActions({
  onGoDistribute,
  onEdit,
  onDelete,
  goDistributeLabel,
  editLabel,
  deleteLabel,
}: InspectorActionsProps) {
  return (
    <div
      data-testid="inspector-actions"
      className="flex shrink-0 flex-row items-center gap-2 border-t border-border p-4"
    >
      {onGoDistribute && (
        <button
          className={cn(
            'flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2',
            'text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90'
          )}
          onClick={onGoDistribute}
        >
          <Send className="h-4 w-4" />
          {goDistributeLabel}
        </button>
      )}
      {onEdit && (
        <button
          className={cn(
            'flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2',
            'text-sm font-medium text-foreground transition-colors hover:bg-accent'
          )}
          onClick={onEdit}
        >
          {editLabel}
        </button>
      )}
      <button
        className={cn(
          'flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-error/30 bg-error/5 px-3 py-2',
          'text-sm font-medium text-error transition-colors hover:bg-error/10'
        )}
        onClick={onDelete}
      >
        <Trash2 className="h-4 w-4" />
        {deleteLabel}
      </button>
    </div>
  );
}

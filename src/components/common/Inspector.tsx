import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { X, Save, Undo2, Trash2, Send } from 'lucide-react';
import type { Tag } from '../../types';
import { computeTagChanges, formatFullTimestamp } from '../../lib/resourceLibrary';
import { hasOpenModal } from '../../lib/modalScope';
import { useDialogA11y } from '../../hooks/useDialogA11y';
import { TagChip } from './TagChip';
import { TagPopover } from '../../components/TagPopover';

interface InspectorProps {
  resourceType: 'skill' | 'rule';
  title: string;
  /** e.g. version line for skills */
  subtitle?: string;
  /** 来源仅技能展示；Rule 无来源（不传/传 null 则不渲染来源行） */
  source?: string | null;
  /** Inspector 显示完整时间戳 */
  updatedAt: string;
  contentPreview: string;
  /** 已保存标签（事实源）；保存成功后父级重新 fetch 会使此处更新并重置草稿 */
  tags: Tag[];
  /** 当前模块全部标签（用于勾选编辑） */
  allTags: Tag[];
  /** 标签编辑保存回调：added / removed 标签 id */
  onSaveTags: (added: number[], removed: number[]) => Promise<void>;
  /** 标签创建回调（可选）：返回新标签 id，TagPopover 创建后自动加入 draft */
  onCreateTag?: (name: string, color: string) => Promise<number | void>;
  onEdit?: () => void;
  onDelete: () => void;
  onGoDistribute?: () => void;
  onClose: () => void;
  editLabel?: string;
  deleteLabel?: string;
  goDistributeLabel?: string;
  children?: React.ReactNode;
}

function sameIds(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(b);
  return a.every((id) => set.has(id));
}

/**
 * 资源详情面板（Inspector，Phase 6 §3.2/§3.5）：
 * - 名称、完整时间戳；来源仅技能（规则无来源）；
 * - 内容预览；标签编辑带脏状态（保存 / 撤销 / 离开确认）；
 * - 本地路径 / reveal 由父级以 children 形式渲染（33 号 4.2：不再内置底部全宽按钮）。
 * 父级渲染时应以资源 id 作为 key 以在切换资源时重置草稿。
 */
export function Inspector({
  resourceType,
  title,
  subtitle,
  source,
  updatedAt,
  contentPreview,
  tags,
  allTags,
  onSaveTags,
  onCreateTag,
  onEdit,
  onDelete,
  onGoDistribute,
  onClose,
  editLabel,
  deleteLabel,
  goDistributeLabel,
  children,
}: InspectorProps) {
  const { t } = useTranslation('common');
  const savedIds = useMemo(() => tags.map((t) => t.id), [tags]);
  const [draftIds, setDraftIds] = useState<number[]>(savedIds);
  const [saving, setSaving] = useState(false);
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const draftTags = useMemo(
    () => allTags.filter((tag) => draftIds.includes(tag.id)),
    [allTags, draftIds]
  );

  const dirty = !sameIds(draftIds, savedIds);

  // 保存成功 → tags prop 更新（savedIds 变化）→ 重置草稿为已保存状态
  const savedKey = savedIds
    .slice()
    .sort((a, b) => a - b)
    .join(',');
  useEffect(() => {
    setDraftIds(savedIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  const toggleDraft = useCallback((tagId: number) => {
    setDraftIds((prev) =>
      prev.includes(tagId)
        ? prev.filter((id) => id !== tagId)
        : [...prev, tagId]
    );
  }, []);

  const handleSave = useCallback(async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      const { added, removed } = computeTagChanges(savedIds, draftIds);
      await onSaveTags(added, removed);
    } finally {
      setSaving(false);
    }
  }, [dirty, saving, savedIds, draftIds, onSaveTags]);

  const handleUndo = useCallback(() => {
    setDraftIds(savedIds);
  }, [savedIds]);

  const handleClose = useCallback(() => {
    if (dirty) setLeaveConfirm(true);
    else onClose();
  }, [dirty, onClose]);

  const handleDiscard = useCallback(() => {
    setLeaveConfirm(false);
    onClose();
  }, [onClose]);

  const handleSaveAndClose = useCallback(async () => {
    if (!dirty) {
      setLeaveConfirm(false);
      onClose();
      return;
    }
    setSaving(true);
    try {
      const { added, removed } = computeTagChanges(savedIds, draftIds);
      await onSaveTags(added, removed);
      setLeaveConfirm(false);
      onClose();
    } finally {
      setSaving(false);
    }
  }, [dirty, savedIds, draftIds, onSaveTags, onClose]);

  const leaveConfirmRef = useDialogA11y(leaveConfirm);

  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (saving) return;
      if (hasOpenModal()) return;
      if (dirty) setLeaveConfirm(true);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, saving, onClose]);

  return (
    <>
      <div
        ref={rootRef}
        data-testid="inspector-root"
        tabIndex={-1}
        className="flex h-full flex-col"
      >
        <div
          data-testid="inspector-header"
          className="flex items-start justify-between gap-2 border-b border-border p-4"
        >
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold text-foreground">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
          <button
            aria-label="close"
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
            onClick={handleClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

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
              <span className="text-xs text-foreground">
                {formatFullTimestamp(updatedAt)}
              </span>
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
              <div
                className="flex flex-wrap gap-1.5"
                data-testid="inspector-tag-chips"
              >
                {draftTags.map((tag) => (
                  <TagChip
                    key={tag.id}
                    tag={tag}
                    size="sm"
                    removeLabel={t('inspector.removeTagLabel', {
                      name: tag.name,
                    })}
                    onRemove={() => toggleDraft(tag.id)}
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
              onAssign={(id) => {
                if (!draftIds.includes(id)) setDraftIds((p) => [...p, id]);
              }}
              onRemove={(id) => toggleDraft(id)}
              onCreate={onCreateTag}
            />
          </div>

          {dirty && (
            <div className="mt-4 flex items-center gap-2">
              <button
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2',
                  'text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors',
                  saving && 'opacity-60 pointer-events-none'
                )}
                onClick={handleSave}
              >
                <Save className="h-3.5 w-3.5" />
                {t('actions.save')}
              </button>
              <button
                className={cn(
                  'flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm',
                  'font-medium text-foreground hover:bg-accent transition-colors',
                  saving && 'opacity-60 pointer-events-none'
                )}
                onClick={handleUndo}
              >
                <Undo2 className="h-3.5 w-3.5" />
                {t('actions.undo')}
              </button>
            </div>
          )}
        </div>

        {/* 操作区固定在面板底部（决策 7）：加入本次分发 primary → 编辑 outline → 删除 destructive */}
        <div
          data-testid="inspector-actions"
          className="flex flex-row items-center gap-2 border-t border-border p-4 shrink-0"
        >
          {onGoDistribute && (
            <button
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2',
                'text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors'
              )}
              onClick={onGoDistribute}
            >
              <Send className="h-4 w-4" />
              {goDistributeLabel || t('actions.goDistribute')}
            </button>
          )}
          {onEdit && (
            <button
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2',
                'text-sm font-medium text-foreground hover:bg-accent transition-colors'
              )}
              onClick={onEdit}
            >
              {editLabel || t('actions.edit')}
            </button>
          )}
          <button
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-error/30 bg-error/5 px-3 py-2',
              'text-sm font-medium text-error hover:bg-error/10 transition-colors'
            )}
            onClick={onDelete}
          >
            <Trash2 className="h-4 w-4" />
            {deleteLabel || t('actions.delete')}
          </button>
        </div>
      </div>

      {leaveConfirm && (
        <div
          ref={leaveConfirmRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="inspector-leave-title"
          tabIndex={-1}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        >
          <div className="w-[400px] rounded-lg border border-border bg-card p-6 shadow-xl animate-fade-in">
            <h2
              id="inspector-leave-title"
              className="text-lg font-semibold text-foreground"
            >
              {t('inspector.unsavedTitle')}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {t('inspector.unsavedMessage')}
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors"
                onClick={() => setLeaveConfirm(false)}
              >
                {t('inspector.stay')}
              </button>
              <button
                className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors"
                onClick={handleDiscard}
              >
                {t('inspector.discard')}
              </button>
              <button
                className={cn(
                  'rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors',
                  saving && 'opacity-60 pointer-events-none'
                )}
                onClick={handleSaveAndClose}
              >
                {t('actions.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

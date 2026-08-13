import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';
import { X, Save, Undo2, Trash2, FolderOpen, Send } from 'lucide-react';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import type { Tag } from '../types';
import { computeTagChanges, formatFullTimestamp } from '../lib/resourceLibrary';
import { useDialogA11y } from '../hooks/useDialogA11y';

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
  /** 受管副本路径；仅存在时显示平台原生 reveal（恰好一个标签），未分发不显示 */
  managedCopyPath?: string | null;
  revealLabel?: string;
  /** 标签编辑保存回调：added / removed 标签 id */
  onSaveTags: (added: number[], removed: number[]) => Promise<void>;
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
 * - 受管副本 reveal：仅已分发资源显示恰好一个平台原生标签。
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
  managedCopyPath,
  revealLabel,
  onSaveTags,
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

  const showReveal = Boolean(managedCopyPath);
  const revealText =
    revealLabel ||
    (/mac/i.test(navigator.platform || '') ||
    /Mac/i.test(navigator.userAgent || '')
      ? '在访达中显示'
      : '在文件夹中显示');

  const leaveConfirmRef = useDialogA11y(leaveConfirm);

  return (
    <>
      <div className="flex h-full flex-col">
        <div className="flex items-start justify-between gap-2 border-b border-border p-4">
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

          {showReveal && managedCopyPath && (
            <button
              className={cn(
                'mt-4 flex w-full items-center justify-center gap-2 rounded-lg border',
                'border-border bg-card px-3 py-2 text-sm font-medium text-foreground',
                'hover:bg-accent transition-colors'
              )}
              onClick={() => revealItemInDir(managedCopyPath)}
            >
              <FolderOpen className="h-4 w-4" />
              {revealText}
            </button>
          )}

          <div className="mt-4">
            <h3 className="mb-2 text-xs font-semibold text-muted-foreground">
              {t('nav.tags')}
            </h3>
            {allTags.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t('messages.noData')}
              </p>
            ) : (
              <div className="space-y-1">
                {allTags.map((tag) => {
                  const checked = draftIds.includes(tag.id);
                  return (
                    <label
                      key={tag.id}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleDraft(tag.id)}
                        className="h-4 w-4 rounded border-border"
                      />
                      <span
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={
                          tag.color ? { backgroundColor: tag.color } : undefined
                        }
                      />
                      <span className="text-foreground">{tag.name}</span>
                    </label>
                  );
                })}
              </div>
            )}
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

          <div className="mt-6 space-y-2">
            {onEdit && (
              <button
                className={cn(
                  'flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2',
                  'text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors'
                )}
                onClick={onEdit}
              >
                {editLabel || t('actions.edit')}
              </button>
            )}
            {onGoDistribute && (
              <button
                className={cn(
                  'flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 py-2',
                  'text-sm font-medium text-foreground hover:bg-accent transition-colors'
                )}
                onClick={onGoDistribute}
              >
                <Send className="h-4 w-4" />
                {goDistributeLabel || t('actions.goDistribute')}
              </button>
            )}
            <button
              className={cn(
                'flex w-full items-center justify-center gap-2 rounded-lg border border-error/30 bg-error/5 px-3 py-2',
                'text-sm font-medium text-error hover:bg-error/10 transition-colors'
              )}
              onClick={onDelete}
            >
              <Trash2 className="h-4 w-4" />
              {deleteLabel || t('actions.delete')}
            </button>
          </div>
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

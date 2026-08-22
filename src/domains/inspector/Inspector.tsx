import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { Tag } from '../../types';
import { computeTagChanges, formatFullTimestamp } from '../../lib/resourceLibrary';
import { hasOpenModal } from '../../lib/modalScope';
import { useDialogA11y } from '../../hooks/useDialogA11y';
import { InspectorActions } from './InspectorActions';
import { InspectorLeaveConfirmDialog } from './InspectorLeaveConfirmDialog';
import { InspectorBody } from './InspectorBody';

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
  const draftTags = useMemo(() => allTags.filter((tag) => draftIds.includes(tag.id)), [allTags, draftIds]);

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

  const updatedAtLabel = formatFullTimestamp(updatedAt);

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

        <InspectorBody
          resourceType={resourceType}
          source={source}
          updatedAt={updatedAtLabel}
          contentPreview={contentPreview}
          draftTags={draftTags}
          allTags={allTags}
          onToggleTag={toggleDraft}
          onAssignTag={(id) => {
            if (!draftIds.includes(id)) setDraftIds((p) => [...p, id]);
          }}
          onRemoveTag={toggleDraft}
          onCreateTag={onCreateTag}
          children={children}
          dirty={dirty}
          saving={saving}
          onSave={handleSave}
          onUndo={handleUndo}
        />

        <InspectorActions
          onGoDistribute={onGoDistribute}
          onEdit={onEdit}
          onDelete={onDelete}
          goDistributeLabel={goDistributeLabel || t('actions.goDistribute')}
          editLabel={editLabel || t('actions.edit')}
          deleteLabel={deleteLabel || t('actions.delete')}
        />
      </div>

      <InspectorLeaveConfirmDialog
        open={leaveConfirm}
        dialogRef={leaveConfirmRef}
        title={t('inspector.unsavedTitle')}
        message={t('inspector.unsavedMessage')}
        stayLabel={t('inspector.stay')}
        discardLabel={t('inspector.discard')}
        saveLabel={t('actions.save')}
        saving={saving}
        onStay={() => setLeaveConfirm(false)}
        onDiscard={handleDiscard}
        onSaveAndClose={handleSaveAndClose}
      />
    </>
  );
}

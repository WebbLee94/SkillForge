import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../stores/appStore';
import { ConfirmDialog } from './ConfirmDialog';
import { TagManagerDialogBody } from './TagManagerDialogBody';

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

interface TagManagerDialogProps {
  tagType: 'skill' | 'rule';
  isOpen: boolean;
  onClose: () => void;
}

export function TagManagerDialog({
  tagType,
  isOpen,
  onClose,
}: TagManagerDialogProps) {
  const { t } = useTranslation('common');
  const tags = useAppStore((s) => s.tags);
  const fetchTags = useAppStore((s) => s.fetchTags);
  const createTag = useAppStore((s) => s.createTag);
  const updateTag = useAppStore((s) => s.updateTag);
  const deleteTag = useAppStore((s) => s.deleteTag);

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [editingTagId, setEditingTagId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [confirmDeleteTagId, setConfirmDeleteTagId] = useState<number | null>(
    null
  );
  const [colorPickerTagId, setColorPickerTagId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const editInputRef = useRef<HTMLInputElement>(null);
  const colorPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      fetchTags(tagType);
      setShowCreate(false);
      setEditingTagId(null);
      setSearchQuery('');
    }
  }, [isOpen, tagType, fetchTags]);

  useEffect(() => {
    if (editingTagId !== null && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingTagId]);

  useEffect(() => {
    if (colorPickerTagId === null) return;
    const handler = (e: MouseEvent) => {
      if (
        colorPickerRef.current &&
        !colorPickerRef.current.contains(e.target as Node)
      ) {
        setColorPickerTagId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [colorPickerTagId]);

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return;
    await createTag({
      name: newName.trim(),
      color: newColor,
      tag_type: tagType,
    });
    setShowCreate(false);
    setNewName('');
    setNewColor(PRESET_COLORS[0]);
  }, [newName, newColor, tagType, createTag]);

  const handleDelete = useCallback((id: number) => {
    setConfirmDeleteTagId(id);
  }, []);

  const executeDeleteTag = useCallback(async () => {
    if (confirmDeleteTagId === null) return;
    await deleteTag(confirmDeleteTagId);
    setConfirmDeleteTagId(null);
  }, [confirmDeleteTagId, deleteTag]);

  const startEditName = (tagId: number, currentName: string) => {
    setEditingTagId(tagId);
    setEditName(currentName);
    setColorPickerTagId(null);
  };

  const saveEditName = async () => {
    if (editingTagId !== null && editName.trim()) {
      await updateTag(editingTagId, editName.trim(), undefined);
      setEditingTagId(null);
    }
  };

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') saveEditName();
    else if (e.key === 'Escape') setEditingTagId(null);
  };

  const handleColorSelect = async (tagId: number, color: string) => {
    await updateTag(tagId, undefined, color);
    setColorPickerTagId(null);
  };

  const filteredTags = tags.filter((tag) =>
    tag.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const deleteTagMessage = useMemo(() => {
    if (confirmDeleteTagId === null) return '';
    const tag = tags.find((t) => t.id === confirmDeleteTagId);
    const count = tag?.count || 0;
    const typeName =
      tagType === 'skill' ? t('tag.skillType') : t('tag.ruleType');
    return count > 0
      ? t('tag.deleteConfirm', { count, type: typeName })
      : t('messages.confirmDelete');
  }, [confirmDeleteTagId, tags, tagType, t]);

  if (!isOpen) return null;

  const title = tagType === 'skill' ? t('tag.skillType') : t('tag.ruleType');

  return (
    <>
      <TagManagerDialogBody
        filteredTags={filteredTags}
      searchQuery={searchQuery}
      setSearchQuery={setSearchQuery}
      showCreate={showCreate}
      setShowCreate={setShowCreate}
      newName={newName}
      setNewName={setNewName}
      newColor={newColor}
      setNewColor={setNewColor}
      editingTagId={editingTagId}
      editName={editName}
      setEditName={setEditName}
      colorPickerTagId={colorPickerTagId}
      setColorPickerTagId={setColorPickerTagId}
      editInputRef={editInputRef}
      colorPickerRef={colorPickerRef}
      title={title}
      presetColors={PRESET_COLORS}
      onClose={onClose}
      onCreate={handleCreate}
      onDeleteRequest={handleDelete}
      onStartEditName={startEditName}
      onSaveEditName={saveEditName}
      onEditKeyDown={handleEditKeyDown}
      onColorSelect={handleColorSelect}
    />

      <ConfirmDialog
        open={confirmDeleteTagId !== null}
        title={t('messages.confirmDelete')}
        message={deleteTagMessage}
        variant="danger"
        confirmLabel={t('actions.delete')}
        onConfirm={executeDeleteTag}
        onCancel={() => setConfirmDeleteTagId(null)}
      />
    </>
  );
}

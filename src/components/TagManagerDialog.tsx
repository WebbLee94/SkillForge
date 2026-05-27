import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../stores/appStore";
import { cn } from "../lib/utils";
import { Plus, Trash2, X, Palette } from "lucide-react";
import { ConfirmDialog } from "./ConfirmDialog";

const PRESET_COLORS = [
  "#3B82F6", "#8B5CF6", "#EC4899", "#EF4444", "#F97316",
  "#EAB308", "#22C55E", "#14B8A6", "#06B6D4", "#6366F1",
];

interface TagManagerDialogProps {
  tagType: "skill" | "rule";
  isOpen: boolean;
  onClose: () => void;
}

export function TagManagerDialog({ tagType, isOpen, onClose }: TagManagerDialogProps) {
  const { t } = useTranslation("common");
  const tags = useAppStore((s) => s.tags);
  const fetchTags = useAppStore((s) => s.fetchTags);
  const createTag = useAppStore((s) => s.createTag);
  const updateTag = useAppStore((s) => s.updateTag);
  const deleteTag = useAppStore((s) => s.deleteTag);

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [editingTagId, setEditingTagId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmDeleteTagId, setConfirmDeleteTagId] = useState<number | null>(null);
  const [colorPickerTagId, setColorPickerTagId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const editInputRef = useRef<HTMLInputElement>(null);
  const colorPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      fetchTags(tagType);
      setShowCreate(false);
      setEditingTagId(null);
      setSearchQuery("");
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
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
        setColorPickerTagId(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [colorPickerTagId]);

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return;
    await createTag({ name: newName.trim(), color: newColor, tag_type: tagType });
    setShowCreate(false);
    setNewName("");
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

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") saveEditName();
    else if (e.key === "Escape") setEditingTagId(null);
  };

  const handleColorSelect = async (tagId: number, color: string) => {
    await updateTag(tagId, undefined, color);
    setColorPickerTagId(null);
  };

  const filteredTags = tags.filter((tag) =>
    tag.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const deleteTagMessage = useMemo(() => {
    if (confirmDeleteTagId === null) return "";
    const tag = tags.find((t) => t.id === confirmDeleteTagId);
    const count = tag?.count || 0;
    const typeName = tagType === "skill" ? t("tag.skillType") : t("tag.ruleType");
    return count > 0
      ? t("tag.deleteConfirm", { count, type: typeName })
      : t("messages.confirmDelete");
  }, [confirmDeleteTagId, tags, tagType, t]);

  if (!isOpen) return null;

  const title = tagType === "skill" ? t("tag.skillType") : t("tag.ruleType");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[520px] max-h-[80vh] rounded-lg border border-border bg-card shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">{t("actions.manage", { defaultValue: "管理" })}{title}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Search + Create */}
        <div className="flex items-center gap-2 px-6 py-3 border-b border-border">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("actions.search")}
            className={cn(
              "flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm",
              "placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring",
            )}
          />
          <button
            className={cn(
              "flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5",
              "text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors",
            )}
            onClick={() => setShowCreate(true)}
          >
            <Plus className="h-4 w-4" />
            {t("actions.create")}
          </button>
        </div>

        {/* Tag List */}
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-2 text-left font-medium text-muted-foreground w-32">颜色</th>
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">{t("tag.name")}</th>
                <th className="px-4 py-2 text-left font-medium text-muted-foreground w-20">{t("tag.associatedCount")}</th>
                <th className="px-4 py-2 text-right font-medium text-muted-foreground w-16">{t("actions.delete")}</th>
              </tr>
            </thead>
            <tbody>
              {filteredTags.map((tag) => (
                <tr key={tag.id} className="border-b border-border last:border-0 group">
                  <td className="px-4 py-2">
                    <div className="relative">
                      <button
                        data-color-btn={tag.id}
                        className="h-5 w-5 rounded-full shrink-0 border border-white/30 hover:scale-125 transition-transform"
                        style={{ backgroundColor: tag.color || "#888" }}
                        onClick={() => setColorPickerTagId(colorPickerTagId === tag.id ? null : tag.id)}
                        title={t("tag.selectColor")}
                      />
                      {colorPickerTagId === tag.id && (
                        <div
                          ref={colorPickerRef}
                          className="fixed z-[9999] rounded-lg border border-border bg-popover p-2 shadow-lg"
                          style={{
                            top: (() => {
                              const btn = document.querySelector(`[data-color-btn="${tag.id}"]`);
                              if (btn) {
                                const rect = btn.getBoundingClientRect();
                                return `${rect.bottom + 4}px`;
                              }
                              return '0px';
                            })(),
                            left: (() => {
                              const btn = document.querySelector(`[data-color-btn="${tag.id}"]`);
                              if (btn) {
                                const rect = btn.getBoundingClientRect();
                                return `${rect.left}px`;
                              }
                              return '0px';
                            })(),
                          }}
                        >
                          <div className="grid grid-cols-5 gap-1.5">
                            {PRESET_COLORS.map((color) => (
                              <button
                                key={color}
                                className={cn(
                                  "h-6 w-6 rounded-md border-2 transition-all",
                                  tag.color === color ? "border-foreground scale-110" : "border-transparent hover:scale-105",
                                )}
                                style={{ backgroundColor: color }}
                                onClick={() => handleColorSelect(tag.id, color)}
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
                        onBlur={saveEditName}
                        onKeyDown={handleEditKeyDown}
                        className="w-40 rounded border border-input px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    ) : (
                      <button
                        className="hover:underline cursor-text text-foreground"
                        onClick={() => startEditName(tag.id, tag.name)}
                      >
                        {tag.name}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{tag.count || 0}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      className="text-muted-foreground hover:text-error transition-colors"
                      onClick={() => handleDelete(tag.id)}
                      title={t("actions.delete")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {filteredTags.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    {t("messages.noData")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Create Form */}
        {showCreate && (
          <div className="border-t border-border px-6 py-4 space-y-3">
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("tag.namePlaceholder")}
                className={cn(
                  "flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm",
                  "placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring",
                )}
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
              />
              <button
                className="rounded-lg bg-secondary px-3 py-1.5 text-sm text-secondary-foreground hover:bg-secondary/80"
                onClick={() => { setShowCreate(false); setNewName(""); }}
              >
                {t("actions.cancel")}
              </button>
              <button
                className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                onClick={handleCreate}
              >
                {t("actions.save")}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <Palette className="h-4 w-4 text-muted-foreground" />
              {PRESET_COLORS.map((color) => (
                <button
                  key={color}
                  className={cn(
                    "h-6 w-6 rounded-md border-2 transition-all",
                    newColor === color ? "border-foreground scale-110" : "border-transparent hover:scale-105",
                  )}
                  style={{ backgroundColor: color }}
                  onClick={() => setNewColor(color)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmDeleteTagId !== null}
        title={t("messages.confirmDelete")}
        message={deleteTagMessage}
        variant="danger"
        confirmLabel={t("actions.delete")}
        onConfirm={executeDeleteTag}
        onCancel={() => setConfirmDeleteTagId(null)}
      />
    </div>
  );
}

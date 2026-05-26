import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../stores/appStore";
import { cn } from "../lib/utils";
import { Plus, Trash2, X, Palette } from "lucide-react";

const PRESET_COLORS = [
  "#3B82F6", "#8B5CF6", "#EC4899", "#EF4444", "#F97316",
  "#EAB308", "#22C55E", "#14B8A6", "#06B6D4", "#6366F1",
];

export function TagsManager() {
  const { t } = useTranslation("common");
  const tags = useAppStore((s) => s.tags);
  const fetchTags = useAppStore((s) => s.fetchTags);
  const createTag = useAppStore((s) => s.createTag);
  const updateTag = useAppStore((s) => s.updateTag);
  const deleteTag = useAppStore((s) => s.deleteTag);

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);

  // Inline editing state
  const [editingTagId, setEditingTagId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [colorPickerTagId, setColorPickerTagId] = useState<number | null>(null);

  const editInputRef = useRef<HTMLInputElement>(null);
  const colorPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  // Focus input when editing starts
  useEffect(() => {
    if (editingTagId !== null && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingTagId]);

  // Close color picker on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
        setColorPickerTagId(null);
      }
    };
    if (colorPickerTagId !== null) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [colorPickerTagId]);

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return;
    await createTag({ name: newName.trim(), color: newColor });
    setShowCreate(false);
    setNewName("");
    setNewColor(PRESET_COLORS[0]);
  }, [newName, newColor, createTag]);

  const handleDelete = useCallback(async (id: number) => {
    const tag = tags.find((t) => t.id === id);
    const skillCount = tag?.skill_count || 0;
    const ruleCount = tag?.rule_count || 0;
    const msg = skillCount > 0 || ruleCount > 0
      ? `该标签关联 ${skillCount} 个技能、${ruleCount} 个规则，确定删除？`
      : t("messages.confirmDelete");
    if (window.confirm(msg)) {
      await deleteTag(id);
    }
  }, [tags, t, deleteTag]);

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
    if (e.key === "Enter") {
      saveEditName();
    } else if (e.key === "Escape") {
      setEditingTagId(null);
    }
  };

  const handleColorSelect = async (tagId: number, color: string) => {
    await updateTag(tagId, undefined, color);
    setColorPickerTagId(null);
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-foreground">{t("nav.tags")}</h1>
        <button
          className={cn(
            "flex items-center gap-2 rounded-lg bg-primary px-3 py-2",
            "text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors",
          )}
          onClick={() => setShowCreate(true)}
        >
          <Plus className="h-4 w-4" />
          {t("actions.create")}
        </button>
      </div>

      {/* Tag Grid */}
      <div className="flex flex-wrap gap-3">
        {tags.map((tag) => (
          <div key={tag.id} className="group relative">
            {editingTagId === tag.id ? (
              /* Inline name editing */
              <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-card p-2 shadow-sm">
                <input
                  ref={editInputRef}
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={saveEditName}
                  onKeyDown={handleEditKeyDown}
                  className="w-24 rounded border border-input px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {/* Tag chip: click name to edit, click color to pick */}
                <div className="flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium hover:shadow-sm transition-all"
                  style={tag.color ? { backgroundColor: tag.color + "20", color: tag.color } : undefined}
                >
                  {/* Color swatch: click to open color picker */}
                  <button
                    className="h-3.5 w-3.5 rounded-full shrink-0 border border-white/30 hover:scale-125 transition-transform"
                    style={tag.color ? { backgroundColor: tag.color } : { backgroundColor: "hsl(var(--muted-foreground))" }}
                    onClick={() => setColorPickerTagId(colorPickerTagId === tag.id ? null : tag.id)}
                    title="选择颜色"
                  />
                  {/* Tag name: click to edit inline */}
                  <button
                    className="hover:underline cursor-text"
                    onClick={() => startEditName(tag.id, tag.name)}
                  >
                    {tag.name}
                  </button>
                  {(tag.skill_count !== undefined || tag.rule_count !== undefined) && (
                    <span className="opacity-60 text-xs">
                      {(tag.skill_count || 0) + (tag.rule_count || 0)}
                    </span>
                  )}
                </div>
                <button
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-error transition-all"
                  onClick={() => handleDelete(tag.id)}
                  title={t("actions.delete")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* Color Picker Popup */}
            {colorPickerTagId === tag.id && (
              <div
                ref={colorPickerRef}
                className="absolute z-30 mt-1 rounded-lg border border-border bg-card p-3 shadow-lg"
              >
                <div className="flex flex-wrap gap-2">
                  {PRESET_COLORS.map((color) => (
                    <button
                      key={color}
                      className={cn(
                        "h-7 w-7 rounded-lg border-2 transition-all",
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
        ))}
        {tags.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("messages.noData")}</p>
        )}
      </div>

      {/* Create Dialog */}
      {showCreate && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50">
          <div className="w-[400px] rounded-lg border border-border bg-card p-6 shadow-xl animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">{t("actions.create")}{t("nav.tags")}</h2>
              <button onClick={() => setShowCreate(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">名称</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="输入标签名称"
                  className={cn(
                    "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm",
                    "focus:outline-none focus:ring-2 focus:ring-ring",
                  )}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  <Palette className="mr-1 inline h-4 w-4" /> 颜色
                </label>
                <div className="flex flex-wrap gap-2">
                  {PRESET_COLORS.map((color) => (
                    <button
                      key={color}
                      className={cn(
                        "h-8 w-8 rounded-lg border-2 transition-all",
                        newColor === color ? "border-foreground scale-110" : "border-transparent hover:scale-105",
                      )}
                      style={{ backgroundColor: color }}
                      onClick={() => setNewColor(color)}
                    />
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
                  onClick={() => setShowCreate(false)}
                >
                  {t("actions.cancel")}
                </button>
                <button
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                  onClick={handleCreate}
                >
                  {t("actions.save")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

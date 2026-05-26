import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../stores/appStore";
import { cn } from "../lib/utils";
import { Plus, Trash2, X, Palette } from "lucide-react";

const PRESET_COLORS = [
  "#3B82F6", "#8B5CF6", "#EC4899", "#EF4444", "#F97316",
  "#EAB308", "#22C55E", "#14B8A6", "#06B6D4", "#6366F1",
];

type TagTabType = "skill" | "rule";

export function TagsManager() {
  const { t } = useTranslation("common");
  const tags = useAppStore((s) => s.tags);
  const fetchTags = useAppStore((s) => s.fetchTags);
  const createTag = useAppStore((s) => s.createTag);
  const updateTag = useAppStore((s) => s.updateTag);
  const deleteTag = useAppStore((s) => s.deleteTag);

  const [activeTab, setActiveTab] = useState<TagTabType>("skill");
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
    fetchTags(activeTab);
  }, [fetchTags, activeTab]);

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
    await createTag({ name: newName.trim(), color: newColor, tag_type: activeTab });
    setShowCreate(false);
    setNewName("");
    setNewColor(PRESET_COLORS[0]);
  }, [newName, newColor, activeTab, createTag]);

  const handleDelete = useCallback(async (id: number) => {
    const tag = tags.find((t) => t.id === id);
    const count = tag?.count || 0;
    const typeName = activeTab === "skill" ? t("tag.skillType") : t("tag.ruleType");
    const msg = count > 0
      ? t("tag.deleteConfirm", { count, type: typeName })
      : t("messages.confirmDelete");
    if (window.confirm(msg)) {
      await deleteTag(id);
    }
  }, [tags, activeTab, t, deleteTag]);

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

      {/* Tab Switcher */}
      <div className="mb-4 flex rounded-lg bg-muted p-0.5 w-fit">
        <button
          className={cn(
            "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
            activeTab === "skill" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => setActiveTab("skill")}
        >
          {t("tag.skillType")}
        </button>
        <button
          className={cn(
            "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
            activeTab === "rule" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => setActiveTab("rule")}
        >
          {t("tag.ruleType")}
        </button>
      </div>

      {/* Tag Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground w-12">#</th>
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground w-16">{t("tag.color")}</th>
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">{t("tag.name")}</th>
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground w-20">{t("tag.associatedCount")}</th>
              <th className="px-4 py-2.5 text-right font-medium text-muted-foreground w-20">{t("actions.delete")}</th>
            </tr>
          </thead>
          <tbody>
            {tags.map((tag, index) => (
              <tr key={tag.id} className="border-b border-border last:border-0 group">
                <td className="px-4 py-2.5 text-muted-foreground">{index + 1}</td>
                <td className="px-4 py-2.5">
                  <div className="relative">
                    <button
                      className="h-5 w-5 rounded-full shrink-0 border border-white/30 hover:scale-125 transition-transform"
                      style={tag.color ? { backgroundColor: tag.color } : { backgroundColor: "hsl(var(--muted-foreground))" }}
                      onClick={() => setColorPickerTagId(colorPickerTagId === tag.id ? null : tag.id)}
                      title={t("tag.selectColor")}
                    />
                    {colorPickerTagId === tag.id && (
                      <div
                        ref={colorPickerRef}
                        className="absolute z-30 left-0 top-8 rounded-lg border border-border bg-card p-3 shadow-lg"
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
                </td>
                <td className="px-4 py-2.5">
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
                <td className="px-4 py-2.5 text-muted-foreground">{tag.count || 0}</td>
                <td className="px-4 py-2.5 text-right">
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
            {tags.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {t("messages.noData")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Create Dialog */}
      {showCreate && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50">
          <div className="w-[400px] rounded-lg border border-border bg-card p-6 shadow-xl animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">{t("actions.create")}{activeTab === "skill" ? t("tag.skillType") : t("tag.ruleType")}</h2>
              <button onClick={() => setShowCreate(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">{t("tag.selectType")}</label>
                <div className="flex rounded-lg bg-muted p-0.5">
                  <button
                    className={cn(
                      "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                      activeTab === "skill" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => setActiveTab("skill")}
                  >
                    {t("tag.skillType")}
                  </button>
                  <button
                    className={cn(
                      "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                      activeTab === "rule" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => setActiveTab("rule")}
                  >
                    {t("tag.ruleType")}
                  </button>
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">{t("tag.name")}</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={t("tag.namePlaceholder")}
                  className={cn(
                    "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm",
                    "focus:outline-none focus:ring-2 focus:ring-ring",
                  )}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  <Palette className="mr-1 inline h-4 w-4" /> {t("tag.color")}
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

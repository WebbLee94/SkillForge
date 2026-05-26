import { memo } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/utils";
import { truncate } from "../lib/utils";
import { InlineTagEditor } from "./InlineTagEditor";
import type { Skill, SyncStatus, Tag } from "../types";

interface SkillCardProps {
  skill: Skill;
  isSelected: boolean;
  onClick: () => void;
  allTags?: Tag[];
  onAssignTag?: (tagId: number) => void;
  onRemoveTag?: (tagId: number) => void;
  batchMode?: boolean;
  checked?: boolean;
  onCheckChange?: (checked: boolean) => void;
}

const statusDotMap: Record<SyncStatus, string> = {
  synced: "bg-success",
  outdated: "bg-warning",
  partial: "bg-warning",
  error: "bg-error",
  pending: "bg-muted-foreground",
};

const sourceBadgeMap: Record<string, { bg: string; text: string }> = {
  local: { bg: "bg-secondary", text: "text-secondary-foreground" },
  "local-fs": { bg: "bg-secondary", text: "text-secondary-foreground" },
  git: { bg: "bg-primary/10", text: "text-primary" },
  "git-repo": { bg: "bg-primary/10", text: "text-primary" },
  registry: { bg: "bg-success/10", text: "text-success" },
};

export const SkillCard = memo(function SkillCard({
  skill,
  isSelected,
  onClick,
  allTags = [],
  onAssignTag,
  onRemoveTag,
  batchMode = false,
  checked = false,
  onCheckChange,
}: SkillCardProps) {
  const { t } = useTranslation("skills");
  const sourceBadge = sourceBadgeMap[skill.source_type] || sourceBadgeMap.local;
  const syncStatus = skill.sync_status || "pending";

  return (
    <button
      className={cn(
        "w-full rounded-lg border p-3 text-left transition-all relative",
        isSelected
          ? "border-primary bg-primary/5 shadow-sm"
          : "border-border bg-card hover:border-primary/30 hover:shadow-sm",
        batchMode && checked && "border-primary/50 bg-primary/5",
      )}
      onClick={onClick}
    >
      {batchMode && (
        <div
          className="absolute left-2 top-2 z-10"
          onClick={(e) => {
            e.stopPropagation();
            onCheckChange?.(!checked);
          }}
        >
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => {
              e.stopPropagation();
              onCheckChange?.(e.target.checked);
            }}
            className="rounded border-border h-4 w-4 cursor-pointer"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
      <div className={cn("flex items-start justify-between gap-2", batchMode && "pl-6")}>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground truncate">{skill.name}</span>
            <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", sourceBadge.bg, sourceBadge.text)}>
              {t(`sourceTypes.${skill.source_type}`)}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
            {truncate(skill.description || "", 80)}
          </p>
          {onAssignTag && onRemoveTag && (
            <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
              <InlineTagEditor
                targetType="skill"
                targetId={skill.id}
                tags={skill.tags || []}
                allTags={allTags}
                onAssign={onAssignTag}
                onRemove={onRemoveTag}
              />
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-xs text-muted-foreground">v{skill.current_ver || "?"}</span>
          <div className={cn("h-2 w-2 rounded-full", statusDotMap[syncStatus])} />
        </div>
      </div>
    </button>
  );
});

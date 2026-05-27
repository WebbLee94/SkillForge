import { memo } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/utils";
import type { SceneRule } from "../types";
import { GripVertical, X, ToggleLeft, ToggleRight } from "lucide-react";

interface SortableRuleListProps {
  rules: SceneRule[];
  onRemove: (ruleId: string) => void;
  onToggle: (ruleId: string) => void;
  onReorder: (rules: SceneRule[]) => void;
  disabled?: boolean;
}

export const SortableRuleList = memo(function SortableRuleList({
  rules,
  onRemove,
  onToggle,
  disabled = false,
}: SortableRuleListProps) {
  const { t } = useTranslation("scenes");

  if (rules.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        {t("dragHint")}
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {rules.map((rule, index) => (
        <div
          key={rule.rule_id}
          className={cn(
            "flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors",
            rule.enabled
              ? "border-border bg-card"
              : "border-border bg-muted/30 opacity-60",
          )}
          draggable={!disabled}
          onDragStart={(e) => {
            if (disabled) return;
            e.dataTransfer.setData("text/plain", index.toString());
            e.dataTransfer.effectAllowed = "move";
          }}
        >
          <GripVertical className={cn("h-4 w-4 shrink-0 text-muted-foreground", disabled ? "cursor-not-allowed opacity-30" : "cursor-grab")} />
          <span className="flex-1 text-sm text-foreground truncate">
            {rule.rule_name || rule.rule_id}
          </span>
          <button
            className={cn("shrink-0 transition-colors", disabled ? "cursor-not-allowed opacity-30" : "text-muted-foreground hover:text-primary")}
            onClick={() => !disabled && onToggle(rule.rule_id)}
            title={rule.enabled ? t("disable", "禁用") : t("enable", "启用")}
          >
            {rule.enabled ? (
              <ToggleRight className="h-4 w-4 text-primary" />
            ) : (
              <ToggleLeft className="h-4 w-4" />
            )}
          </button>
          {!disabled && (
            <button
              className="shrink-0 text-muted-foreground hover:text-error transition-colors"
              onClick={() => onRemove(rule.rule_id)}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
});

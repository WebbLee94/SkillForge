import { memo } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../stores/appStore";
import { X, AlertTriangle, Plus, Minus } from "lucide-react";
import { cn } from "../lib/utils";

export const SyncConfirmDialog = memo(function SyncConfirmDialog() {
  const { t: tc } = useTranslation("common");
  const pending = useAppStore((s) => s.pendingSyncConfirm);
  const resolveConfirm = useAppStore((s) => s.resolveSyncConfirm);

  if (!pending) return null;

  const { platforms, onConfirm } = pending;

  const totalRemove =
    platforms.reduce((s, p) => s + p.skills_to_remove.length + p.rules_to_remove.length, 0);
  const totalAdd =
    platforms.reduce((s, p) => s + p.skills_to_add.length + p.rules_to_add.length, 0);

  const handleCancel = () => {
    resolveConfirm?.(false);
  };

  const handleConfirm = () => {
    resolveConfirm?.(true);
    onConfirm?.();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[480px] max-h-[80vh] overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-xl animate-fade-in">
        <div className="flex items-center justify-between mb-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <AlertTriangle className="h-5 w-5 text-warning" />
            {tc("syncConfirm.title")}
          </h2>
          <button onClick={handleCancel} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mb-3 text-sm text-muted-foreground">{tc("syncConfirm.warning")}</p>

        <div className="space-y-3 mb-4">
          {platforms.map((p) => (
            <div key={p.platform_id} className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="text-sm font-medium text-foreground mb-2">{p.platform_name}</div>
              {p.skills_to_add.length > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-success mb-1">
                  <Plus className="h-3 w-3" />
                  {tc("syncConfirm.addSkills", { count: p.skills_to_add.length })}
                </div>
              )}
              {p.skills_to_remove.length > 0 && (
                <div className="text-xs text-warning mb-1">
                  <Minus className="h-3 w-3 inline mr-1" />
                  {tc("syncConfirm.removeSkills", { count: p.skills_to_remove.length })}:
                  <span className="text-muted-foreground ml-1">
                    {p.skills_to_remove.slice(0, 5).join(", ")}
                    {p.skills_to_remove.length > 5 && " ..."}
                  </span>
                </div>
              )}
              {p.rules_to_add.length > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-success">
                  <Plus className="h-3 w-3" />
                  {tc("syncConfirm.addRules", { count: p.rules_to_add.length })}
                </div>
              )}
              {p.rules_to_remove.length > 0 && (
                <div className="text-xs text-warning">
                  <Minus className="h-3 w-3 inline mr-1" />
                  {tc("syncConfirm.removeRules", { count: p.rules_to_remove.length })}:
                  <span className="text-muted-foreground ml-1">
                    {p.rules_to_remove.slice(0, 5).join(", ")}
                    {p.rules_to_remove.length > 5 && " ..."}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>

        <p className="mb-4 text-xs text-muted-foreground">
          {tc("syncConfirm.summary", { add: totalAdd, remove: totalRemove })}
        </p>

        <div className="flex justify-end gap-2">
          <button
            className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
            onClick={handleCancel}
          >
            {tc("actions.cancel")}
          </button>
          <button
            className={cn(
              "rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90",
            )}
            onClick={handleConfirm}
          >
            {tc("syncConfirm.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
});

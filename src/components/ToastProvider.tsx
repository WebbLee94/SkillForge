import { useAppStore } from "../stores/appStore";
import { cn } from "../lib/utils";
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from "lucide-react";

const iconMap = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
  warning: AlertTriangle,
};

const colorMap = {
  success: "border-success/30 bg-success/10 text-success",
  error: "border-error/30 bg-error/10 text-error",
  info: "border-primary/30 bg-primary/10 text-primary",
  warning: "border-warning/30 bg-warning/10 text-warning",
};

export function ToastProvider() {
  const toasts = useAppStore((s) => s.toasts);
  const removeToast = useAppStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => {
        const Icon = iconMap[toast.type];
        return (
          <div
            key={toast.id}
            className={cn(
              "animate-slide-in-bottom flex items-center gap-2 rounded-lg border px-4 py-3 shadow-lg",
              "min-w-[280px] max-w-[400px]",
              colorMap[toast.type],
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-sm">{toast.message}</span>
            <button
              className="shrink-0 opacity-60 hover:opacity-100"
              onClick={() => removeToast(toast.id)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

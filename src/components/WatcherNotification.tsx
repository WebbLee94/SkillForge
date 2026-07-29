import { useEffect, useState } from 'react';
import { useWatcherStore } from '../stores/watcherStore';
import { useAppStore } from '../stores/appStore';
import { X, AlertTriangle } from 'lucide-react';

const dismissedEventIds = new Set<number>();

export function WatcherNotification() {
  const events = useWatcherStore((s) => s.events);
  const setActiveNav = useAppStore((s) => s.setActiveNav);
  const [visible, setVisible] = useState(false);

  const activeEvents = events.filter((e) => !dismissedEventIds.has(e.id));
  const activeCount = activeEvents.length;

  useEffect(() => {
    if (activeCount > 0) {
      setVisible(true);
    }
  }, [activeCount]);

  if (!visible || activeCount === 0) return null;

  const newCount = activeEvents.filter((e) => e.event_type === 'NEW').length;
  const deletedCount = activeEvents.filter(
    (e) => e.event_type === 'DELETED'
  ).length;
  const modifiedCount = activeEvents.filter(
    (e) => e.event_type === 'MODIFIED'
  ).length;

  const handleDismiss = () => {
    activeEvents.forEach((e) => dismissedEventIds.add(e.id));
    setVisible(false);
  };

  const handleGoDashboard = () => {
    setVisible(false);
    setActiveNav('dashboard');
  };

  return (
    <div className="fixed top-4 right-4 z-50 max-w-sm bg-card border border-border rounded-lg shadow-lg p-4 animate-in fade-in slide-in-from-top-2">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-yellow-500 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">检测到 {activeCount} 个文件变更</p>
          <p className="text-xs text-muted-foreground mt-1">
            {newCount > 0 && `+${newCount} 新增 `}
            {deletedCount > 0 && `-${deletedCount} 已删除 `}
            {modifiedCount > 0 && `~${modifiedCount} 已修改`}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            前往看板使用「一键导入」将新增技能加入技能库
          </p>
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleGoDashboard}
              className="text-xs px-2 py-1 bg-primary text-primary-foreground rounded hover:bg-primary/90"
            >
              前往看板
            </button>
            <button
              onClick={handleDismiss}
              className="text-xs px-2 py-1 bg-secondary text-secondary-foreground rounded hover:bg-secondary/80"
            >
              忽略
            </button>
          </div>
        </div>
        <button
          onClick={handleDismiss}
          className="text-muted-foreground hover:text-foreground shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

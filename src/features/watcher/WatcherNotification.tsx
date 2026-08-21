import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWatcherStore } from '../../stores/watcherStore';
import { useAppStore } from '../../stores/appStore';
import { X, AlertTriangle } from 'lucide-react';

const dismissedEventIds = new Set<number>();

export function WatcherNotification() {
  const { t } = useTranslation('common');
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
          <p className="text-sm font-medium">{t('watcher.changesDetected', { count: activeCount })}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {newCount > 0 && t('watcher.newFiles', { count: newCount }) + ' '}
            {deletedCount > 0 && t('watcher.deletedFiles', { count: deletedCount }) + ' '}
            {modifiedCount > 0 && t('watcher.modifiedFiles', { count: modifiedCount })}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('watcher.importHint')}
          </p>
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleGoDashboard}
              className="text-xs px-2 py-1 bg-primary text-primary-foreground rounded hover:bg-primary/90"
            >
              {t('watcher.goToDashboard')}
            </button>
            <button
              onClick={handleDismiss}
              className="text-xs px-2 py-1 bg-secondary text-secondary-foreground rounded hover:bg-secondary/80"
            >
              {t('watcher.dismiss')}
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

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Command } from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { ShortcutDialog } from './ShortcutDialog';

/** activeNav → 面包屑第一段（所属分组）。与 Sidebar navGroups 保持一致。 */
const BREADCRUMB_GROUP: Record<string, string> = {
  dashboard: 'navGroups.overview',
  globalDistribution: 'navGroups.distribution',
  projectDistribution: 'navGroups.distribution',
  scenes: 'navGroups.orchestration',
  skills: 'navGroups.resources',
  rules: 'navGroups.resources',
  settings: 'navGroups.system',
};

export function Topbar() {
  const { t } = useTranslation('common');
  const activeNav = useAppStore((s) => s.activeNav);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const groupKey = BREADCRUMB_GROUP[activeNav] ?? 'navGroups.overview';

  return (
    <>
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-card px-4">
        <nav
          aria-label="breadcrumb"
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <span>{t(groupKey)}</span>
          <span className="text-muted-foreground/50">/</span>
          <span className="font-medium text-foreground">
            {t(`breadcrumb.${activeNav}`)}
          </span>
        </nav>
        <button
          className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent transition-colors"
          onClick={() => setShowShortcuts(true)}
        >
          <Command className="h-3.5 w-3.5" />
          {t('shortcuts.title')}
        </button>
      </header>
      <ShortcutDialog
        open={showShortcuts}
        onClose={() => setShowShortcuts(false)}
      />
    </>
  );
}

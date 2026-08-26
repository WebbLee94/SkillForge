import { useTranslation } from 'react-i18next';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useAppStore } from '../stores/appStore';

/** activeNav → 面包屑第一段（所属分组）。与 Sidebar navGroups 保持一致。 */
const BREADCRUMB_GROUP: Record<string, string> = {
  dashboard: 'navGroups.overview',
  globalDistribution: 'navGroups.distribution',
  projectDistribution: 'navGroups.distribution',
  scenes: 'navGroups.orchestration',
  skills: 'navGroups.resources',
  rules: 'navGroups.resources',
  settings: 'navGroups.settings',
};

export function Topbar() {
  const { t } = useTranslation('common');
  const activeNav = useAppStore((s) => s.activeNav);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);

  const groupKey = BREADCRUMB_GROUP[activeNav] ?? 'navGroups.overview';
  const collapseLabel = sidebarCollapsed
    ? t('topbar.collapse.expand')
    : t('topbar.collapse.collapse');

  return (
    <header
      data-testid="app-topbar"
      className="flex h-[52px] shrink-0 items-center justify-between border-b border-border bg-card px-8"
    >
      <div className="flex items-center gap-1.5">
        <button
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label={collapseLabel}
          title={collapseLabel}
          onClick={toggleSidebar}
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
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
      </div>
    </header>
  );
}

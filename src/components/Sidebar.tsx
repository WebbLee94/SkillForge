import { useTranslation } from 'react-i18next';
import { useAppStore } from '../stores/appStore';
import { cn } from '../lib/utils';
import {
  LayoutDashboard,
  Package,
  FileText,
  Film,
  Globe,
  FolderOpen,
  Settings,
} from 'lucide-react';
import { AppLogo } from './AppLogo';
import type { ReactNode } from 'react';

interface NavItem {
  key: string;
  icon: ReactNode;
}

const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: 'navGroups.overview',
    items: [
      { key: 'dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
    ],
  },
  {
    label: 'navGroups.distribution',
    items: [
      { key: 'globalDistribution', icon: <Globe className="h-4 w-4" /> },
      { key: 'projectDistribution', icon: <FolderOpen className="h-4 w-4" /> },
    ],
  },
  {
    label: 'navGroups.orchestration',
    items: [{ key: 'scenes', icon: <Film className="h-4 w-4" /> }],
  },
  {
    label: 'navGroups.resources',
    items: [
      { key: 'skills', icon: <Package className="h-4 w-4" /> },
      { key: 'rules', icon: <FileText className="h-4 w-4" /> },
    ],
  },
];

const settingsItem: NavItem = {
  key: 'settings',
  icon: <Settings className="h-4 w-4" />,
};

export function Sidebar() {
  const { t } = useTranslation('common');
  const activeNav = useAppStore((s) => s.activeNav);
  const setActiveNav = useAppStore((s) => s.setActiveNav);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);

  return (
    <aside
      className={cn(
        'flex h-full flex-col border-r border-sidebar-border bg-sidebar',
        'transition-all duration-300 ease-in-out',
        sidebarCollapsed ? 'w-[64px]' : 'w-[200px]'
      )}
    >
      {/* Header */}
      <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
        <AppLogo className="h-6 w-6 shrink-0" />
        {!sidebarCollapsed && (
          <div className="flex flex-col overflow-hidden">
            <span className="text-sm font-bold text-foreground">
              {t('app.name')}
            </span>
            <span className="text-xs text-muted-foreground">
              {t('app.subtitle')}
            </span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2">
        {navGroups.map((group) => (
          <div key={group.label} className="mb-2">
            {!sidebarCollapsed && (
              <div className="mb-1 px-4 pt-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t(group.label)}
              </div>
            )}
            {sidebarCollapsed && (
              <div className="my-1 mx-3 border-t border-sidebar-border" />
            )}
            {group.items.map((item) => (
              <button
                key={item.key}
                className={cn(
                  'flex w-full items-center gap-3 px-4 py-2 text-sm transition-colors',
                  sidebarCollapsed ? 'justify-center px-0' : '',
                  activeNav === item.key
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-sidebar-foreground hover:bg-accent'
                )}
                onClick={() => setActiveNav(item.key)}
                title={sidebarCollapsed ? t(`nav.${item.key}`) : undefined}
              >
                <span className="shrink-0">{item.icon}</span>
                {!sidebarCollapsed && <span>{t(`nav.${item.key}`)}</span>}
              </button>
            ))}
          </div>
        ))}
      </nav>

      {/* Footer: settings */}
      <div
        data-testid="sidebar-footer"
        className="border-t border-sidebar-border"
      >
        <button
          className={cn(
            'flex w-full items-center gap-3 px-4 py-2 text-sm transition-colors',
            sidebarCollapsed ? 'justify-center px-0' : '',
            activeNav === 'settings'
              ? 'bg-primary/10 text-primary font-medium'
              : 'text-sidebar-foreground hover:bg-accent'
          )}
          onClick={() => setActiveNav('settings')}
          title={sidebarCollapsed ? t(`nav.${settingsItem.key}`) : undefined}
        >
          <span className="shrink-0">{settingsItem.icon}</span>
          {!sidebarCollapsed && <span>{t(`nav.${settingsItem.key}`)}</span>}
        </button>
      </div>
    </aside>
  );
}

import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { ToastProvider } from './ToastProvider';
import { Topbar } from './Topbar';
import { useTheme } from '../hooks/useTheme';

export function AppShell() {
  useTheme();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-hidden">
          <div
            data-testid="app-content"
            className="h-full px-4 py-5 md:px-8"
          >
            <Outlet />
          </div>
        </main>
      </div>
      <ToastProvider />
    </div>
  );
}

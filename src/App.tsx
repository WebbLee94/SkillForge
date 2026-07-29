import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useNavigate,
} from 'react-router-dom';
import { useEffect } from 'react';
import { AppShell } from './components/AppShell';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Dashboard } from './pages/Dashboard';
import { SkillLibrary } from './pages/SkillLibrary';
import { RulesManager } from './pages/RulesManager';
import { SceneEditor } from './pages/SceneEditor';
import { GlobalDistribution } from './pages/GlobalDistribution';
import { ProjectDistribution } from './pages/ProjectDistribution';
import { Settings } from './pages/Settings';
import { useAppStore } from './stores/appStore';
import { useWatcherStore } from './stores/watcherStore';
import { SyncConfirmDialog } from './components/SyncConfirmDialog';

const routeToNavMap: Record<string, string> = {
  '/': 'dashboard',
  '/skills': 'skills',
  '/rules': 'rules',
  '/scenes': 'scenes',
  '/global-distribution': 'globalDistribution',
  '/project-distribution': 'projectDistribution',
  '/settings': 'settings',
};

const navToRouteMap: Record<string, string> = {
  dashboard: '/',
  skills: '/skills',
  rules: '/rules',
  scenes: '/scenes',
  globalDistribution: '/global-distribution',
  projectDistribution: '/project-distribution',
  settings: '/settings',
};

function NavSync() {
  const activeNav = useAppStore((s) => s.activeNav);
  const navigate = useNavigate();

  // Sync store nav -> browser URL
  useEffect(() => {
    const target = navToRouteMap[activeNav];
    if (target && window.location.pathname !== target) {
      navigate(target, { replace: true });
    }
  }, [activeNav, navigate]);

  // Sync browser URL -> store nav on popstate
  useEffect(() => {
    const handlePopState = () => {
      const nav = routeToNavMap[window.location.pathname];
      if (nav) {
        useAppStore.getState().setActiveNav(nav);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  return null;
}

function App() {
  useEffect(() => {
    const setup = async () => {
      const unlisten = await useWatcherStore.getState().listenToWatcher();
      useWatcherStore.getState().fetchEvents();
      return unlisten;
    };
    const unlistenPromise = setup();
    return () => {
      unlistenPromise.then((fn) => fn()).catch(() => {});
    };
  }, []);

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <NavSync />
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/skills" element={<SkillLibrary />} />
            <Route path="/rules" element={<RulesManager />} />
            <Route path="/scenes" element={<SceneEditor />} />
            <Route
              path="/global-distribution"
              element={<GlobalDistribution />}
            />
            <Route
              path="/project-distribution"
              element={<ProjectDistribution />}
            />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
        <SyncConfirmDialog />
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;

import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useNavigate,
} from 'react-router-dom';
import { useEffect } from 'react';
import { AppShell } from './app/AppShell';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { Dashboard } from './pages/Dashboard';
import { SkillLibrary } from './pages/SkillLibrary';
import { RulesManager } from './pages/RulesManager';
import { SceneEditor } from './pages/SceneEditor';
import { GlobalDistribution } from './pages/GlobalDistribution';
import { ProjectDistribution } from './pages/ProjectDistribution';
import { Settings } from './pages/Settings';
import { useAppStore } from './stores/appStore';
import { useWatcherStore } from './stores/watcherStore';
import { SyncConfirmDialog } from './app/SyncConfirmDialog';

const routeToNavMap: Record<string, string> = {
  '/': 'dashboard',
  '/skills': 'skills',
  '/rules': 'rules',
  '/scenes': 'scenes',
  '/workspace': 'globalDistribution',
  '/projects': 'projectDistribution',
  '/settings': 'settings',
};

const navToRouteMap: Record<string, string> = {
  dashboard: '/',
  skills: '/skills',
  rules: '/rules',
  scenes: '/scenes',
  globalDistribution: '/workspace',
  projectDistribution: '/projects',
  settings: '/settings',
};

function NavSync() {
  const activeNav = useAppStore((s) => s.activeNav);
  const navigate = useNavigate();

  // Sync store nav -> browser URL
  useEffect(() => {
    const target = navToRouteMap[activeNav];
    if (!target) return;
    let url = target;
    if (activeNav === 'globalDistribution') {
      const pid = useAppStore.getState().globalDistSelectedPlatform;
      if (pid) url = `${target}?platform=${encodeURIComponent(pid)}`;
    }
    const sameUrl =
      window.location.pathname === target &&
      window.location.search === url.slice(target.length);
    if (!sameUrl) {
      navigate(url, { replace: true });
    }
  }, [activeNav, navigate]);

  useEffect(() => {
    const syncFromUrl = () => {
      const nav = routeToNavMap[window.location.pathname];
      if (nav) {
        useAppStore.getState().setActiveNav(nav);
      }
      const params = new URLSearchParams(window.location.search);
      const pid = params.get('platform');
      if (pid) {
        useAppStore.getState().setGlobalDistSelectedPlatform(pid);
      }
    };
    syncFromUrl();
    window.addEventListener('popstate', syncFromUrl);
    return () => window.removeEventListener('popstate', syncFromUrl);
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
            <Route path="/workspace" element={<GlobalDistribution />} />
            <Route path="/projects" element={<ProjectDistribution />} />
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

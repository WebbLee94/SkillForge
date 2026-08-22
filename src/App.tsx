import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useNavigate,
} from 'react-router-dom';
import { Suspense, lazy, useEffect } from 'react';
import type { ComponentType } from 'react';
import { AppShell } from './app/AppShell';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { useAppStore } from './stores/appStore';
import { useWatcherStore } from './stores/watcherStore';
import { SyncConfirmDialog } from './app/SyncConfirmDialog';

function lazyNamed<T extends Record<string, ComponentType<Record<string, never>>>>(
  loader: () => Promise<T>,
  exportName: keyof T
) {
  return lazy(async () => {
    const module = await loader();
    return { default: module[exportName] };
  });
}

const Dashboard = lazyNamed(() => import('./domains/dashboard/Dashboard'), 'Dashboard');
const SkillLibrary = lazyNamed(() => import('./pages/SkillLibrary'), 'SkillLibrary');
const RulesManager = lazyNamed(() => import('./pages/RulesManager'), 'RulesManager');
const SceneEditor = lazyNamed(() => import('./domains/scenes/SceneEditor'), 'SceneEditor');
const GlobalDistribution = lazyNamed(
  () => import('./domains/distribution/GlobalDistribution'),
  'GlobalDistribution'
);
const ProjectDistribution = lazyNamed(
  () => import('./domains/distribution/ProjectDistribution'),
  'ProjectDistribution'
);
const Settings = lazyNamed(() => import('./domains/settings/Settings'), 'Settings');

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
            <Route path="/" element={<Suspense fallback={null}><Dashboard /></Suspense>} />
            <Route path="/skills" element={<Suspense fallback={null}><SkillLibrary /></Suspense>} />
            <Route path="/rules" element={<Suspense fallback={null}><RulesManager /></Suspense>} />
            <Route path="/scenes" element={<Suspense fallback={null}><SceneEditor /></Suspense>} />
            <Route path="/workspace" element={<Suspense fallback={null}><GlobalDistribution /></Suspense>} />
            <Route path="/projects" element={<Suspense fallback={null}><ProjectDistribution /></Suspense>} />
            <Route path="/settings" element={<Suspense fallback={null}><Settings /></Suspense>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
        <SyncConfirmDialog />
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;

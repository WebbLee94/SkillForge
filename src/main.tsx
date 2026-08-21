import ReactDOM from 'react-dom/client';
import './index.css';
import './lib/i18n';

import App from './App';

if (import.meta.env.VITE_E2E === 'true') {
  console.info('[SkillForge] loading wdio tauri plugin');
  const wdioPlugin = await import('@wdio/tauri-plugin');
  console.info('[SkillForge] wdio tauri plugin module loaded');
  await wdioPlugin.init();
  console.info('[SkillForge] wdio tauri plugin init complete', {
    hasWdioTauri: typeof window.wdioTauri !== 'undefined',
    hasWdioExecute: typeof window.wdioTauri?.execute === 'function',
    hasOriginalCore: typeof window.__wdio_original_core__ !== 'undefined',
  });
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <App />
);

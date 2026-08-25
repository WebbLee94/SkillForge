import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// keep track of the vite dev server
let viteServer;

// Windows 下 npm 实为 npm.cmd，裸 spawn 会 ENOENT，必须经 shell 启动
const IS_WINDOWS = process.platform === 'win32';

// Driver provider: CI runs tauri-driver externally (external), local dev defaults to embedded
const driverProvider = process.env.WDIO_DRIVER_PROVIDER || 'embedded';

// App binary name differs on Windows
const binaryName = IS_WINDOWS ? 'skillforge.exe' : 'skillforge';

/**
 * 相对路径以仓库根（__dirname/..）为基准而非 process.cwd()：
 * CI 中 wdio 可能从不同目录启动（根目录 test:e2e 内部会 cd 到 e2e/、
 * 直接在 e2e/ 下执行、或经 xvfb-run 包装），而 workflow 里
 * APP_BINARY_PATH 均按仓库根相对路径书写。
 */
export function resolveAppBinaryPath(envValue, fallback = binaryName) {
  const raw = typeof envValue === 'string' ? envValue.trim() : '';
  if (!raw) {
    return path.resolve(__dirname, '../src-tauri/target/debug', fallback);
  }
  return path.isAbsolute(raw) ? raw : path.resolve(__dirname, '..', raw);
}

// Allow CI to override the app binary path (e.g. cross-platform artifact paths)
const appBinaryPath = resolveAppBinaryPath(process.env.APP_BINARY_PATH);

export const config = {
  runner: 'local',
  specs: ['./specs/**/*.spec.js'],
  exclude: [],
  maxInstances: 1,

  services: [
    [
      '@wdio/tauri-service',
      {
        appBinaryPath,
        driverProvider,
        tauriDriverPort: 4444,
        captureBackendLogs: true,
        captureFrontendLogs: true,
        backendLogLevel: 'info',
        frontendLogLevel: 'info',
      },
    ],
  ],

  capabilities: [
    {
      browserName: 'tauri',
      'tauri:options': {
        application: appBinaryPath,
      },
    },
  ],

  logLevel: 'error',
  logLevels: {
    'tauri-service:service': 'error',
  },
  bail: 0,
  baseUrl: 'http://localhost:1420',
  waitforTimeout: 20000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,

  framework: 'mocha',
  mochaOpts: {
    ui: 'bdd',
    timeout: 120000,
  },

  reporters: ['spec'],

  // Start the Vite dev server before the session so the app binary can load its frontend
  onPrepare: () => {
    viteServer = spawn('npm', ['run', 'dev'], {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'ignore',
      detached: true,
      shell: IS_WINDOWS,
      env: { ...process.env, VITE_E2E: 'true' },
    });
    // Give Vite time to boot
    return new Promise((resolve) => setTimeout(resolve, 6000));
  },

  onComplete: () => {
    if (!viteServer) {
      return;
    }
    if (!IS_WINDOWS) {
      viteServer.kill('SIGTERM');
      return;
    }
    // shell:true 时 PID 是 cmd.exe 外壳，SIGTERM 只能杀到外壳、会遗留 node/vite
    // 子进程并占用 1420 端口；taskkill /T 连整棵进程树一起结束。
    // 失败仅告警不抛错——进程可能已自行退出，清理错误不应掩盖真实测试结果。
    try {
      execFileSync('taskkill', ['/pid', String(viteServer.pid), '/T', '/F'], {
        stdio: 'ignore',
      });
    } catch (err) {
      console.error(`[wdio] 停止 Vite dev server 失败: ${err.message}`);
    }
  },
};

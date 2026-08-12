import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// keep track of the vite dev server
let viteServer;

// Driver provider: CI runs tauri-driver externally (external), local dev defaults to embedded
const driverProvider = process.env.WDIO_DRIVER_PROVIDER || 'embedded';

// App binary name differs on Windows
const binaryName = process.platform === 'win32' ? 'skillforge.exe' : 'skillforge';

// Allow CI to override the app binary path (e.g. cross-platform artifact paths)
const appBinaryPath = process.env.APP_BINARY_PATH
  ? path.resolve(process.env.APP_BINARY_PATH)
  : path.resolve(__dirname, '../src-tauri/target/debug', binaryName);

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

  logLevel: 'info',
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
      env: { ...process.env, VITE_E2E: 'true' },
    });
    // Give Vite time to boot
    return new Promise((resolve) => setTimeout(resolve, 6000));
  },

  onComplete: () => {
    if (viteServer) {
      viteServer.kill('SIGTERM');
    }
  },
};

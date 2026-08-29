import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();

const secret = process.env.TAURI_SIGNING_PRIVATE_KEY?.trim();
if (!secret) {
  console.error('TAURI_SIGNING_PRIVATE_KEY is required for verify:release');
  process.exit(1);
}

const password = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD?.trim() ?? '';
const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'skillforge-verify-release-'));
const keyPath = path.join(tmpDir, 'updater.key');
const overlayPath = path.join(tmpDir, 'tauri.release.conf.json');

const prepareKey = spawnSync('node', ['scripts/prepare-updater-key.mjs', keyPath], {
  cwd: root,
  stdio: 'inherit',
  shell: false,
  env: {
    ...process.env,
    TAURI_SIGNING_PRIVATE_KEY: secret,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password,
  },
});

if ((prepareKey.status ?? 1) !== 0) {
  process.exit(prepareKey.status ?? 1);
}

const overlay = spawnSync('node', ['scripts/write-release-config.mjs', overlayPath, 'true'], {
  cwd: root,
  stdio: 'inherit',
  shell: false,
});

if ((overlay.status ?? 1) !== 0) {
  process.exit(overlay.status ?? 1);
}

const build = spawnSync('npm', ['run', 'tauri', '--', 'build', '--config', overlayPath], {
  cwd: root,
  stdio: 'inherit',
  shell: false,
  env: {
    ...process.env,
    TAURI_SIGNING_PRIVATE_KEY: keyPath,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password,
  },
});

process.exit(build.status ?? 1);

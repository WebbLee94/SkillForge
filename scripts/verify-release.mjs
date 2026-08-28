import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'skillforge-verify-release-'));
const keyPath = path.join(tmpDir, 'updater.key');

const secret = process.env.TAURI_SIGNING_PRIVATE_KEY?.trim();
if (!secret) {
  console.error('TAURI_SIGNING_PRIVATE_KEY is required for verify:release');
  process.exit(1);
}

writeFileSync(keyPath, secret, 'utf8');

const build = spawnSync('npm', ['run', 'tauri', 'build'], {
  cwd: root,
  stdio: 'inherit',
  shell: false,
  env: {
    ...process.env,
    TAURI_SIGNING_PRIVATE_KEY: keyPath,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? '',
  },
});

process.exit(build.status ?? 1);

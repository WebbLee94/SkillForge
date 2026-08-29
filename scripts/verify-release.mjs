import { spawnSync } from 'node:child_process';
import process from 'node:process';

const root = process.cwd();

const secret = process.env.TAURI_SIGNING_PRIVATE_KEY?.trim();
if (!secret) {
  console.error('TAURI_SIGNING_PRIVATE_KEY is required for verify:release');
  process.exit(1);
}

const build = spawnSync('npm', ['run', 'tauri', 'build'], {
  cwd: root,
  stdio: 'inherit',
  shell: false,
  env: {
    ...process.env,
    TAURI_SIGNING_PRIVATE_KEY: secret,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD:
      process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD?.trim() ?? '',
  },
});

process.exit(build.status ?? 1);

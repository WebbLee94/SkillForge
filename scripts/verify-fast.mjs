import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const steps = [
  {
    command: 'npm',
    args: [
      'run',
      'test',
      '--',
      'src/lib/__tests__/i18n.test.ts',
      'src/pages/__tests__/Settings.test.tsx',
      'src/domains/distribution/__tests__/DistributionWorkspace.test.tsx',
    ],
  },
  { command: 'npm', args: ['run', 'build'] },
  {
    command: 'cargo',
    args: ['test'],
    cwd: path.join(process.cwd(), 'src-tauri'),
  },
];

for (const step of steps) {
  const result = spawnSync(step.command, step.args, {
    stdio: 'inherit',
    shell: false,
    cwd: step.cwd,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

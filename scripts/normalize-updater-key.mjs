import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const [firstArg, secondArg] = process.argv.slice(2);

const inputPath = firstArg && secondArg ? firstArg : null;
const outputPath = firstArg && secondArg ? secondArg : firstArg ?? null;

if (!outputPath) {
  console.error(
    'usage: node scripts/normalize-updater-key.mjs [<input>] <output>'
  );
  process.exit(1);
}

const rawSource = inputPath
  ? readFileSync(resolve(inputPath), 'utf8')
  : process.env.TAURI_SIGNING_PRIVATE_KEY ?? '';
const raw = rawSource.replace(/\r\n/g, '\n').replace(/\n$/, '');

if (!raw) {
  console.error('updater key is empty');
  process.exit(1);
}

const normalized = raw;

writeFileSync(resolve(outputPath), normalized, 'utf8');

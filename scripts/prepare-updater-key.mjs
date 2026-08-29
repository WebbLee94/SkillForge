import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const [firstArg, secondArg] = process.argv.slice(2);

const inputPath = firstArg && secondArg ? firstArg : null;
const outputPath = firstArg && secondArg ? secondArg : firstArg ?? null;

if (!outputPath) {
  console.error('用法: node scripts/prepare-updater-key.mjs [<input>] <output>');
  process.exit(1);
}

const rawSource = inputPath
  ? readFileSync(resolve(inputPath), 'utf8')
  : process.env.TAURI_SIGNING_PRIVATE_KEY ?? '';

let normalized = rawSource.replace(/\r\n/g, '\n').trim();

if (!normalized.startsWith('untrusted comment:')) {
  const maybePath = resolve(normalized);
  if (existsSync(maybePath)) {
    normalized = readFileSync(maybePath, 'utf8').replace(/\r\n/g, '\n').trim();
  }
}

if (!normalized) {
  console.error('TAURI_SIGNING_PRIVATE_KEY is empty');
  process.exit(1);
}

const [firstLine = ''] = normalized.split('\n');
if (!firstLine.startsWith('untrusted comment:')) {
  console.error(
    'TAURI_SIGNING_PRIVATE_KEY must be raw minisign key content (first line must start with "untrusted comment:") or a valid key file path'
  );
  process.exit(1);
}

const password = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD?.trim() ?? '';
if (firstLine.includes('encrypted') && !password) {
  console.error(
    'TAURI_SIGNING_PRIVATE_KEY_PASSWORD is required because the updater private key is encrypted'
  );
  process.exit(1);
}

if (outputPath) {
  writeFileSync(resolve(outputPath), `${normalized}\n`, 'utf8');
} else {
  process.stdout.write(`${normalized}\n`);
}

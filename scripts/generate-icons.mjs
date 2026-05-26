import sharp from 'sharp';
import { execSync } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tauriDir = join(__dirname, '..', 'src-tauri');
const iconsDir = join(tauriDir, 'icons');
const svgSource = join(iconsDir, 'icon.svg');
const pngSource = join(tauriDir, 'icon-source.png');

async function main() {
  // Convert SVG to 1024x1024 PNG
  await sharp(svgSource)
    .resize(1024, 1024)
    .png()
    .toFile(pngSource);
  console.log('Generated icon-source.png (1024×1024)');

  // Run tauri icon to generate all platform variants
  console.log('Running tauri icon...');
  execSync('npx tauri icon icon-source.png', {
    cwd: join(__dirname, '..', 'src-tauri'),
    stdio: 'inherit'
  });

  // Clean up the intermediate PNG
  if (existsSync(pngSource)) {
    unlinkSync(pngSource);
    console.log('Cleaned up icon-source.png');
  }

  console.log('Done! All platform icons generated.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

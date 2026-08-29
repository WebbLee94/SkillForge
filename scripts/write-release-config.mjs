import { writeFileSync } from 'node:fs';
import process from 'node:process';

const [outputPath, updaterArtifactsFlag = 'false'] = process.argv.slice(2);

if (!outputPath) {
  console.error('用法: node scripts/write-release-config.mjs <output-path>');
  process.exit(1);
}

const config = {
  bundle: {
    createUpdaterArtifacts: updaterArtifactsFlag === 'true',
  },
};

writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

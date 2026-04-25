import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const e2eDistDir = '.next-e2e';

process.env.NEXT_DIST_DIR = e2eDistDir;
process.env.NEXT_PUBLIC_API_URL = 'http://127.0.0.1:3101';

const nextBin = join(
  process.cwd(),
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'next.cmd' : 'next',
);

const result = spawnSync(nextBin, ['build'], {
  env: process.env,
  shell: process.platform === 'win32',
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error);
}

if (result.status === 0) {
  copyStandaloneAsset(`${e2eDistDir}/static`, `${e2eDistDir}/standalone/${e2eDistDir}/static`);
  copyStandaloneAsset('public', `${e2eDistDir}/standalone/public`);
}

process.exit(result.status ?? 1);

function copyStandaloneAsset(sourcePath, targetPath) {
  const source = join(process.cwd(), sourcePath);
  const target = join(process.cwd(), targetPath);

  if (!existsSync(source)) {
    return;
  }

  rmSync(target, { force: true, recursive: true });
  cpSync(source, target, { recursive: true });
}

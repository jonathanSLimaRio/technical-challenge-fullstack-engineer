import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

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

process.exit(result.status ?? 1);

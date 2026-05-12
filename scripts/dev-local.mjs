import { execFileSync, spawn } from 'node:child_process';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const port = process.env.PORT ?? '8788';

execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
execFileSync('npm', ['run', 'cf:db:local'], { cwd: repoRoot, stdio: 'inherit' });

const devProcess = spawn(
  'npx',
  ['wrangler', 'dev', '--local', '--ip', 'localhost', '--port', port],
  {
    cwd: repoRoot,
    stdio: 'inherit',
  },
);

devProcess.on('exit', (code) => {
  process.exit(code ?? 0);
});

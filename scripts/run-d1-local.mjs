import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const wranglerConfig = JSON.parse(readFileSync(resolve(repoRoot, 'wrangler.jsonc'), 'utf8'));
const databaseName = wranglerConfig.d1_databases?.[0]?.database_name;

if (!databaseName) {
  console.error('No se encontro d1_databases[0].database_name en wrangler.jsonc');
  process.exit(1);
}

execFileSync(
  'npx',
  ['wrangler', 'd1', 'execute', databaseName, '--local', '--file=schema.sql'],
  {
    cwd: repoRoot,
    stdio: 'inherit',
  },
);

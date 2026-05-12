import { spawn } from 'node:child_process';
import { existsSync, statSync, watch } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const watchedPaths = ['src', 'public', 'index.html']
  .map((entry) => resolve(repoRoot, entry))
  .filter((entry) => existsSync(entry));

let buildInFlight = false;
let buildQueued = false;
let debounceTimer = null;

function runBuild() {
  if (buildInFlight) {
    buildQueued = true;
    return;
  }

  buildInFlight = true;
  const child = spawn('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });

  child.on('exit', () => {
    buildInFlight = false;
    if (buildQueued) {
      buildQueued = false;
      runBuild();
    }
  });
}

function scheduleBuild() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    runBuild();
  }, 2500);
}

runBuild();

for (const target of watchedPaths) {
  watch(target, { recursive: statSync(target).isDirectory() }, () => {
    scheduleBuild();
  });
}

console.log('Observando cambios para rebuild con debounce de 2500ms...');

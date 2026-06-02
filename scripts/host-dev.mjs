import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { installMissingModuleNpmDependencies } from './lib/module-dependencies.mjs';

const PROJECT_ROOT = process.cwd();

function runNode(script, args = []) {
  const result = childProcess.spawnSync(process.execPath, [script, ...args], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function startNextDev() {
  const nextBin = path.join(PROJECT_ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
  const command = fs.existsSync(nextBin) ? process.execPath : process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const args = fs.existsSync(nextBin)
    ? [nextBin, 'dev', 'apps/host-next']
    : ['next', 'dev', 'apps/host-next'];

  const child = childProcess.spawn(command, args, {
    cwd: PROJECT_ROOT,
    env: process.env,
    stdio: 'inherit',
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
  child.on('error', (error) => {
    console.error(error.message);
    process.exit(1);
  });
}

try {
  const result = installMissingModuleNpmDependencies(PROJECT_ROOT);
  if (result.installed.length > 0) {
    console.log(`Installed module npm dependencies: ${result.installed.join(', ')}`);
  }
  runNode(path.join('scripts', 'generate-module-map.mjs'));
  startNextDev();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

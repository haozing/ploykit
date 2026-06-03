import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { installMissingModuleNpmDependencies } from './lib/module-dependencies.mjs';

const PROJECT_ROOT = process.cwd();
const HOST_APP_DIR = path.join(PROJECT_ROOT, 'apps', 'host-next');
const HOST_STANDALONE_DIR = path.join(
  HOST_APP_DIR,
  '.next',
  'standalone',
  'apps',
  'host-next'
);

function assertInsideProject(targetPath) {
  const resolved = path.resolve(targetPath);
  const relative = path.relative(PROJECT_ROOT, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to write outside project: ${resolved}`);
  }
  return resolved;
}

function run(command, args) {
  const result = childProcess.spawnSync(command, args, {
    cwd: PROJECT_ROOT,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runNode(script, args = []) {
  run(process.execPath, [script, ...args]);
}

function copyDirectory(source, destination) {
  if (!fs.existsSync(source)) {
    return;
  }
  const target = assertInsideProject(destination);
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
}

const installed = installMissingModuleNpmDependencies(PROJECT_ROOT).installed;
if (installed.length > 0) {
  console.log(`Installed module npm dependencies: ${installed.join(', ')}`);
}

runNode(path.join('scripts', 'generate-module-map.mjs'));

const nextBin = path.join(PROJECT_ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
if (fs.existsSync(nextBin)) {
  run(process.execPath, [nextBin, 'build', 'apps/host-next']);
} else {
  run(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['next', 'build', 'apps/host-next']);
}

const serverFile = path.join(HOST_STANDALONE_DIR, 'server.js');
if (!fs.existsSync(serverFile)) {
  throw new Error(`Standalone server was not generated: ${serverFile}`);
}

copyDirectory(
  path.join(HOST_APP_DIR, '.next', 'static'),
  path.join(HOST_STANDALONE_DIR, '.next', 'static')
);
copyDirectory(path.join(HOST_APP_DIR, 'public'), path.join(HOST_STANDALONE_DIR, 'public'));
copyDirectory(path.join(PROJECT_ROOT, 'migrations'), path.join(HOST_STANDALONE_DIR, 'migrations'));

console.log(`Standalone host is ready: ${serverFile}`);

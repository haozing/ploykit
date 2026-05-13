import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';

const root = process.cwd();
const standaloneRoot = resolve(root, '.next', 'standalone');

function copyDirectory(source: string, target: string): void {
  if (!existsSync(source)) {
    return;
  }

  rmSync(target, { recursive: true, force: true });
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
}

function writePluginModuleMetadata(): void {
  const pluginsRoot = resolve(standaloneRoot, 'plugins');

  if (!existsSync(pluginsRoot)) {
    return;
  }

  const metadata = `${JSON.stringify({ type: 'module' }, null, 2)}\n`;

  for (const entry of readdirSync(pluginsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    writeFileSync(resolve(pluginsRoot, entry.name, 'package.json'), metadata);
  }
}

if (!existsSync(standaloneRoot)) {
  throw new Error('Standalone output was not found at .next/standalone. Run next build first.');
}

copyDirectory(resolve(root, '.next', 'static'), resolve(standaloneRoot, '.next', 'static'));
copyDirectory(resolve(root, 'public'), resolve(standaloneRoot, 'public'));
copyDirectory(resolve(root, 'plugins'), resolve(standaloneRoot, 'plugins'));
writePluginModuleMetadata();

console.log('Standalone assets prepared.');

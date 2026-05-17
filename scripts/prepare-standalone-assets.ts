import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { dirname, relative, resolve, isAbsolute } from 'path';

const root = process.cwd();
const standaloneRoot = resolve(root, '.next', 'standalone');
const pluginMapManifestPath = resolve(root, 'src/lib/plugin-map.manifest.json');

interface PluginMapManifest {
  sourceDirs?: Array<{ path: string }>;
  plugins?: Array<{ rootDir: string }>;
}

function readPluginMapManifest(): PluginMapManifest | null {
  if (!existsSync(pluginMapManifestPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(pluginMapManifestPath, 'utf-8')) as PluginMapManifest;
  } catch {
    return null;
  }
}

function isInsideRoot(candidatePath: string, rootPath: string): boolean {
  const candidateRelative = relative(rootPath, candidatePath);
  return (
    candidateRelative === '' ||
    (!candidateRelative.startsWith('..') && !isAbsolute(candidateRelative))
  );
}

function resolveStandaloneRelativePath(relativePath: string): string | null {
  const target = resolve(standaloneRoot, relativePath);
  return isInsideRoot(target, standaloneRoot) ? target : null;
}

function copyDirectory(source: string, target: string): void {
  if (!existsSync(source)) {
    return;
  }

  rmSync(target, { recursive: true, force: true });
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
}

function writePluginModuleMetadata(manifest: PluginMapManifest | null): void {
  const metadata = `${JSON.stringify({ type: 'module' }, null, 2)}\n`;
  const pluginRoots = manifest?.plugins?.map((plugin) => plugin.rootDir) ?? [];

  if (pluginRoots.length > 0) {
    for (const rootDir of pluginRoots) {
      const target = resolveStandaloneRelativePath(rootDir);
      if (!target || !existsSync(target)) {
        continue;
      }

      writeFileSync(resolve(target, 'package.json'), metadata);
    }

    return;
  }

  const pluginsRoot = resolve(standaloneRoot, 'plugins');
  if (!existsSync(pluginsRoot)) {
    return;
  }

  for (const entry of readdirSync(pluginsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    writeFileSync(resolve(pluginsRoot, entry.name, 'package.json'), metadata);
  }
}

function copyPluginSourceDirectories(manifest: PluginMapManifest | null): void {
  const sourceDirs = manifest?.sourceDirs?.map((sourceDir) => sourceDir.path) ?? ['plugins'];

  for (const sourceDir of sourceDirs) {
    const source = resolve(root, sourceDir);
    const target = resolveStandaloneRelativePath(sourceDir);
    if (!target) {
      console.warn(
        `Skipping external plugin source outside standalone root: ${sourceDir}. Mount it at runtime using the same relative path.`
      );
      continue;
    }

    if (isInsideRoot(standaloneRoot, source)) {
      console.warn(
        `Skipping plugin source that contains the standalone output: ${sourceDir}. Configure a narrower plugin directory or mount it at runtime.`
      );
      continue;
    }

    copyDirectory(source, target);
  }
}

if (!existsSync(standaloneRoot)) {
  throw new Error('Standalone output was not found at .next/standalone. Run next build first.');
}

const pluginMapManifest = readPluginMapManifest();

copyDirectory(resolve(root, '.next', 'static'), resolve(standaloneRoot, '.next', 'static'));
copyDirectory(resolve(root, 'public'), resolve(standaloneRoot, 'public'));
copyPluginSourceDirectories(pluginMapManifest);
writePluginModuleMetadata(pluginMapManifest);

console.log('Standalone assets prepared.');

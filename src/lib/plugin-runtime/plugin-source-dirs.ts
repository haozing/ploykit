import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_PLUGIN_SOURCE_DIR = 'plugins';
export const EXTERNAL_PLUGIN_DIRS_ENV = 'PLOYKIT_PLUGIN_DIRS';

export type PluginSourceKind = 'default' | 'external';

export interface PluginSourceTarget {
  path: string;
  displayPath: string;
  kind: PluginSourceKind;
  configuredValue?: string;
  exists: boolean;
  directPluginRoot: boolean;
}

export interface PluginSourceTargetOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  includeDefault?: boolean;
}

function toPosix(value: string): string {
  return value.replace(/\\/g, '/');
}

function normalizeForKey(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function splitPluginSourceDirs(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function formatPluginSourcePath(filePath: string, cwd = process.cwd()): string {
  const relativePath = path.relative(cwd, filePath);
  if (!relativePath) {
    return '.';
  }

  return toPosix(relativePath);
}

export function getPluginSourceTargets(
  options: PluginSourceTargetOptions = {}
): PluginSourceTarget[] {
  const cwd = options.cwd ?? process.cwd();
  // Tooling needs the raw optional plugin-dir env var while still allowing tests to inject env.
  // eslint-disable-next-line no-restricted-syntax
  const env = options.env ?? process.env;
  const includeDefault = options.includeDefault ?? true;
  const targets: PluginSourceTarget[] = [];
  const seen = new Set<string>();

  function addTarget(rawValue: string, kind: PluginSourceKind): void {
    const absolutePath = path.resolve(cwd, rawValue);
    const key = normalizeForKey(absolutePath);
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    const exists = fs.existsSync(absolutePath);
    targets.push({
      path: absolutePath,
      displayPath: formatPluginSourcePath(absolutePath, cwd),
      kind,
      configuredValue: kind === 'external' ? rawValue : undefined,
      exists,
      directPluginRoot: exists && fs.existsSync(path.join(absolutePath, 'plugin.ts')),
    });
  }

  if (includeDefault) {
    addTarget(DEFAULT_PLUGIN_SOURCE_DIR, 'default');
  }

  for (const sourceDir of splitPluginSourceDirs(env[EXTERNAL_PLUGIN_DIRS_ENV])) {
    addTarget(sourceDir, 'external');
  }

  return targets;
}

export function discoverPluginRootsInSourceTarget(target: PluginSourceTarget): string[] {
  if (!target.exists) {
    return [];
  }

  if (target.directPluginRoot) {
    return [target.path];
  }

  return fs
    .readdirSync(target.path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(target.path, entry.name))
    .filter((pluginRoot) => fs.existsSync(path.join(pluginRoot, 'plugin.ts')))
    .sort((left, right) => path.basename(left).localeCompare(path.basename(right)));
}

export function getDefaultPluginDevTargets(cwd = process.cwd()): string[] {
  return [
    ...getPluginSourceTargets({ cwd }).map((target) => target.path),
    path.join(cwd, 'templates/plugins'),
  ].filter((targetPath) => fs.existsSync(targetPath));
}

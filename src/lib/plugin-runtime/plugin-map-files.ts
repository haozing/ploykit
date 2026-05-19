import path from 'path';
import { EXTERNAL_PLUGIN_DIRS_ENV } from './plugin-source-dirs';

export const PLUGIN_MAP_FILE_ENV = 'PLOYKIT_PLUGIN_MAP_FILE';
export const PLUGIN_MAP_MANIFEST_FILE_ENV = 'PLOYKIT_PLUGIN_MAP_MANIFEST_FILE';

export const PLUGIN_MAP_MANIFEST_VERSION = 6;

export const SOURCE_PLUGIN_MAP_FILE = 'src/lib/plugin-map.ts';
export const SOURCE_PLUGIN_MAP_MANIFEST_FILE = 'src/lib/plugin-map.manifest.json';
export const RUNTIME_PLUGIN_MAP_FILE = '.runtime/plugin-map.cjs';
export const RUNTIME_PLUGIN_MAP_MANIFEST_FILE = '.runtime/plugin-map.manifest.json';

export interface PluginMapFileSet {
  mapFile: string;
  manifestFile: string;
  runtimeArtifact: boolean;
}

function configured(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function readOptionalRuntimeEnv(name: string): string | undefined {
  // These optional runtime artifact paths are intentionally product-shell inputs.
  // eslint-disable-next-line no-restricted-syntax
  return process.env[name];
}

export function hasConfiguredExternalPluginDirs(): boolean {
  return Boolean(configured(readOptionalRuntimeEnv(EXTERNAL_PLUGIN_DIRS_ENV)));
}

export function hasConfiguredRuntimePluginMapFiles(): boolean {
  return Boolean(
    configured(readOptionalRuntimeEnv(PLUGIN_MAP_FILE_ENV)) ||
    configured(readOptionalRuntimeEnv(PLUGIN_MAP_MANIFEST_FILE_ENV))
  );
}

export function resolveProjectPath(cwd: string, value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(cwd, value);
}

export function isLoadableRuntimePluginMapFile(file: string): boolean {
  return /\.(cjs|js)$/i.test(file);
}

export function getSourcePluginMapFiles(cwd = process.cwd()): PluginMapFileSet {
  return {
    mapFile: resolveProjectPath(cwd, SOURCE_PLUGIN_MAP_FILE),
    manifestFile: resolveProjectPath(cwd, SOURCE_PLUGIN_MAP_MANIFEST_FILE),
    runtimeArtifact: false,
  };
}

export function getRuntimePluginMapFiles(cwd = process.cwd()): PluginMapFileSet {
  return {
    mapFile: resolveProjectPath(
      cwd,
      configured(readOptionalRuntimeEnv(PLUGIN_MAP_FILE_ENV)) ?? RUNTIME_PLUGIN_MAP_FILE
    ),
    manifestFile: resolveProjectPath(
      cwd,
      configured(readOptionalRuntimeEnv(PLUGIN_MAP_MANIFEST_FILE_ENV)) ??
        RUNTIME_PLUGIN_MAP_MANIFEST_FILE
    ),
    runtimeArtifact: true,
  };
}

export function getActivePluginMapFiles(cwd = process.cwd()): PluginMapFileSet {
  if (hasConfiguredExternalPluginDirs() || hasConfiguredRuntimePluginMapFiles()) {
    return getRuntimePluginMapFiles(cwd);
  }

  return getSourcePluginMapFiles(cwd);
}

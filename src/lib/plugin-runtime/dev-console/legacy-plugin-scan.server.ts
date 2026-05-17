import fs from 'node:fs';
import path from 'node:path';
import { getDefaultPluginDevTargets as getConfiguredPluginDevTargets } from '../plugin-source-dirs';

export interface LegacyPluginDirectory {
  id: string;
  path: string;
  hasManifest: boolean;
  hasIndexView: boolean;
  hasLegacyApi: boolean;
  hasLegacyLifecycle: boolean;
}

export function toPluginDevPosix(value: string): string {
  return value.replace(/\\/g, '/');
}

export function relativeToProject(filePath: string): string {
  return toPluginDevPosix(path.relative(process.cwd(), filePath));
}

export function listLegacyPluginDirectories(
  targetPath = path.join(process.cwd(), 'plugins')
): LegacyPluginDirectory[] {
  if (!fs.existsSync(targetPath)) {
    return [];
  }

  const entries = fs.readdirSync(targetPath, { withFileTypes: true });
  const legacy: LegacyPluginDirectory[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const pluginRoot = path.join(targetPath, entry.name);
    const hasPluginContract = fs.existsSync(path.join(pluginRoot, 'plugin.ts'));
    const hasManifest = fs.existsSync(path.join(pluginRoot, 'manifest.ts'));
    const hasIndexView = fs.existsSync(path.join(pluginRoot, 'index.tsx'));
    const hasLegacyApi = fs.existsSync(path.join(pluginRoot, 'api.ts'));
    const hasLegacyLifecycle = fs.existsSync(path.join(pluginRoot, 'lifecycle.ts'));

    if (
      hasPluginContract ||
      (!hasManifest && !hasIndexView && !hasLegacyApi && !hasLegacyLifecycle)
    ) {
      continue;
    }

    legacy.push({
      id: entry.name,
      path: relativeToProject(pluginRoot),
      hasManifest,
      hasIndexView,
      hasLegacyApi,
      hasLegacyLifecycle,
    });
  }

  return legacy;
}

export function getDefaultPluginDevTargets(): string[] {
  return getConfiguredPluginDevTargets();
}

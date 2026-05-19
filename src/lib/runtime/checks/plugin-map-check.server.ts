/**
 * Plugin Map Check
 *
 * Verifies that generated plugin map matches configured plugin source directories.
 */

import fs from 'fs';
import path from 'path';
import type { RuntimeCheck } from '../types';
import {
  discoverPluginRootsInSourceTarget,
  formatPluginSourcePath,
  getPluginSourceTargets,
} from '@/lib/plugin-runtime/plugin-source-dirs';
import {
  PLUGIN_MAP_MANIFEST_VERSION,
  getActivePluginMapFiles,
} from '@/lib/plugin-runtime/plugin-map-files';

interface PluginMapManifest {
  version: number;
  sourceDirs?: Array<{ path: string; kind?: string; directPluginRoot?: boolean }>;
  plugins: Array<{ id: string; rootDir: string }>;
}

export const pluginMapCheck: RuntimeCheck = {
  name: 'plugin-map',
  description: 'Verify plugin map consistency with configured plugin source directories',

  run() {
    const actualPlugins: string[] = [];
    const missingExternalTargets: string[] = [];

    for (const target of getPluginSourceTargets()) {
      if (!target.exists) {
        if (target.kind === 'external') {
          missingExternalTargets.push(target.configuredValue ?? target.displayPath);
        }
        continue;
      }

      actualPlugins.push(
        ...discoverPluginRootsInSourceTarget(target).map((root) =>
          formatPluginSourcePath(root, process.cwd())
        )
      );
    }

    if (missingExternalTargets.length > 0) {
      return {
        key: 'plugin-map',
        status: 'failed',
        severity: 'error',
        message: `Configured external plugin directory not found: ${missingExternalTargets.join(', ')}`,
        fix: 'Update PLOYKIT_PLUGIN_DIRS or create the missing external plugin directory, then run "npm run plugins:scan".',
      };
    }

    const activeFiles = getActivePluginMapFiles();
    const manifest = readPluginMapManifest(activeFiles.manifestFile);
    if (!manifest) {
      return {
        key: 'plugin-map',
        status: 'failed',
        severity: 'error',
        message: 'Plugin map manifest is missing or invalid',
        fix: `Run "npm run plugins:scan" to update ${path.relative(process.cwd(), activeFiles.manifestFile)}.`,
      };
    }
    const declaredPlugins = manifest.plugins.map((plugin) => plugin.rootDir);

    // Compare
    const actualSet = new Set(actualPlugins);
    const declaredSet = new Set(declaredPlugins);

    const missingFromMap = actualPlugins.filter((p) => !declaredSet.has(p));
    const staleInMap = declaredPlugins.filter((p) => !actualSet.has(p));

    if (missingFromMap.length > 0 || staleInMap.length > 0) {
      const messages: string[] = [];
      if (missingFromMap.length > 0) {
        messages.push(
          `Plugins in configured directories but not in map: ${missingFromMap.join(', ')}`
        );
      }
      if (staleInMap.length > 0) {
        messages.push(`Plugins in map but not in configured directories: ${staleInMap.join(', ')}`);
      }

      return {
        key: 'plugin-map',
        status: 'failed',
        severity: 'error',
        message: messages.join('; '),
        fix: `Run "npm run plugins:scan" to update ${path.relative(process.cwd(), activeFiles.manifestFile)}.`,
      };
    }

    return {
      key: 'plugin-map',
      status: 'ok',
      severity: 'info',
      message: `Plugin map consistent: ${actualPlugins.length} plugin(s)`,
    };
  },
};

function readPluginMapManifest(manifestFile: string): PluginMapManifest | null {
  if (!fs.existsSync(manifestFile)) {
    return null;
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf-8')) as PluginMapManifest;

    if (
      manifest.version !== PLUGIN_MAP_MANIFEST_VERSION ||
      !Array.isArray(manifest.plugins) ||
      manifest.plugins.some(
        (plugin) => !plugin || typeof plugin.id !== 'string' || typeof plugin.rootDir !== 'string'
      )
    ) {
      return null;
    }

    return manifest;
  } catch {
    return null;
  }
}

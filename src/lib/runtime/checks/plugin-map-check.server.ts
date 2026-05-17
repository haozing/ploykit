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

const PLUGIN_MAP_MANIFEST_FILE = path.join(process.cwd(), 'src/lib/plugin-map.manifest.json');

interface PluginMapManifest {
  version: number;
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

    const manifest = readPluginMapManifest();
    if (!manifest) {
      return {
        key: 'plugin-map',
        status: 'failed',
        severity: 'error',
        message: 'Plugin map manifest is missing or invalid',
        fix: 'Run "npm run plugins:scan", then commit src/lib/plugin-map.ts and src/lib/plugin-map.manifest.json',
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
        fix: 'Run "npm run plugins:scan", then commit src/lib/plugin-map.ts and src/lib/plugin-map.manifest.json',
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

function readPluginMapManifest(): PluginMapManifest | null {
  if (!fs.existsSync(PLUGIN_MAP_MANIFEST_FILE)) {
    return null;
  }

  try {
    const manifest = JSON.parse(
      fs.readFileSync(PLUGIN_MAP_MANIFEST_FILE, 'utf-8')
    ) as PluginMapManifest;

    if (
      manifest.version !== 4 ||
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

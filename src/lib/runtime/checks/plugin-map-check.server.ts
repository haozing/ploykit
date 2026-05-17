/**
 * Plugin Map Check
 *
 * Verifies that generated plugin map matches the actual plugins/ directory.
 */

import fs from 'fs';
import path from 'path';
import type { RuntimeCheck } from '../types';

const PLUGINS_DIR = path.join(process.cwd(), 'plugins');
const PLUGIN_MAP_MANIFEST_FILE = path.join(process.cwd(), 'src/lib/plugin-map.manifest.json');

interface PluginMapManifest {
  version: number;
  plugins: Array<{ id: string; rootDir: string }>;
}

export const pluginMapCheck: RuntimeCheck = {
  name: 'plugin-map',
  description: 'Verify plugin map consistency with plugins/ directory',

  run() {
    // Scan definePlugin contract directories. Legacy manifest-only directories are no longer
    // ordinary plugin runtime targets and are reported by the plugin-runtime check instead.
    const actualPlugins: string[] = [];
    if (fs.existsSync(PLUGINS_DIR)) {
      const entries = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const pluginContractPath = path.join(PLUGINS_DIR, entry.name, 'plugin.ts');
          if (fs.existsSync(pluginContractPath)) {
            actualPlugins.push(entry.name);
          }
        }
      }
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
    const declaredPlugins = manifest.plugins.map((plugin) => plugin.id);

    // Compare
    const actualSet = new Set(actualPlugins);
    const declaredSet = new Set(declaredPlugins);

    const missingFromMap = actualPlugins.filter((p) => !declaredSet.has(p));
    const staleInMap = declaredPlugins.filter((p) => !actualSet.has(p));

    if (missingFromMap.length > 0 || staleInMap.length > 0) {
      const messages: string[] = [];
      if (missingFromMap.length > 0) {
        messages.push(`Plugins in directory but not in map: ${missingFromMap.join(', ')}`);
      }
      if (staleInMap.length > 0) {
        messages.push(`Plugins in map but not in directory: ${staleInMap.join(', ')}`);
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
      manifest.version !== 3 ||
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

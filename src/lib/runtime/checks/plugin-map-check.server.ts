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
  defaultProductId: string;
  products: Array<{ id: string; suites: string[]; bundles: string[] }>;
  suites: Array<{ id: string; productId: string; plugins: string[] }>;
  bundles: Array<{ id: string; productId: string; plugins: Array<{ pluginId: string }> }>;
  plugins: Array<{ id: string; productId: string; suiteId: string; bundleIds: string[] }>;
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
    const productIds = new Set(manifest.products.map((product) => product.id));
    const suiteIds = new Set(manifest.suites.map((suite) => suite.id));
    const bundleIds = new Set(manifest.bundles.map((bundle) => bundle.id));

    // Compare
    const actualSet = new Set(actualPlugins);
    const declaredSet = new Set(declaredPlugins);

    const missingFromMap = actualPlugins.filter((p) => !declaredSet.has(p));
    const staleInMap = declaredPlugins.filter((p) => !actualSet.has(p));
    const invalidOwnership = manifest.plugins.filter(
      (plugin) =>
        !productIds.has(plugin.productId) ||
        !suiteIds.has(plugin.suiteId) ||
        plugin.bundleIds.some((bundleId) => !bundleIds.has(bundleId))
    );

    if (missingFromMap.length > 0 || staleInMap.length > 0 || invalidOwnership.length > 0) {
      const messages: string[] = [];
      if (missingFromMap.length > 0) {
        messages.push(`Plugins in directory but not in map: ${missingFromMap.join(', ')}`);
      }
      if (staleInMap.length > 0) {
        messages.push(`Plugins in map but not in directory: ${staleInMap.join(', ')}`);
      }
      if (invalidOwnership.length > 0) {
        messages.push(
          `Plugins with invalid runtime ownership: ${invalidOwnership
            .map((plugin) => plugin.id)
            .join(', ')}`
        );
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
      manifest.version !== 2 ||
      typeof manifest.defaultProductId !== 'string' ||
      !Array.isArray(manifest.products) ||
      !Array.isArray(manifest.suites) ||
      !Array.isArray(manifest.bundles) ||
      !Array.isArray(manifest.plugins) ||
      manifest.products.some(
        (product) =>
          !product ||
          typeof product.id !== 'string' ||
          !Array.isArray(product.suites) ||
          !Array.isArray(product.bundles)
      ) ||
      manifest.suites.some(
        (suite) =>
          !suite ||
          typeof suite.id !== 'string' ||
          typeof suite.productId !== 'string' ||
          !Array.isArray(suite.plugins)
      ) ||
      manifest.bundles.some(
        (bundle) =>
          !bundle ||
          typeof bundle.id !== 'string' ||
          typeof bundle.productId !== 'string' ||
          !Array.isArray(bundle.plugins)
      ) ||
      manifest.plugins.some(
        (plugin) =>
          !plugin ||
          typeof plugin.id !== 'string' ||
          typeof plugin.productId !== 'string' ||
          typeof plugin.suiteId !== 'string' ||
          !Array.isArray(plugin.bundleIds)
      )
    ) {
      return null;
    }

    return manifest;
  } catch {
    return null;
  }
}

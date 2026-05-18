import fs from 'fs';
import path from 'path';
import type { RuntimeCheck } from '../types';
import { loadRuntimeCatalogFiles } from '@/lib/plugin-runtime/catalog/runtime-catalog-file.server';
import { listPluginRuntimeIds } from '@/lib/plugin-runtime/loader';

export const runtimeCatalogCheck: RuntimeCheck = {
  name: 'runtime-catalog',
  description: 'Verify external runtime catalog files and plugin references',

  run() {
    let catalog;
    try {
      catalog = loadRuntimeCatalogFiles();
    } catch (error) {
      return {
        key: 'runtime-catalog',
        status: 'failed',
        severity: 'error',
        message: error instanceof Error ? error.message : String(error),
        fix: 'Fix PLOYKIT_RUNTIME_CATALOG_FILE or pass a valid --catalog file to plugins:apply.',
      };
    }

    if (catalog.files.length === 0) {
      return {
        key: 'runtime-catalog',
        status: 'ok',
        severity: 'info',
        message: 'No external runtime catalog configured',
      };
    }

    const missingFiles = catalog.files.filter((file) => !fs.existsSync(file));
    if (missingFiles.length > 0) {
      return {
        key: 'runtime-catalog',
        status: 'failed',
        severity: 'error',
        message: `Runtime catalog file(s) not found: ${missingFiles.join(', ')}`,
        fix: 'Update PLOYKIT_RUNTIME_CATALOG_FILE or create the missing catalog file(s).',
      };
    }

    const productIds = new Set(catalog.products.map((product) => product.id));
    const suiteIds = new Set(catalog.suites.map((suite) => suite.id));
    const pluginIds = new Set(listPluginRuntimeIds());
    const problems: string[] = [];

    for (const suite of catalog.suites) {
      if (!productIds.has(suite.productId)) {
        problems.push(`suite "${suite.id}" references missing product "${suite.productId}"`);
      }
    }

    for (const bundle of catalog.bundles) {
      if (!productIds.has(bundle.productId)) {
        problems.push(`bundle "${bundle.id}" references missing product "${bundle.productId}"`);
      }
      if (bundle.suiteId && !suiteIds.has(bundle.suiteId)) {
        problems.push(`bundle "${bundle.id}" references missing suite "${bundle.suiteId}"`);
      }
      for (const plugin of bundle.plugins) {
        if (!pluginIds.has(plugin.pluginId)) {
          problems.push(`bundle "${bundle.id}" references missing plugin "${plugin.pluginId}"`);
        }
      }
    }

    if (problems.length > 0) {
      return {
        key: 'runtime-catalog',
        status: 'failed',
        severity: 'error',
        message: problems.join('; '),
        fix: 'Run npm run plugins:scan and verify the external catalog product/suite/bundle membership.',
      };
    }

    return {
      key: 'runtime-catalog',
      status: 'ok',
      severity: 'info',
      message: `Runtime catalog valid: ${catalog.files
        .map((file) => path.relative(process.cwd(), file))
        .join(', ')}`,
    };
  },
};

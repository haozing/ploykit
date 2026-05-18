import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RUNTIME_CATALOG_FILE_ENV,
  resetRuntimeCatalogFileCache,
} from '../runtime-catalog-file.server';
import {
  getPluginRuntimeBundleIds,
  getPluginRuntimeProductId,
  getPluginRuntimeSuiteId,
  getRuntimeAppBundle,
  listPluginRuntimeIdsForProduct,
  listRuntimeAppBundles,
  listRuntimePluginSuites,
  listRuntimeProducts,
} from '@/lib/plugin-runtime/loader';

function writeCatalog(value: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ploykit-runtime-catalog-'));
  const file = path.join(dir, 'catalog.json');
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  return file;
}

describe('external runtime catalog files', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetRuntimeCatalogFileCache();
  });

  it('merges external products, suites, and bundles without source changes', () => {
    const file = writeCatalog({
      version: 1,
      products: [{ id: 'external-product', name: 'External Product' }],
      suites: [{ id: 'external-suite', productId: 'external-product', name: 'External Suite' }],
      bundles: [
        {
          id: 'external-bundle',
          productId: 'external-product',
          suiteId: 'external-suite',
          name: 'External Bundle',
          plugins: [{ pluginId: 'capability-demo', enableByDefault: false, required: true }],
        },
      ],
    });

    vi.stubEnv(RUNTIME_CATALOG_FILE_ENV, file);
    resetRuntimeCatalogFileCache();

    expect(listRuntimeProducts()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'external-product' })])
    );
    expect(listRuntimePluginSuites('external-product')).toEqual([
      expect.objectContaining({
        id: 'external-suite',
        plugins: ['capability-demo'],
      }),
    ]);
    expect(getRuntimeAppBundle('external-bundle', 'external-product')).toMatchObject({
      id: 'external-bundle',
      productId: 'external-product',
      plugins: [{ pluginId: 'capability-demo', enableByDefault: false, required: true }],
    });
    expect(listRuntimeAppBundles('external-product')).toHaveLength(1);
    expect(getPluginRuntimeProductId('capability-demo')).toBe('external-product');
    expect(getPluginRuntimeSuiteId('capability-demo')).toBe('external-suite');
    expect(getPluginRuntimeBundleIds('capability-demo')).toEqual(['external-bundle']);
    expect(listPluginRuntimeIdsForProduct('ploykit')).not.toContain('capability-demo');
    expect(listRuntimePluginSuites('ploykit').flatMap((suite) => suite.plugins)).not.toContain(
      'capability-demo'
    );
  });
});

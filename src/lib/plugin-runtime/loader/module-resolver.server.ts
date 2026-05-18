import fs from 'fs';
import { createRequire } from 'module';
import { PLUGIN_MAP } from '@/lib/plugin-map';
import type { PluginRuntimeContract } from '../contract';
import { getActivePluginMapFiles } from '../plugin-map-files';
import { loadRuntimeCatalogFiles } from '../catalog/runtime-catalog-file.server';
import type {
  RuntimeAppBundle,
  RuntimeBundlePlugin,
  RuntimePluginSuite,
  RuntimeProduct,
} from '../catalog/runtime-catalog-types';

export type PluginModuleLoader = () => Promise<unknown>;

export interface PluginRuntimeMapEntry {
  rootDir?: string;
  sourceDir?: string;
  sourceKind?: 'default' | 'external';
  plugin?: PluginModuleLoader;
  components?: Record<string, PluginModuleLoader>;
  pages?: Record<string, PluginModuleLoader>;
  apis?: Record<string, PluginModuleLoader>;
  lifecycleModules?: Record<string, PluginModuleLoader>;
  jobModules?: Record<string, PluginModuleLoader>;
  webhookModules?: Record<string, PluginModuleLoader>;
  eventModules?: Record<string, PluginModuleLoader>;
  hookModules?: Record<string, PluginModuleLoader>;
  slotModules?: Record<string, PluginModuleLoader>;
  runtimeContract?: PluginRuntimeContract;
}

export type { RuntimeAppBundle, RuntimeBundlePlugin, RuntimePluginSuite, RuntimeProduct };

export const DEFAULT_PRODUCT_ID = 'ploykit';

interface RuntimeCatalogProfile {
  suiteId: string;
  suiteName: string;
  bundleId: string;
  bundleName: string;
  enableByDefault: boolean;
  required: boolean;
}

const DEFAULT_PLUGIN_CATALOG_OVERRIDES: Record<string, Partial<RuntimeCatalogProfile>> = {
  'capability-demo': {
    suiteId: 'core',
    suiteName: 'PloyKit Core',
    bundleId: 'core-dev-tools',
    bundleName: 'PloyKit Core Developer Tools',
    enableByDefault: true,
    required: true,
  },
  'host-capability-lab': {
    suiteId: 'host-capability-lab',
    suiteName: 'Host Capability Lab',
    bundleId: 'host-capability-lab',
    bundleName: 'Host Capability Lab',
    enableByDefault: true,
    required: true,
  },
  'sample-internal': {
    suiteId: 'samples',
    suiteName: 'Sample Plugins',
    bundleId: 'sample-internal',
    bundleName: 'Sample Internal Service Plugin',
    enableByDefault: false,
    required: false,
  },
};

const requireRuntimePluginMap = createRequire(import.meta.url);
let activePluginMapCache: Record<string, PluginRuntimeMapEntry> | undefined;

function loadRuntimePluginMap(): Record<string, PluginRuntimeMapEntry> {
  const activeFiles = getActivePluginMapFiles();
  if (!fs.existsSync(activeFiles.mapFile)) {
    return {};
  }

  try {
    const loaded = requireRuntimePluginMap(activeFiles.mapFile) as {
      PLUGIN_MAP?: Record<string, PluginRuntimeMapEntry>;
    };
    return loaded.PLUGIN_MAP && typeof loaded.PLUGIN_MAP === 'object' ? loaded.PLUGIN_MAP : {};
  } catch {
    return {};
  }
}

function getActivePluginMap(): Record<string, PluginRuntimeMapEntry> {
  activePluginMapCache ??= {
    ...(PLUGIN_MAP as Record<string, PluginRuntimeMapEntry>),
    ...loadRuntimePluginMap(),
  };
  return activePluginMapCache;
}

export function resetPluginRuntimeMapCache(): void {
  activePluginMapCache = undefined;
}

function titleFromId(id: string): string {
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function productMatchesDefault(productId?: string): boolean {
  return !productId || productId === DEFAULT_PRODUCT_ID;
}

function listExplicitRuntimeCatalogPluginIds(): Set<string> {
  const catalog = loadRuntimeCatalogFiles();
  return new Set([
    ...catalog.suites.flatMap((suite) => suite.plugins),
    ...catalog.bundles.flatMap((bundle) => bundle.plugins.map((plugin) => plugin.pluginId)),
  ]);
}

function getCatalogProfile(pluginId: string): RuntimeCatalogProfile {
  const fallbackName = titleFromId(pluginId);
  const override = DEFAULT_PLUGIN_CATALOG_OVERRIDES[pluginId] ?? {};

  return {
    suiteId: override.suiteId ?? pluginId,
    suiteName: override.suiteName ?? fallbackName,
    bundleId: override.bundleId ?? pluginId,
    bundleName: override.bundleName ?? fallbackName,
    enableByDefault: override.enableByDefault ?? true,
    required: override.required ?? false,
  };
}

function implicitProduct(productId = DEFAULT_PRODUCT_ID): RuntimeProduct {
  return {
    id: productId,
    name: productId === DEFAULT_PRODUCT_ID ? 'PloyKit' : productId,
    runtimeKey: productId,
    defaultLocale: 'en',
    status: 'active',
  };
}

export function normalizePluginModulePath(modulePath: string): string {
  return modulePath
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\.(ts|tsx|js|jsx)$/, '');
}

export function getPluginRuntimeMapEntry(pluginId: string): PluginRuntimeMapEntry | null {
  const entry = getActivePluginMap()[pluginId];
  return entry && typeof entry === 'object' ? (entry as PluginRuntimeMapEntry) : null;
}

export function listPluginRuntimeIds(): string[] {
  return Object.keys(getActivePluginMap());
}

export function listRuntimeProducts(): RuntimeProduct[] {
  const products = new Map<string, RuntimeProduct>();
  products.set(DEFAULT_PRODUCT_ID, implicitProduct());
  for (const product of loadRuntimeCatalogFiles().products) {
    products.set(product.id, product);
  }
  return [...products.values()];
}

export function getRuntimeProduct(productId: string): RuntimeProduct | null {
  if (!productId.trim()) {
    return null;
  }
  return (
    listRuntimeProducts().find((product) => product.id === productId) ?? implicitProduct(productId)
  );
}

export function listRuntimePluginSuites(productId?: string): RuntimePluginSuite[] {
  const suites = new Map<string, RuntimePluginSuite>();
  const externalSuites = loadRuntimeCatalogFiles().suites.filter(
    (suite) => !productId || suite.productId === productId
  );
  const explicitPluginIds = listExplicitRuntimeCatalogPluginIds();

  if (productMatchesDefault(productId)) {
    for (const pluginId of listPluginRuntimeIds()) {
      if (explicitPluginIds.has(pluginId)) {
        continue;
      }
      const profile = getCatalogProfile(pluginId);
      const suite =
        suites.get(profile.suiteId) ??
        ({
          id: profile.suiteId,
          productId: DEFAULT_PRODUCT_ID,
          name: profile.suiteName,
          status: 'active',
          plugins: [],
          metadata: { source: 'plugin-map' },
        } satisfies RuntimePluginSuite);
      suite.plugins.push(pluginId);
      suites.set(profile.suiteId, suite);
    }
  }

  for (const suite of externalSuites) {
    const bundlePlugins = loadRuntimeCatalogFiles()
      .bundles.filter((bundle) => bundle.suiteId === suite.id)
      .flatMap((bundle) => bundle.plugins.map((plugin) => plugin.pluginId));
    suites.set(suite.id, {
      ...suite,
      plugins: suite.plugins.length > 0 ? suite.plugins : [...new Set(bundlePlugins)],
      metadata: { source: 'runtime-catalog', ...(suite.metadata ?? {}) },
    });
  }

  return [...suites.values()];
}

export function getRuntimePluginSuite(suiteId: string): RuntimePluginSuite | null {
  return listRuntimePluginSuites().find((suite) => suite.id === suiteId) ?? null;
}

export function listRuntimeAppBundles(productId?: string): RuntimeAppBundle[] {
  const externalBundles = loadRuntimeCatalogFiles().bundles.filter(
    (bundle) => !productId || bundle.productId === productId
  );
  const explicitPluginIds = listExplicitRuntimeCatalogPluginIds();
  const bundles: RuntimeAppBundle[] = [];

  if (productMatchesDefault(productId)) {
    for (const pluginId of listPluginRuntimeIds()) {
      if (explicitPluginIds.has(pluginId)) {
        continue;
      }
      const profile = getCatalogProfile(pluginId);
      const entry = getPluginRuntimeMapEntry(pluginId);
      bundles.push({
        id: profile.bundleId,
        productId: DEFAULT_PRODUCT_ID,
        suiteId: profile.suiteId,
        name: profile.bundleName,
        sourceType: entry?.sourceKind === 'external' ? 'external-directory' : 'local',
        sourceRef: entry?.rootDir ?? `plugins/${pluginId}`,
        plugins: [
          {
            pluginId,
            enableByDefault: profile.enableByDefault,
            required: profile.required,
          },
        ],
        metadata: {
          source: 'plugin-map',
          ...(entry?.sourceDir ? { sourceDir: entry.sourceDir } : {}),
          ...(entry?.sourceKind ? { sourceKind: entry.sourceKind } : {}),
        },
      } satisfies RuntimeAppBundle);
    }
  }

  bundles.push(
    ...externalBundles.map((bundle) => ({
      ...bundle,
      metadata: { source: 'runtime-catalog', ...(bundle.metadata ?? {}) },
    }))
  );

  return bundles;
}

export function getRuntimeAppBundle(bundleId: string, productId?: string): RuntimeAppBundle | null {
  return listRuntimeAppBundles(productId).find((bundle) => bundle.id === bundleId) ?? null;
}

export function listPluginRuntimeIdsForProduct(productId = DEFAULT_PRODUCT_ID): string[] {
  return [
    ...new Set(
      listRuntimeAppBundles(productId).flatMap((bundle) =>
        bundle.plugins.map((plugin) => plugin.pluginId)
      )
    ),
  ];
}

export function listPluginRuntimeIdsForSuite(suiteId: string): string[] {
  return getRuntimePluginSuite(suiteId)?.plugins ?? [];
}

export function getPluginRuntimeProductId(pluginId: string): string | null {
  const explicitBundle = loadRuntimeCatalogFiles().bundles.find((bundle) =>
    bundle.plugins.some((plugin) => plugin.pluginId === pluginId)
  );
  if (explicitBundle) {
    return explicitBundle.productId;
  }
  return getPluginRuntimeMapEntry(pluginId) ? DEFAULT_PRODUCT_ID : null;
}

export function getPluginRuntimeSuiteId(pluginId: string): string | null {
  const explicitBundle = loadRuntimeCatalogFiles().bundles.find((bundle) =>
    bundle.plugins.some((plugin) => plugin.pluginId === pluginId)
  );
  if (explicitBundle?.suiteId) {
    return explicitBundle.suiteId;
  }
  const explicitSuite = loadRuntimeCatalogFiles().suites.find((suite) =>
    suite.plugins.includes(pluginId)
  );
  if (explicitSuite) {
    return explicitSuite.id;
  }
  return getPluginRuntimeMapEntry(pluginId) ? getCatalogProfile(pluginId).suiteId : null;
}

export function getPluginRuntimeBundleIds(pluginId: string): readonly string[] {
  const explicitBundleIds = loadRuntimeCatalogFiles()
    .bundles.filter((bundle) => bundle.plugins.some((plugin) => plugin.pluginId === pluginId))
    .map((bundle) => bundle.id);
  if (explicitBundleIds.length > 0) {
    return explicitBundleIds;
  }
  return getPluginRuntimeMapEntry(pluginId) ? [getCatalogProfile(pluginId).bundleId] : [];
}

export function isPluginInRuntimeProduct(
  pluginId: string,
  productId = DEFAULT_PRODUCT_ID
): boolean {
  return listPluginRuntimeIdsForProduct(productId).includes(pluginId);
}

export function hasPluginRuntimeContract(pluginId: string): boolean {
  const entry = getPluginRuntimeMapEntry(pluginId);
  return Boolean(entry?.runtimeContract || entry?.plugin);
}

export function resolvePluginComponentModule(
  entry: PluginRuntimeMapEntry,
  componentPath: string
): PluginModuleLoader | null {
  const normalizedPath = normalizePluginModulePath(componentPath);

  return (
    resolvePluginSlotModule(entry, componentPath) ?? entry.components?.[normalizedPath] ?? null
  );
}

export function resolvePluginPageModule(
  entry: PluginRuntimeMapEntry,
  componentPath: string
): PluginModuleLoader | null {
  return entry.pages?.[normalizePluginModulePath(componentPath)] ?? null;
}

export function resolvePluginApiModule(
  entry: PluginRuntimeMapEntry,
  handlerPath: string
): PluginModuleLoader | null {
  return entry.apis?.[normalizePluginModulePath(handlerPath)] ?? null;
}

export function resolvePluginLifecycleModule(
  entry: PluginRuntimeMapEntry,
  handlerPath: string
): PluginModuleLoader | null {
  return entry.lifecycleModules?.[normalizePluginModulePath(handlerPath)] ?? null;
}

export function resolvePluginJobModule(
  entry: PluginRuntimeMapEntry,
  handlerPath: string
): PluginModuleLoader | null {
  return entry.jobModules?.[normalizePluginModulePath(handlerPath)] ?? null;
}

export function resolvePluginWebhookModule(
  entry: PluginRuntimeMapEntry,
  handlerPath: string
): PluginModuleLoader | null {
  return entry.webhookModules?.[normalizePluginModulePath(handlerPath)] ?? null;
}

export function resolvePluginEventModule(
  entry: PluginRuntimeMapEntry,
  handlerPath: string
): PluginModuleLoader | null {
  return entry.eventModules?.[normalizePluginModulePath(handlerPath)] ?? null;
}

export function resolvePluginHookModule(
  entry: PluginRuntimeMapEntry,
  handlerPath: string
): PluginModuleLoader | null {
  return entry.hookModules?.[normalizePluginModulePath(handlerPath)] ?? null;
}

export function resolvePluginSlotModule(
  entry: PluginRuntimeMapEntry,
  componentPath: string
): PluginModuleLoader | null {
  return entry.slotModules?.[normalizePluginModulePath(componentPath)] ?? null;
}

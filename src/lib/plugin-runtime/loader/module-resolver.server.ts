import { PLUGIN_MAP } from '@/lib/plugin-map';
import type { PluginRuntimeContract } from '../contract';

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

export interface RuntimeProduct {
  id: string;
  name: string;
  runtimeKey?: string;
  defaultLocale?: string;
  status?: string;
  metadata?: Record<string, unknown>;
}

export interface RuntimePluginSuite {
  id: string;
  productId: string;
  name: string;
  version?: string;
  status?: string;
  plugins: string[];
  menu?: {
    group: string;
    labelKey?: string;
    fallbackLabel?: string;
  };
  billing?: {
    namespace: string;
    primaryCreditMetric?: string;
  };
  sharedServices?: Array<Record<string, unknown>>;
  sharedResourceBindings?: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
}

export interface RuntimeBundlePlugin {
  pluginId: string;
  enableByDefault: boolean;
  required: boolean;
}

export interface RuntimeAppBundle {
  id: string;
  productId: string;
  suiteId?: string;
  name: string;
  version?: string;
  sourceType?: string;
  sourceRef?: string;
  plugins: RuntimeBundlePlugin[];
  seeds?: {
    internalServices?: Array<Record<string, unknown>>;
    resourceBindings?: Array<Record<string, unknown>>;
  };
  healthChecks?: Array<Record<string, unknown>>;
  dependencies?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

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
  const entry = PLUGIN_MAP[pluginId];
  return entry && typeof entry === 'object' ? (entry as PluginRuntimeMapEntry) : null;
}

export function listPluginRuntimeIds(): string[] {
  return Object.keys(PLUGIN_MAP);
}

export function listRuntimeProducts(): RuntimeProduct[] {
  return [implicitProduct()];
}

export function getRuntimeProduct(productId: string): RuntimeProduct | null {
  return productId.trim() ? implicitProduct(productId) : null;
}

export function listRuntimePluginSuites(productId?: string): RuntimePluginSuite[] {
  if (!productMatchesDefault(productId)) {
    return [];
  }

  const suites = new Map<string, RuntimePluginSuite>();
  for (const pluginId of listPluginRuntimeIds()) {
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

  return [...suites.values()];
}

export function getRuntimePluginSuite(suiteId: string): RuntimePluginSuite | null {
  return listRuntimePluginSuites().find((suite) => suite.id === suiteId) ?? null;
}

export function listRuntimeAppBundles(productId?: string): RuntimeAppBundle[] {
  if (!productMatchesDefault(productId)) {
    return [];
  }

  return listPluginRuntimeIds().map((pluginId) => {
    const profile = getCatalogProfile(pluginId);
    const entry = getPluginRuntimeMapEntry(pluginId);
    return {
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
    } satisfies RuntimeAppBundle;
  });
}

export function getRuntimeAppBundle(bundleId: string): RuntimeAppBundle | null {
  return listRuntimeAppBundles().find((bundle) => bundle.id === bundleId) ?? null;
}

export function listPluginRuntimeIdsForProduct(_productId = DEFAULT_PRODUCT_ID): string[] {
  return listPluginRuntimeIds();
}

export function listPluginRuntimeIdsForSuite(suiteId: string): string[] {
  return getRuntimePluginSuite(suiteId)?.plugins ?? [];
}

export function getPluginRuntimeProductId(pluginId: string): string | null {
  return getPluginRuntimeMapEntry(pluginId) ? DEFAULT_PRODUCT_ID : null;
}

export function getPluginRuntimeSuiteId(pluginId: string): string | null {
  return getPluginRuntimeMapEntry(pluginId) ? getCatalogProfile(pluginId).suiteId : null;
}

export function getPluginRuntimeBundleIds(pluginId: string): readonly string[] {
  return getPluginRuntimeMapEntry(pluginId) ? [getCatalogProfile(pluginId).bundleId] : [];
}

export function isPluginInRuntimeProduct(
  pluginId: string,
  _productId = DEFAULT_PRODUCT_ID
): boolean {
  return Boolean(getPluginRuntimeMapEntry(pluginId));
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

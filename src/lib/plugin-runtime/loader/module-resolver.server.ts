import {
  APP_BUNDLES,
  DEFAULT_RUNTIME_PRODUCT_ID,
  PLUGIN_MAP,
  PLUGIN_SUITES,
  RUNTIME_PRODUCTS,
  type RuntimeBundleMapEntry,
  type RuntimeProductMapEntry,
  type RuntimeSuiteMapEntry,
} from '@/lib/plugin-map';
import type { PluginRuntimeContract } from '../contract';

export type PluginModuleLoader = () => Promise<unknown>;

export interface PluginRuntimeMapEntry {
  rootDir?: string;
  productId?: string;
  suiteId?: string;
  bundleIds?: string[];
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

export type RuntimeProduct = RuntimeProductMapEntry;
export type RuntimePluginSuite = RuntimeSuiteMapEntry;
export type RuntimeAppBundle = RuntimeBundleMapEntry;

export const DEFAULT_PRODUCT_ID = DEFAULT_RUNTIME_PRODUCT_ID;

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
  return Object.values(RUNTIME_PRODUCTS);
}

export function getRuntimeProduct(productId: string): RuntimeProduct | null {
  return RUNTIME_PRODUCTS[productId] ?? null;
}

export function listRuntimePluginSuites(productId?: string): RuntimePluginSuite[] {
  return Object.values(PLUGIN_SUITES).filter(
    (suite) => !productId || suite.productId === productId
  );
}

export function getRuntimePluginSuite(suiteId: string): RuntimePluginSuite | null {
  return PLUGIN_SUITES[suiteId] ?? null;
}

export function listRuntimeAppBundles(productId?: string): RuntimeAppBundle[] {
  return Object.values(APP_BUNDLES).filter(
    (bundle) => !productId || bundle.productId === productId
  );
}

export function getRuntimeAppBundle(bundleId: string): RuntimeAppBundle | null {
  return APP_BUNDLES[bundleId] ?? null;
}

export function listPluginRuntimeIdsForProduct(productId = DEFAULT_PRODUCT_ID): string[] {
  return Object.entries(PLUGIN_MAP)
    .filter(([, entry]) => entry.productId === productId)
    .map(([pluginId]) => pluginId);
}

export function listPluginRuntimeIdsForSuite(suiteId: string): string[] {
  const suite = getRuntimePluginSuite(suiteId);
  if (suite) {
    return suite.plugins.filter((pluginId) => PLUGIN_MAP[pluginId]);
  }

  return Object.entries(PLUGIN_MAP)
    .filter(([, entry]) => entry.suiteId === suiteId)
    .map(([pluginId]) => pluginId);
}

export function getPluginRuntimeProductId(pluginId: string): string | null {
  return getPluginRuntimeMapEntry(pluginId)?.productId ?? null;
}

export function getPluginRuntimeSuiteId(pluginId: string): string | null {
  return getPluginRuntimeMapEntry(pluginId)?.suiteId ?? null;
}

export function getPluginRuntimeBundleIds(pluginId: string): readonly string[] {
  return getPluginRuntimeMapEntry(pluginId)?.bundleIds ?? [];
}

export function isPluginInRuntimeProduct(
  pluginId: string,
  productId = DEFAULT_PRODUCT_ID
): boolean {
  return getPluginRuntimeProductId(pluginId) === productId;
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

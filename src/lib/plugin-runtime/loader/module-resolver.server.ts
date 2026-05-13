import { PLUGIN_MAP } from '@/lib/plugin-map';
import type { PluginRuntimeContract } from '../contract';

export type PluginModuleLoader = () => Promise<unknown>;

export interface PluginRuntimeMapEntry {
  rootDir?: string;
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

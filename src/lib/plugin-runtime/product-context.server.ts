import 'server-only';

import { getPluginRuntimeMapEntry, getRuntimeProduct, type PluginRuntimeMapEntry } from './loader';
import { getRuntimeProductId } from './product-id';

export function getCurrentRuntimeProductId(input?: { productId?: string }): string {
  return getRuntimeProductId(input);
}

export function getCurrentRuntimeProduct(input?: { productId?: string }) {
  return getRuntimeProduct(getCurrentRuntimeProductId(input));
}

export function requireRuntimeMapEntry(pluginId: string): PluginRuntimeMapEntry {
  const entry = getPluginRuntimeMapEntry(pluginId);
  if (!entry) {
    throw new Error(`Plugin "${pluginId}" is not present in the generated runtime map.`);
  }

  return entry;
}

export function resolvePluginRuntimeOwnership(
  pluginId: string,
  input?: { productId?: string; suiteId?: string | null; bundleId?: string | null }
): {
  productId: string;
  suiteId: string | null;
  bundleIds: readonly string[];
  entry: PluginRuntimeMapEntry;
} {
  const entry = requireRuntimeMapEntry(pluginId);
  const productId = getCurrentRuntimeProductId(input);

  return {
    productId,
    suiteId: input?.suiteId ?? null,
    bundleIds: input?.bundleId ? [input.bundleId] : [],
    entry,
  };
}

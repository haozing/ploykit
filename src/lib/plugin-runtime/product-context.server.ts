import 'server-only';

import { env } from '@/lib/_core/env';
import {
  DEFAULT_PRODUCT_ID,
  getPluginRuntimeMapEntry,
  getRuntimeProduct,
  type PluginRuntimeMapEntry,
} from './loader';

export function getCurrentRuntimeProductId(input?: { productId?: string }): string {
  return (
    input?.productId?.trim() ||
    env.PLUGIN_RUNTIME_PRODUCT_ID?.trim() ||
    env.PLOYKIT_PRODUCT_ID?.trim() ||
    DEFAULT_PRODUCT_ID
  );
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
  input?: { productId?: string }
): {
  productId: string;
  suiteId: string;
  bundleIds: readonly string[];
  entry: PluginRuntimeMapEntry;
} {
  const entry = requireRuntimeMapEntry(pluginId);
  const productId = getCurrentRuntimeProductId(input);
  const entryProductId = entry.productId ?? DEFAULT_PRODUCT_ID;
  if (entryProductId !== productId) {
    throw new Error(
      `Plugin "${pluginId}" belongs to runtime product "${entryProductId}", not "${productId}".`
    );
  }

  return {
    productId,
    suiteId: entry.suiteId ?? 'default',
    bundleIds: entry.bundleIds ?? [],
    entry,
  };
}

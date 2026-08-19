import type { ModuleLoader, ModuleRuntimeMapEntry } from './module-map-types';

type ModuleLoaderCollectionName =
  | 'pages'
  | 'apis'
  | 'admin'
  | 'loaders'
  | 'actions'
  | 'services'
  | 'components'
  | 'surfaces'
  | 'lifecycle'
  | 'jobs'
  | 'events'
  | 'webhooks'
  | 'capabilities';

export function normalizeModuleLocalSpecifier(specifier: string): string {
  return specifier.replace(/^\.\//, '').replace(/\.(ts|tsx|js|jsx)$/, '');
}

export function resolveModuleEntryLoader(
  entry: ModuleRuntimeMapEntry,
  collection: ModuleLoaderCollectionName,
  specifier: string
): ModuleLoader | null {
  const key = normalizeModuleLocalSpecifier(specifier);
  return entry[collection]?.[key] ?? null;
}

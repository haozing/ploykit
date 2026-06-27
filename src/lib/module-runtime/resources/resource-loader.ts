import type { ModuleAssetsDefinition } from '@ploykit/module-sdk';
import type { ModuleRuntimeHost } from '../host';

export interface ModuleLocaleResource {
  locale: string;
  path: string;
}

export interface ModuleAssetResource {
  path: string;
  kind: 'asset' | 'worker' | 'wasm';
  contentType: string;
  maxBytes: number | null;
  cache: {
    immutable: boolean;
  };
}

export interface ModuleResourceBundle {
  moduleId: string;
  locales: ModuleLocaleResource[];
  assets: ModuleAssetResource[];
}

function normalizeResourcePath(path: string): string {
  const normalized = path.replace(/^\.\//, '').replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('../')) {
    throw new Error(`MODULE_RESOURCE_PATH_UNSAFE: ${path}`);
  }
  return normalized;
}

function inferAssetKind(path: string): ModuleAssetResource['kind'] {
  if (path.endsWith('.wasm')) {
    return 'wasm';
  }
  if (path.includes('.worker.')) {
    return 'worker';
  }
  return 'asset';
}

function inferContentType(path: string): string {
  if (path.endsWith('.wasm')) {
    return 'application/wasm';
  }
  if (path.endsWith('.js') || path.endsWith('.mjs')) {
    return 'text/javascript; charset=utf-8';
  }
  if (path.endsWith('.json')) {
    return 'application/json; charset=utf-8';
  }
  if (path.endsWith('.css')) {
    return 'text/css; charset=utf-8';
  }
  if (path.endsWith('.svg')) {
    return 'image/svg+xml';
  }
  if (path.endsWith('.png')) {
    return 'image/png';
  }
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) {
    return 'image/jpeg';
  }
  return 'application/octet-stream';
}

function declaredAssets(
  assets: ModuleAssetsDefinition
): readonly NonNullable<ModuleAssetsDefinition['assets']>[number][] {
  return assets.assets ?? [];
}

export function resolveModuleResources(
  host: ModuleRuntimeHost,
  moduleId: string
): ModuleResourceBundle {
  const contract = host.getContract(moduleId);
  const entry = host.getMapEntry(moduleId);
  if (!contract || !entry) {
    throw new Error(`MODULE_RESOURCES_RUNTIME_ENTRY_MISSING: ${moduleId}`);
  }

  const assetSet = new Set(entry.assets ?? []);
  const staticAssets = contract.assets;
  return {
    moduleId,
    locales: Object.entries(staticAssets.locales ?? {}).map(([locale, path]) => ({
      locale,
      path: normalizeResourcePath(path),
    })),
    assets: declaredAssets(staticAssets).map((asset) => {
      const path = normalizeResourcePath(asset.path);
      if (assetSet.size > 0 && !assetSet.has(path)) {
        throw new Error(`MODULE_ASSET_NOT_IN_MAP: ${moduleId}.${path}`);
      }

      return {
        path,
        kind: asset.kind ?? inferAssetKind(path),
        contentType: asset.contentType ?? inferContentType(path),
        maxBytes: asset.maxBytes ?? null,
        cache: {
          immutable: true,
        },
      };
    }),
  };
}

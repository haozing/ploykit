import fs from 'node:fs/promises';
import path from 'node:path';
import { PluginError, type PluginAssetDeclaration } from '@ploykit/plugin-sdk';
import type { PluginRuntimeContract } from '../contract';
import type { PluginRuntimeMapEntry } from '../loader';

const DEFAULT_MAX_ASSET_BYTES = 100 * 1024 * 1024;
const LONG_CACHE_SECONDS = 365 * 24 * 60 * 60;
const SHORT_CACHE_SECONDS = 300;

export interface PluginRuntimeAsset {
  path: string;
  url: string;
  kind: NonNullable<PluginAssetDeclaration['kind']>;
  contentType: string;
  maxBytes?: number;
  cacheControl: string;
}

export interface PluginAssetReadResult extends PluginRuntimeAsset {
  absolutePath: string;
  body: ArrayBuffer;
  size: number;
}

function stripLeadingAssetPathPrefix(assetPath: string): string {
  return assetPath.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function normalizePluginAssetPath(assetPath: string): string {
  const normalized = path.posix.normalize(stripLeadingAssetPathPrefix(assetPath));

  if (
    !normalized ||
    normalized === '.' ||
    normalized.startsWith('../') ||
    normalized === '..' ||
    path.posix.isAbsolute(normalized)
  ) {
    throw new PluginError({
      code: 'PLUGIN_ASSET_PATH_INVALID',
      message: `Plugin asset path "${assetPath}" must stay inside the plugin assets directory.`,
      statusCode: 400,
      fix: 'Use a plugin-local path such as "./assets/icon.png".',
      details: { assetPath },
    });
  }

  if (!normalized.startsWith('assets/')) {
    throw new PluginError({
      code: 'PLUGIN_ASSET_PATH_INVALID',
      message: `Plugin asset path "${assetPath}" must live under ./assets/.`,
      statusCode: 400,
      fix: 'Move frontend assets under ./assets/ and declare that path.',
      details: { assetPath },
    });
  }

  return normalized;
}

function normalizeAssetDeclaration(asset: string | PluginAssetDeclaration): PluginAssetDeclaration {
  const declaration = typeof asset === 'string' ? { path: asset } : asset;
  const normalizedPath = normalizePluginAssetPath(declaration.path);

  return {
    ...declaration,
    path: normalizedPath,
    kind: declaration.kind ?? inferAssetKind(normalizedPath),
    contentType: declaration.contentType ?? inferAssetContentType(normalizedPath),
  };
}

export function listPluginAssetDeclarations(
  contract: PluginRuntimeContract
): PluginAssetDeclaration[] {
  const seen = new Set<string>();
  const declarations: PluginAssetDeclaration[] = [];

  for (const asset of contract.resources.assets ?? []) {
    const declaration = normalizeAssetDeclaration(asset);
    if (seen.has(declaration.path)) {
      continue;
    }
    seen.add(declaration.path);
    declarations.push(declaration);
  }

  return declarations;
}

export function findPluginAssetDeclaration(
  contract: PluginRuntimeContract,
  assetPath: string
): PluginAssetDeclaration | null {
  const normalizedPath = normalizePluginAssetPath(assetPath);

  return (
    listPluginAssetDeclarations(contract).find(
      (declaration) => declaration.path === normalizedPath
    ) ?? null
  );
}

export function createPluginAssetUrl(pluginId: string, assetPath: string): string {
  const normalizedPath = normalizePluginAssetPath(assetPath);
  const encodedPath = normalizedPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  return `/api/plugin-assets/${encodeURIComponent(pluginId)}/${encodedPath}`;
}

export function listPluginRuntimeAssets(contract: PluginRuntimeContract): PluginRuntimeAsset[] {
  return listPluginAssetDeclarations(contract).map((declaration) =>
    toRuntimeAsset(contract.id, declaration)
  );
}

export function toRuntimeAsset(
  pluginId: string,
  declaration: PluginAssetDeclaration
): PluginRuntimeAsset {
  const assetPath = normalizePluginAssetPath(declaration.path);
  const contentType = declaration.contentType ?? inferAssetContentType(assetPath);

  return {
    path: assetPath,
    url: createPluginAssetUrl(pluginId, assetPath),
    kind: declaration.kind ?? inferAssetKind(assetPath),
    contentType,
    maxBytes: declaration.maxBytes,
    cacheControl: createPluginAssetCacheControl(assetPath, declaration),
  };
}

export function assertPluginAssetDeclared(
  contract: PluginRuntimeContract,
  assetPath: string
): PluginAssetDeclaration {
  const declaration = findPluginAssetDeclaration(contract, assetPath);
  if (!declaration) {
    throw new PluginError({
      code: 'PLUGIN_ASSET_NOT_DECLARED',
      message: `Plugin "${contract.id}" has not declared asset "${assetPath}".`,
      statusCode: 404,
      fix: 'Declare the asset in plugin.ts resources.assets before loading it from the frontend.',
      details: {
        pluginId: contract.id,
        assetPath,
      },
    });
  }

  return declaration;
}

export function resolvePluginAssetRoot(entry: PluginRuntimeMapEntry | null | undefined): string {
  if (!entry?.rootDir) {
    throw new PluginError({
      code: 'PLUGIN_ASSET_ROOT_UNAVAILABLE',
      message: 'Plugin assets cannot be served because the runtime map has no plugin root.',
      statusCode: 500,
      fix: 'Run npm run plugins:scan so the plugin map includes rootDir.',
    });
  }

  return path.resolve(process.cwd(), entry.rootDir);
}

export function resolvePluginAssetFilePath(
  entry: PluginRuntimeMapEntry,
  assetPath: string
): string {
  const rootDir = resolvePluginAssetRoot(entry);
  const normalizedPath = normalizePluginAssetPath(assetPath);
  const absolutePath = path.resolve(rootDir, normalizedPath);
  const relative = path.relative(rootDir, absolutePath);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new PluginError({
      code: 'PLUGIN_ASSET_PATH_INVALID',
      message: `Plugin asset path "${assetPath}" escapes the plugin directory.`,
      statusCode: 400,
      fix: 'Use a plugin-local asset path under ./assets/.',
      details: { assetPath },
    });
  }

  return absolutePath;
}

export async function readPluginAsset(
  contract: PluginRuntimeContract,
  entry: PluginRuntimeMapEntry,
  assetPath: string
): Promise<PluginAssetReadResult> {
  const declaration = assertPluginAssetDeclared(contract, assetPath);
  const runtimeAsset = toRuntimeAsset(contract.id, declaration);
  const absolutePath = resolvePluginAssetFilePath(entry, runtimeAsset.path);
  const stats = await fs.stat(absolutePath).catch(() => null);

  if (!stats?.isFile()) {
    throw new PluginError({
      code: 'PLUGIN_ASSET_FILE_NOT_FOUND',
      message: `Declared plugin asset "${runtimeAsset.path}" was not found on disk.`,
      statusCode: 404,
      fix: 'Create the file under the plugin assets directory or remove the declaration.',
      details: {
        pluginId: contract.id,
        assetPath: runtimeAsset.path,
      },
    });
  }

  const maxBytes = declaration.maxBytes ?? DEFAULT_MAX_ASSET_BYTES;
  if (stats.size > maxBytes) {
    throw new PluginError({
      code: 'PLUGIN_ASSET_SIZE_EXCEEDED',
      message: `Declared plugin asset "${runtimeAsset.path}" exceeds its size limit.`,
      statusCode: 413,
      fix: 'Reduce the asset size or raise resources.assets[].maxBytes within the allowed limit.',
      details: {
        pluginId: contract.id,
        assetPath: runtimeAsset.path,
        size: stats.size,
        maxBytes,
      },
    });
  }

  const buffer = await fs.readFile(absolutePath);
  const body = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(body).set(buffer);

  return {
    ...runtimeAsset,
    absolutePath,
    body,
    size: stats.size,
  };
}

export function createPluginAssetCacheControl(
  assetPath: string,
  declaration?: Pick<PluginAssetDeclaration, 'cache'>
): string {
  const cache = declaration?.cache;
  if (cache?.strategy === 'none') {
    return 'no-store';
  }

  if (cache?.strategy === 'private') {
    const maxAge = cache.maxAgeSeconds ?? SHORT_CACHE_SECONDS;
    return `private, max-age=${maxAge}`;
  }

  if (cache?.strategy === 'public') {
    const parts = [`public, max-age=${cache.maxAgeSeconds ?? SHORT_CACHE_SECONDS}`];
    if (cache.staleWhileRevalidateSeconds !== undefined) {
      parts.push(`stale-while-revalidate=${cache.staleWhileRevalidateSeconds}`);
    }
    return parts.join(', ');
  }

  if (hasContentHash(assetPath)) {
    return `public, max-age=${LONG_CACHE_SECONDS}, immutable`;
  }

  return `public, max-age=${SHORT_CACHE_SECONDS}`;
}

function hasContentHash(assetPath: string): boolean {
  const fileName = path.posix.basename(assetPath);
  return /(?:^|[.-])[a-f0-9]{8,}(?:[.-]|$)/i.test(fileName);
}

function inferAssetKind(assetPath: string): NonNullable<PluginAssetDeclaration['kind']> {
  const extension = path.posix.extname(assetPath).toLowerCase();
  const fileName = path.posix.basename(assetPath).toLowerCase();

  if (extension === '.wasm') {
    return 'wasm';
  }

  if (fileName.includes('worker.')) {
    return 'worker';
  }

  return 'asset';
}

function inferAssetContentType(assetPath: string): string {
  switch (path.posix.extname(assetPath).toLowerCase()) {
    case '.avif':
      return 'image/avif';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.gif':
      return 'image/gif';
    case '.ico':
      return 'image/x-icon';
    case '.jpeg':
    case '.jpg':
      return 'image/jpeg';
    case '.js':
    case '.mjs':
      return 'application/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.otf':
      return 'font/otf';
    case '.png':
      return 'image/png';
    case '.svg':
      return 'image/svg+xml; charset=utf-8';
    case '.ttf':
      return 'font/ttf';
    case '.wasm':
      return 'application/wasm';
    case '.webp':
      return 'image/webp';
    case '.woff':
      return 'font/woff';
    case '.woff2':
      return 'font/woff2';
    default:
      return 'application/octet-stream';
  }
}

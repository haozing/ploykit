import fs from 'fs';
import path from 'path';
import type {
  RuntimeAppBundle,
  RuntimeBundlePlugin,
  RuntimeCatalogDocument,
  RuntimePluginSuite,
  RuntimeProduct,
} from './runtime-catalog-types';
import { normalizePlanCapabilityDefinitions } from '@/lib/entitlements/plan-capability-types';
import { normalizeProductScopeProfile } from '@/lib/product-scope/product-scope-profile';

export const RUNTIME_CATALOG_FILE_ENV = 'PLOYKIT_RUNTIME_CATALOG_FILE';

export interface RuntimeCatalogLoadResult {
  files: string[];
  products: RuntimeProduct[];
  suites: RuntimePluginSuite[];
  bundles: RuntimeAppBundle[];
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readBoolean(record: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = record[key];
  return typeof value === 'boolean' ? value : fallback;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readRecordArray(value: unknown): Array<Record<string, unknown>> | undefined {
  return Array.isArray(value)
    ? value.map(readRecord).filter((item): item is Record<string, unknown> => Boolean(item))
    : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim())
    : [];
}

function normalizeProduct(value: unknown, file: string): RuntimeProduct {
  const record = readRecord(value);
  const id = record ? readString(record, 'id') : undefined;
  const name = record ? readString(record, 'name') : undefined;
  if (!record || !id || !name) {
    throw new Error(`Runtime catalog "${file}" has a product without required id/name.`);
  }

  return {
    id,
    name,
    runtimeKey: readString(record, 'runtimeKey'),
    defaultLocale: readString(record, 'defaultLocale'),
    status: readString(record, 'status') ?? 'active',
    scopeProfile: normalizeProductScopeProfile(record.scopeProfile, `${file}:products.${id}`),
    planCapabilities: normalizePlanCapabilityDefinitions(record.planCapabilities, {
      ownerType: 'product',
      ownerId: id,
      source: file,
    }),
    metadata: readRecord(record.metadata),
  };
}

function normalizeSuite(value: unknown, file: string): RuntimePluginSuite {
  const record = readRecord(value);
  const id = record ? readString(record, 'id') : undefined;
  const productId = record ? readString(record, 'productId') : undefined;
  const name = record ? readString(record, 'name') : undefined;
  if (!record || !id || !productId || !name) {
    throw new Error(`Runtime catalog "${file}" has a suite without required id/productId/name.`);
  }

  return {
    id,
    productId,
    name,
    version: readString(record, 'version'),
    status: readString(record, 'status') ?? 'active',
    plugins: readStringArray(record.plugins),
    menu: readRecord(record.menu) as RuntimePluginSuite['menu'],
    billing: readRecord(record.billing) as RuntimePluginSuite['billing'],
    sharedServiceConnections: readRecordArray(record.sharedServiceConnections),
    sharedResourceBindings: readRecordArray(record.sharedResourceBindings),
    metadata: readRecord(record.metadata),
  };
}

function normalizeBundlePlugin(value: unknown, file: string): RuntimeBundlePlugin {
  const record = readRecord(value);
  const pluginId = record ? readString(record, 'pluginId') : undefined;
  if (!record || !pluginId) {
    throw new Error(`Runtime catalog "${file}" has a bundle plugin without required pluginId.`);
  }

  return {
    pluginId,
    enableByDefault: readBoolean(record, 'enableByDefault', true),
    required: readBoolean(record, 'required', false),
  };
}

function normalizeBundle(value: unknown, file: string): RuntimeAppBundle {
  const record = readRecord(value);
  const id = record ? readString(record, 'id') : undefined;
  const productId = record ? readString(record, 'productId') : undefined;
  const name = record ? readString(record, 'name') : undefined;
  if (!record || !id || !productId || !name || !Array.isArray(record.plugins)) {
    throw new Error(
      `Runtime catalog "${file}" has a bundle without required id/productId/name/plugins.`
    );
  }

  const seeds = readRecord(record.seeds);
  return {
    id,
    productId,
    suiteId: readString(record, 'suiteId'),
    name,
    version: readString(record, 'version'),
    sourceType: readString(record, 'sourceType'),
    sourceRef: readString(record, 'sourceRef'),
    plugins: record.plugins.map((plugin) => normalizeBundlePlugin(plugin, file)),
    seeds: seeds
      ? {
          serviceConnections: readRecordArray(seeds.serviceConnections),
          resourceBindings: readRecordArray(seeds.resourceBindings),
        }
      : undefined,
    healthChecks: readRecordArray(record.healthChecks),
    dependencies: readRecord(record.dependencies),
    metadata: readRecord(record.metadata),
  };
}

function splitCatalogFiles(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveCatalogFile(cwd: string, file: string): string {
  return path.isAbsolute(file) ? file : path.resolve(cwd, file);
}

function readCatalogDocument(file: string): RuntimeCatalogDocument {
  if (!fs.existsSync(file)) {
    throw new Error(`Runtime catalog file does not exist: ${file}`);
  }

  const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as RuntimeCatalogDocument;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Runtime catalog file is not a JSON object: ${file}`);
  }
  return parsed;
}

let cachedKey: string | undefined;
let cachedResult: RuntimeCatalogLoadResult | undefined;

export function loadRuntimeCatalogFiles(cwd = process.cwd()): RuntimeCatalogLoadResult {
  // Tooling intentionally reads a host-owned runtime env var.
  // eslint-disable-next-line no-restricted-syntax
  const configuredFiles = splitCatalogFiles(process.env[RUNTIME_CATALOG_FILE_ENV]);
  const key = `${cwd}\n${configuredFiles.join('\n')}`;
  if (cachedKey === key && cachedResult) {
    return cachedResult;
  }

  const files = configuredFiles.map((file) => resolveCatalogFile(cwd, file));
  const products: RuntimeProduct[] = [];
  const suites: RuntimePluginSuite[] = [];
  const bundles: RuntimeAppBundle[] = [];

  for (const file of files) {
    const document = readCatalogDocument(file);
    products.push(...(document.products ?? []).map((product) => normalizeProduct(product, file)));
    suites.push(...(document.suites ?? []).map((suite) => normalizeSuite(suite, file)));
    bundles.push(...(document.bundles ?? []).map((bundle) => normalizeBundle(bundle, file)));
  }

  cachedKey = key;
  cachedResult = { files, products, suites, bundles };
  return cachedResult;
}

export function resetRuntimeCatalogFileCache(): void {
  cachedKey = undefined;
  cachedResult = undefined;
}

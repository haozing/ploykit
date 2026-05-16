/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const PLUGINS_DIR = path.join(process.cwd(), 'plugins');
const RUNTIME_MANIFEST_FILE = path.join(PLUGINS_DIR, 'runtime-manifest.json');
const OUTPUT_FILE = path.join(process.cwd(), 'src/lib/plugin-map.ts');
const MANIFEST_FILE = path.join(process.cwd(), 'src/lib/plugin-map.manifest.json');

/**
 * Calculate MD5 hash of content
 */
function getContentHash(content: string): string {
  return crypto.createHash('md5').update(content, 'utf-8').digest('hex');
}

/**
 * Recursively scan pages directory and collect all page file paths
 *
 * @param dir - Current directory being scanned
 * @param baseDir - Root path of the pages directory
 * @param pages - Array collecting page paths
 */
function scanPagesDirectory(dir: string, baseDir: string, pages: string[]): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Recursively scan subdirectories
      scanPagesDirectory(fullPath, baseDir, pages);
    } else if (entry.isFile()) {
      // Only process .tsx/.jsx files
      if (entry.name.endsWith('.tsx') || entry.name.endsWith('.jsx')) {
        // Calculate path relative to baseDir and remove extension
        const relativePath = path.relative(baseDir, fullPath);
        const pagePath = relativePath.replace(/\.(tsx|jsx)$/, '').replace(/\\/g, '/');
        pages.push(pagePath);
      }
    }
  }
}

function scanModuleDirectory(
  dir: string,
  baseDir: string,
  modules: string[],
  extensions: readonly string[] = ['.ts', '.tsx', '.js', '.jsx']
): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      scanModuleDirectory(fullPath, baseDir, modules, extensions);
      continue;
    }

    if (!entry.isFile() || entry.name.includes('.test.')) {
      continue;
    }

    const extension = extensions.find((item) => entry.name.endsWith(item));
    if (!extension) {
      continue;
    }

    const relativePath = path.relative(baseDir, fullPath);
    modules.push(relativePath.slice(0, -extension.length).replace(/\\/g, '/'));
  }
}

interface PluginInfo {
  id: string;
  rootDir: string;
  productId: string;
  suiteId: string;
  bundleIds: string[];
  hasPluginContract: boolean;
  components: string[]; // Component list (without extensions)
  pages: string[]; // Page path list (relative to plugin root, without extensions)
  apiModules: string[];
  lifecycleModules: string[];
  jobModules: string[];
  webhookModules: string[];
  eventModules: string[];
  hookModules: string[];
  slotModules: string[];
}

interface RuntimeProductManifest {
  id: string;
  name: string;
  runtimeKey?: string;
  defaultLocale?: string;
  status?: string;
  suites?: string[];
  bundles?: string[];
  metadata?: Record<string, unknown>;
}

interface RuntimeSuiteManifest {
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

interface RuntimeBundlePluginManifest {
  pluginId: string;
  enableByDefault?: boolean;
  required?: boolean;
}

interface RuntimeBundleManifest {
  id: string;
  productId: string;
  suiteId?: string;
  name: string;
  version?: string;
  sourceType?: 'local' | 'npm' | 'git' | string;
  sourceRef?: string;
  plugins: RuntimeBundlePluginManifest[];
  seeds?: {
    internalServices?: Array<Record<string, unknown>>;
    resourceBindings?: Array<Record<string, unknown>>;
  };
  healthChecks?: Array<Record<string, unknown>>;
  dependencies?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

interface RuntimeManifest {
  version: 1;
  defaultProductId: string;
  products: RuntimeProductManifest[];
  suites: RuntimeSuiteManifest[];
  bundles: RuntimeBundleManifest[];
}

interface RuntimeManifestIndex {
  manifest: RuntimeManifest;
  pluginSuites: Map<string, RuntimeSuiteManifest>;
  pluginBundles: Map<string, RuntimeBundleManifest[]>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertStringArray(value: unknown, pathName: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${pathName} must be a non-empty string array`);
  }

  return value;
}

function normalizeBundlePlugins(value: unknown, pathName: string): RuntimeBundlePluginManifest[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${pathName} must contain at least one plugin`);
  }

  return value.map((item, index) => {
    if (!isPlainObject(item) || typeof item.pluginId !== 'string' || !item.pluginId.trim()) {
      throw new Error(`${pathName}.${index}.pluginId must be a non-empty string`);
    }

    return {
      pluginId: item.pluginId,
      enableByDefault:
        typeof item.enableByDefault === 'boolean' ? item.enableByDefault : undefined,
      required: typeof item.required === 'boolean' ? item.required : undefined,
    };
  });
}

function readRuntimeManifest(): RuntimeManifestIndex {
  if (!fs.existsSync(RUNTIME_MANIFEST_FILE)) {
    throw new Error(
      'plugins/runtime-manifest.json is required. PloyKit runtime plugins must declare product, suite, and bundle ownership.'
    );
  }

  const raw = JSON.parse(fs.readFileSync(RUNTIME_MANIFEST_FILE, 'utf-8')) as unknown;
  if (!isPlainObject(raw) || raw.version !== 1) {
    throw new Error('plugins/runtime-manifest.json must declare { "version": 1 }');
  }

  if (typeof raw.defaultProductId !== 'string' || !raw.defaultProductId.trim()) {
    throw new Error('plugins/runtime-manifest.json must declare defaultProductId');
  }

  const rawProducts = Array.isArray(raw.products) ? raw.products : [];
  const rawSuites = Array.isArray(raw.suites) ? raw.suites : [];
  const rawBundles = Array.isArray(raw.bundles) ? raw.bundles : [];

  const products: RuntimeProductManifest[] = rawProducts.map((item, index) => {
    if (!isPlainObject(item) || typeof item.id !== 'string' || typeof item.name !== 'string') {
      throw new Error(`products.${index} must declare id and name`);
    }

    return {
      id: item.id,
      name: item.name,
      runtimeKey: typeof item.runtimeKey === 'string' ? item.runtimeKey : undefined,
      defaultLocale: typeof item.defaultLocale === 'string' ? item.defaultLocale : undefined,
      status: typeof item.status === 'string' ? item.status : undefined,
      suites: item.suites ? assertStringArray(item.suites, `products.${index}.suites`) : [],
      bundles: item.bundles ? assertStringArray(item.bundles, `products.${index}.bundles`) : [],
      metadata: isPlainObject(item.metadata) ? item.metadata : undefined,
    };
  });

  if (!products.some((product) => product.id === raw.defaultProductId)) {
    throw new Error(`defaultProductId "${raw.defaultProductId}" is not declared in products`);
  }

  const productIds = new Set(products.map((product) => product.id));
  const suites: RuntimeSuiteManifest[] = rawSuites.map((item, index) => {
    if (
      !isPlainObject(item) ||
      typeof item.id !== 'string' ||
      typeof item.productId !== 'string' ||
      typeof item.name !== 'string'
    ) {
      throw new Error(`suites.${index} must declare id, productId, and name`);
    }

    if (!productIds.has(item.productId)) {
      throw new Error(`suites.${index}.productId "${item.productId}" is not declared`);
    }

    return {
      id: item.id,
      productId: item.productId,
      name: item.name,
      version: typeof item.version === 'string' ? item.version : undefined,
      status: typeof item.status === 'string' ? item.status : undefined,
      plugins: assertStringArray(item.plugins, `suites.${index}.plugins`),
      menu: isPlainObject(item.menu)
        ? {
            group: String(item.menu.group ?? ''),
            labelKey: typeof item.menu.labelKey === 'string' ? item.menu.labelKey : undefined,
            fallbackLabel:
              typeof item.menu.fallbackLabel === 'string' ? item.menu.fallbackLabel : undefined,
          }
        : undefined,
      billing: isPlainObject(item.billing)
        ? {
            namespace: String(item.billing.namespace ?? ''),
            primaryCreditMetric:
              typeof item.billing.primaryCreditMetric === 'string'
                ? item.billing.primaryCreditMetric
                : undefined,
          }
        : undefined,
      sharedServices: Array.isArray(item.sharedServices)
        ? (item.sharedServices as Array<Record<string, unknown>>)
        : undefined,
      sharedResourceBindings: Array.isArray(item.sharedResourceBindings)
        ? (item.sharedResourceBindings as Array<Record<string, unknown>>)
        : undefined,
      metadata: isPlainObject(item.metadata) ? item.metadata : undefined,
    };
  });

  const suiteIds = new Set(suites.map((suite) => suite.id));
  const bundles: RuntimeBundleManifest[] = rawBundles.map((item, index) => {
    if (
      !isPlainObject(item) ||
      typeof item.id !== 'string' ||
      typeof item.productId !== 'string' ||
      typeof item.name !== 'string'
    ) {
      throw new Error(`bundles.${index} must declare id, productId, and name`);
    }

    if (!productIds.has(item.productId)) {
      throw new Error(`bundles.${index}.productId "${item.productId}" is not declared`);
    }
    if (typeof item.suiteId === 'string' && !suiteIds.has(item.suiteId)) {
      throw new Error(`bundles.${index}.suiteId "${item.suiteId}" is not declared`);
    }

    return {
      id: item.id,
      productId: item.productId,
      suiteId: typeof item.suiteId === 'string' ? item.suiteId : undefined,
      name: item.name,
      version: typeof item.version === 'string' ? item.version : undefined,
      sourceType: typeof item.sourceType === 'string' ? item.sourceType : undefined,
      sourceRef: typeof item.sourceRef === 'string' ? item.sourceRef : undefined,
      plugins: normalizeBundlePlugins(item.plugins, `bundles.${index}.plugins`),
      seeds: isPlainObject(item.seeds)
        ? {
            internalServices: Array.isArray(item.seeds.internalServices)
              ? (item.seeds.internalServices as Array<Record<string, unknown>>)
              : undefined,
            resourceBindings: Array.isArray(item.seeds.resourceBindings)
              ? (item.seeds.resourceBindings as Array<Record<string, unknown>>)
              : undefined,
          }
        : undefined,
      healthChecks: Array.isArray(item.healthChecks)
        ? (item.healthChecks as Array<Record<string, unknown>>)
        : undefined,
      dependencies: isPlainObject(item.dependencies) ? item.dependencies : undefined,
      metadata: isPlainObject(item.metadata) ? item.metadata : undefined,
    };
  });

  const pluginSuites = new Map<string, RuntimeSuiteManifest>();
  for (const suite of suites) {
    for (const pluginId of suite.plugins) {
      if (pluginSuites.has(pluginId)) {
        throw new Error(
          `Plugin "${pluginId}" is declared in multiple suites. A runtime plugin must have exactly one suite.`
        );
      }
      pluginSuites.set(pluginId, suite);
    }
  }

  const pluginBundles = new Map<string, RuntimeBundleManifest[]>();
  for (const bundle of bundles) {
    for (const plugin of bundle.plugins) {
      const current = pluginBundles.get(plugin.pluginId) ?? [];
      current.push(bundle);
      pluginBundles.set(plugin.pluginId, current);
    }
  }

  return {
    manifest: {
      version: 1,
      defaultProductId: raw.defaultProductId,
      products,
      suites,
      bundles,
    },
    pluginSuites,
    pluginBundles,
  };
}

function scanPlugins(runtimeManifest: RuntimeManifestIndex): PluginInfo[] {
  const plugins: PluginInfo[] = [];

  if (!fs.existsSync(PLUGINS_DIR)) {
    console.warn('⚠️  Plugins directory not found');
    return plugins;
  }

  const entries = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const pluginId = entry.name;
    const pluginPath = path.join(PLUGINS_DIR, pluginId);

    const hasPluginContract = fs.existsSync(path.join(pluginPath, 'plugin.ts'));

    if (!hasPluginContract) {
      console.warn(`Plugin ${pluginId} missing plugin.ts, skipping runtime contract target`);
      continue;
    }

    const suite = runtimeManifest.pluginSuites.get(pluginId);
    if (!suite) {
      throw new Error(
        `Plugin "${pluginId}" is missing from plugins/runtime-manifest.json suites[].plugins.`
      );
    }
    const bundles = runtimeManifest.pluginBundles.get(pluginId) ?? [];
    if (bundles.length === 0) {
      throw new Error(
        `Plugin "${pluginId}" is missing from plugins/runtime-manifest.json bundles[].plugins.`
      );
    }

    // Scan components directory
    const components: string[] = [];
    const componentsDir = path.join(pluginPath, 'components');
    if (fs.existsSync(componentsDir)) {
      scanModuleDirectory(componentsDir, componentsDir, components, ['.tsx', '.jsx']);
    }

    // Scan pages directory (recursively scan all subdirectories)
    const pages: string[] = [];
    const pagesDir = path.join(pluginPath, 'pages');
    if (fs.existsSync(pagesDir)) {
      scanPagesDirectory(pagesDir, pagesDir, pages);
    }

    const apiModules: string[] = [];
    const apiDir = path.join(pluginPath, 'api');
    if (fs.existsSync(apiDir)) {
      scanModuleDirectory(apiDir, pluginPath, apiModules, ['.ts', '.js']);
    }

    const lifecycleModules: string[] = [];
    const lifecycleDir = path.join(pluginPath, 'lifecycle');
    if (fs.existsSync(lifecycleDir)) {
      scanModuleDirectory(lifecycleDir, pluginPath, lifecycleModules, ['.ts', '.js']);
    }

    const jobModules: string[] = [];
    const jobsDir = path.join(pluginPath, 'jobs');
    if (fs.existsSync(jobsDir)) {
      scanModuleDirectory(jobsDir, pluginPath, jobModules, ['.ts', '.js']);
    }

    const webhookModules: string[] = [];
    const webhooksDir = path.join(pluginPath, 'webhooks');
    if (fs.existsSync(webhooksDir)) {
      scanModuleDirectory(webhooksDir, pluginPath, webhookModules, ['.ts', '.js']);
    }

    const eventModules: string[] = [];
    const eventsDir = path.join(pluginPath, 'events');
    if (fs.existsSync(eventsDir)) {
      scanModuleDirectory(eventsDir, pluginPath, eventModules, ['.ts', '.js']);
    }

    const hookModules: string[] = [];
    const hooksDir = path.join(pluginPath, 'hooks');
    if (fs.existsSync(hooksDir)) {
      scanModuleDirectory(hooksDir, pluginPath, hookModules, ['.ts', '.js']);
    }

    const slotModules: string[] = [];
    const slotsDir = path.join(pluginPath, 'slots');
    if (fs.existsSync(slotsDir)) {
      scanModuleDirectory(slotsDir, pluginPath, slotModules);
    }

    plugins.push({
      id: pluginId,
      rootDir: path.relative(process.cwd(), pluginPath).replace(/\\/g, '/'),
      productId: suite.productId,
      suiteId: suite.id,
      bundleIds: bundles.map((bundle) => bundle.id),
      hasPluginContract,
      components,
      pages,
      apiModules,
      lifecycleModules,
      jobModules,
      webhookModules,
      eventModules,
      hookModules,
      slotModules,
    });
  }

  return plugins;
}

function generatePluginMap(plugins: PluginInfo[], runtimeManifest: RuntimeManifest): string {
  const entries = plugins.map((plugin) => {
    const {
      id,
      rootDir,
      productId,
      suiteId,
      bundleIds,
      hasPluginContract,
      components,
      pages,
      apiModules,
      lifecycleModules,
      jobModules,
      webhookModules,
      eventModules,
      hookModules,
      slotModules,
    } = plugin;
    const parts: string[] = [];

    parts.push(`    rootDir: ${JSON.stringify(rootDir)},`);
    parts.push(`    productId: ${JSON.stringify(productId)},`);
    parts.push(`    suiteId: ${JSON.stringify(suiteId)},`);
    parts.push(`    bundleIds: ${JSON.stringify(bundleIds)},`);

    if (hasPluginContract) {
      parts.push(`    plugin: () => import('@/plugins/${id}/plugin'),`);
    }
    // Add components field
    if (components.length > 0) {
      const componentEntries = components.map((componentPath) => {
        const importPath = `@/plugins/${id}/components/${componentPath}`;
        return `      'components/${componentPath}': () => import('${importPath}')`;
      });
      parts.push(`    components: {\n${componentEntries.join(',\n')}\n    },`);
    }

    // Add pages field (page mappings)
    if (pages.length > 0) {
      const pageEntries = pages.map(
        (pagePath) => `      'pages/${pagePath}': () => import('@/plugins/${id}/pages/${pagePath}')`
      );
      parts.push(`    pages: {\n${pageEntries.join(',\n')}\n    },`);
    }

    if (apiModules.length > 0) {
      const apiEntries = apiModules.map(
        (modulePath) => `      '${modulePath}': () => import('@/plugins/${id}/${modulePath}')`
      );
      parts.push(`    apis: {\n${apiEntries.join(',\n')}\n    },`);
    }

    if (lifecycleModules.length > 0) {
      const lifecycleEntries = lifecycleModules.map(
        (modulePath) => `      '${modulePath}': () => import('@/plugins/${id}/${modulePath}')`
      );
      parts.push(`    lifecycleModules: {\n${lifecycleEntries.join(',\n')}\n    },`);
    }

    if (jobModules.length > 0) {
      const jobEntries = jobModules.map(
        (modulePath) => `      '${modulePath}': () => import('@/plugins/${id}/${modulePath}')`
      );
      parts.push(`    jobModules: {\n${jobEntries.join(',\n')}\n    },`);
    }

    if (webhookModules.length > 0) {
      const webhookEntries = webhookModules.map(
        (modulePath) => `      '${modulePath}': () => import('@/plugins/${id}/${modulePath}')`
      );
      parts.push(`    webhookModules: {\n${webhookEntries.join(',\n')}\n    },`);
    }

    if (eventModules.length > 0) {
      const eventEntries = eventModules.map(
        (modulePath) => `      '${modulePath}': () => import('@/plugins/${id}/${modulePath}')`
      );
      parts.push(`    eventModules: {\n${eventEntries.join(',\n')}\n    },`);
    }

    if (hookModules.length > 0) {
      const hookEntries = hookModules.map(
        (modulePath) => `      '${modulePath}': () => import('@/plugins/${id}/${modulePath}')`
      );
      parts.push(`    hookModules: {\n${hookEntries.join(',\n')}\n    },`);
    }

    if (slotModules.length > 0) {
      const slotEntries = slotModules.map(
        (modulePath) => `      '${modulePath}': () => import('@/plugins/${id}/${modulePath}')`
      );
      parts.push(`    slotModules: {\n${slotEntries.join(',\n')}\n    },`);
    }

    return `  '${id}': {\n${parts.join('\n')}\n  }`;
  });

  return `/**
 * This file is auto-generated.
 *
 * Dev mode: Automatically updated by scripts/watch-plugins.ts when changes are detected
 * Build mode: Generated by scripts/generate-plugin-map.ts before build
 *
 * Do not modify manually.
 *
 * Plugin count: ${plugins.length}
 */

type PluginModuleLoader = () => Promise<unknown>;

export interface RuntimeProductMapEntry {
  id: string;
  name: string;
  runtimeKey?: string;
  defaultLocale?: string;
  status?: string;
  suites: string[];
  bundles: string[];
  metadata?: Record<string, unknown>;
}

export interface RuntimeSuiteMapEntry {
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

export interface RuntimeBundlePluginMapEntry {
  pluginId: string;
  enableByDefault: boolean;
  required: boolean;
}

export interface RuntimeBundleMapEntry {
  id: string;
  productId: string;
  suiteId?: string;
  name: string;
  version?: string;
  sourceType?: string;
  sourceRef?: string;
  plugins: RuntimeBundlePluginMapEntry[];
  seeds?: {
    internalServices?: Array<Record<string, unknown>>;
    resourceBindings?: Array<Record<string, unknown>>;
  };
  healthChecks?: Array<Record<string, unknown>>;
  dependencies?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface PluginMapEntry {
  rootDir?: string;
  productId: string;
  suiteId: string;
  bundleIds: string[];
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
}

export const DEFAULT_RUNTIME_PRODUCT_ID = ${JSON.stringify(runtimeManifest.defaultProductId)};

export const RUNTIME_PRODUCTS: Record<string, RuntimeProductMapEntry> = ${JSON.stringify(
    Object.fromEntries(runtimeManifest.products.map((product) => [product.id, product])),
    null,
    2
  )};

export const PLUGIN_SUITES: Record<string, RuntimeSuiteMapEntry> = ${JSON.stringify(
    Object.fromEntries(runtimeManifest.suites.map((suite) => [suite.id, suite])),
    null,
    2
  )};

export const APP_BUNDLES: Record<string, RuntimeBundleMapEntry> = ${JSON.stringify(
    Object.fromEntries(
      runtimeManifest.bundles.map((bundle) => [
        bundle.id,
        {
          ...bundle,
          plugins: bundle.plugins.map((plugin) => ({
            pluginId: plugin.pluginId,
            enableByDefault: plugin.enableByDefault ?? true,
            required: plugin.required ?? true,
          })),
        },
      ])
    ),
    null,
    2
  )};

export const PLUGIN_MAP: Record<string, PluginMapEntry> = {
${entries.join(',\n')}
};
`;
}

function generatePluginManifest(plugins: PluginInfo[], runtimeManifest: RuntimeManifest): string {
  return `${JSON.stringify(
    {
      version: 2,
      defaultProductId: runtimeManifest.defaultProductId,
      products: runtimeManifest.products,
      suites: runtimeManifest.suites,
      bundles: runtimeManifest.bundles,
      plugins: plugins.map((plugin) => ({
        id: plugin.id,
        rootDir: plugin.rootDir,
        productId: plugin.productId,
        suiteId: plugin.suiteId,
        bundleIds: plugin.bundleIds,
        components: plugin.components,
        pages: plugin.pages,
        apiModules: plugin.apiModules,
        lifecycleModules: plugin.lifecycleModules,
        jobModules: plugin.jobModules,
        webhookModules: plugin.webhookModules,
        eventModules: plugin.eventModules,
        hookModules: plugin.hookModules,
        slotModules: plugin.slotModules,
      })),
    },
    null,
    2
  )}\n`;
}

function main() {
  const isCI = process.env.CI === 'true';
  const isBuild = process.argv.includes('--build');
  const isCheck = process.argv.includes('--check');
  const isQuiet = isCI || isBuild || isCheck;

  if (!isQuiet) {
    console.log('Scanning plugins directory...');
  }

  const runtimeManifest = readRuntimeManifest();
  const plugins = scanPlugins(runtimeManifest);

  if (!isQuiet) {
    console.log(`Found ${plugins.length} plugins:`);
    plugins.forEach((p) => {
      const features = [];
      if (p.hasPluginContract) features.push('plugin.ts');
      if (p.components.length > 0) features.push(`${p.components.length} components`);
      if (p.pages.length > 0) features.push(`${p.pages.length} pages`);
      if (p.apiModules.length > 0) features.push(`${p.apiModules.length} api modules`);
      if (p.lifecycleModules.length > 0) {
        features.push(`${p.lifecycleModules.length} lifecycle modules`);
      }
      if (p.jobModules.length > 0) features.push(`${p.jobModules.length} job modules`);
      if (p.webhookModules.length > 0) {
        features.push(`${p.webhookModules.length} webhook modules`);
      }
      if (p.eventModules.length > 0) {
        features.push(`${p.eventModules.length} event modules`);
      }
      if (p.hookModules.length > 0) {
        features.push(`${p.hookModules.length} hook modules`);
      }
      if (p.slotModules.length > 0) {
        features.push(`${p.slotModules.length} slot modules`);
      }
      console.log(`   - ${p.id} (${features.join(', ')})`);
    });
  }

  const content = generatePluginMap(plugins, runtimeManifest.manifest);
  const manifestContent = generatePluginManifest(plugins, runtimeManifest.manifest);

  // --check mode: verify existing plugin-map.ts matches current plugins/ directory
  if (isCheck) {
    if (!fs.existsSync(OUTPUT_FILE)) {
      console.error('Plugin map check failed: src/lib/plugin-map.ts does not exist');
      console.error(
        '   Fix: run npm run plugins:scan, then commit src/lib/plugin-map.ts and manifest'
      );
      process.exit(1);
    }

    if (!fs.existsSync(MANIFEST_FILE)) {
      console.error('Plugin map check failed: src/lib/plugin-map.manifest.json does not exist');
      console.error(
        '   Fix: run npm run plugins:scan, then commit src/lib/plugin-map.manifest.json'
      );
      process.exit(1);
    }

    const existingContent = fs.readFileSync(OUTPUT_FILE, 'utf-8');
    const existingManifestContent = fs.readFileSync(MANIFEST_FILE, 'utf-8');
    const newHash = getContentHash(content);
    const existingHash = getContentHash(existingContent);
    const newManifestHash = getContentHash(manifestContent);
    const existingManifestHash = getContentHash(existingManifestContent);

    if (newHash !== existingHash || newManifestHash !== existingManifestHash) {
      console.error(
        'Plugin map check failed: plugins/ directory does not match src/lib/plugin-map.ts'
      );
      console.error(
        '   Fix: run npm run plugins:scan, then commit src/lib/plugin-map.ts and manifest'
      );
      process.exit(1);
    }

    console.log('Plugin map check passed');
    return;
  }

  // Ensure directory exists
  const outputDir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Compare content hash to avoid unnecessary writes that trigger HMR
  const newHash = getContentHash(content);
  const newManifestHash = getContentHash(manifestContent);
  let manifestChanged = true;

  if (fs.existsSync(OUTPUT_FILE)) {
    const existingContent = fs.readFileSync(OUTPUT_FILE, 'utf-8');
    const existingHash = getContentHash(existingContent);

    if (newHash === existingHash) {
      if (fs.existsSync(MANIFEST_FILE)) {
        const existingManifestContent = fs.readFileSync(MANIFEST_FILE, 'utf-8');
        const existingManifestHash = getContentHash(existingManifestContent);
        manifestChanged = newManifestHash !== existingManifestHash;
      }

      if (manifestChanged) {
        fs.writeFileSync(MANIFEST_FILE, manifestContent, 'utf-8');
        if (!isQuiet) {
          console.log(`Generated: ${path.relative(process.cwd(), MANIFEST_FILE)}`);
        }
        return;
      }

      if (!isQuiet) {
        console.log('No changes detected, skipping write');
      }
      return;
    }
  }

  fs.writeFileSync(OUTPUT_FILE, content, 'utf-8');
  fs.writeFileSync(MANIFEST_FILE, manifestContent, 'utf-8');

  if (!isQuiet) {
    console.log(`Generated: ${path.relative(process.cwd(), MANIFEST_FILE)}`);
    console.log(`Generated: ${path.relative(process.cwd(), OUTPUT_FILE)}`);
  }
}

main();

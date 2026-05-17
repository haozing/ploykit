/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  EXTERNAL_PLUGIN_DIRS_ENV,
  discoverPluginRootsInSourceTarget,
  formatPluginSourcePath,
  getPluginSourceTargets,
  type PluginSourceKind,
} from '@/lib/plugin-runtime/plugin-source-dirs';

const PROJECT_ROOT = process.cwd();
const OUTPUT_FILE = path.join(PROJECT_ROOT, 'src/lib/plugin-map.ts');
const OUTPUT_DIR = path.dirname(OUTPUT_FILE);
const MANIFEST_FILE = path.join(PROJECT_ROOT, 'src/lib/plugin-map.manifest.json');

function getContentHash(content: string): string {
  return crypto.createHash('md5').update(content, 'utf-8').digest('hex');
}

function scanPagesDirectory(dir: string, baseDir: string, pages: string[]): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      scanPagesDirectory(fullPath, baseDir, pages);
      continue;
    }

    if (!entry.isFile() || (!entry.name.endsWith('.tsx') && !entry.name.endsWith('.jsx'))) {
      continue;
    }

    const relativePath = path.relative(baseDir, fullPath);
    pages.push(relativePath.replace(/\.(tsx|jsx)$/, '').replace(/\\/g, '/'));
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
  absoluteRootDir: string;
  sourceDir: string;
  sourceKind: PluginSourceKind;
  components: string[];
  pages: string[];
  apiModules: string[];
  lifecycleModules: string[];
  jobModules: string[];
  webhookModules: string[];
  eventModules: string[];
  hookModules: string[];
  slotModules: string[];
}

function scanPlugins(): PluginInfo[] {
  const plugins: PluginInfo[] = [];
  const seen = new Map<string, PluginInfo>();
  const sourceTargets = getPluginSourceTargets({ cwd: PROJECT_ROOT });

  for (const sourceTarget of sourceTargets) {
    if (!sourceTarget.exists) {
      if (sourceTarget.kind === 'external') {
        throw new Error(
          `Configured external plugin directory not found: ${sourceTarget.configuredValue}. ` +
            `Update ${EXTERNAL_PLUGIN_DIRS_ENV} or create the directory.`
        );
      }
      console.warn('Plugins directory not found');
      continue;
    }

    for (const pluginPath of discoverPluginRootsInSourceTarget(sourceTarget)) {
      const pluginId = path.basename(pluginPath);

      if (seen.has(pluginId)) {
        const existing = seen.get(pluginId)!;
        throw new Error(
          `Duplicate plugin id "${pluginId}" found in ${existing.rootDir} and ${formatPluginSourcePath(
            pluginPath,
            PROJECT_ROOT
          )}. Plugin ids must be unique across all configured plugin directories.`
        );
      }

      const components: string[] = [];
      const componentsDir = path.join(pluginPath, 'components');
      if (fs.existsSync(componentsDir)) {
        scanModuleDirectory(componentsDir, componentsDir, components, ['.tsx', '.jsx']);
      }

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
        rootDir: formatPluginSourcePath(pluginPath, PROJECT_ROOT),
        absoluteRootDir: pluginPath,
        sourceDir: sourceTarget.displayPath,
        sourceKind: sourceTarget.kind,
        components: components.sort(),
        pages: pages.sort(),
        apiModules: apiModules.sort(),
        lifecycleModules: lifecycleModules.sort(),
        jobModules: jobModules.sort(),
        webhookModules: webhookModules.sort(),
        eventModules: eventModules.sort(),
        hookModules: hookModules.sort(),
        slotModules: slotModules.sort(),
      });

      seen.set(pluginId, plugins.at(-1)!);
    }
  }

  return plugins;
}

function assertSameVolumeForImport(modulePath: string): void {
  if (process.platform !== 'win32') {
    return;
  }

  const outputRoot = path.parse(OUTPUT_DIR).root.toLowerCase();
  const moduleRoot = path.parse(modulePath).root.toLowerCase();
  if (outputRoot !== moduleRoot) {
    throw new Error(
      `External plugin module "${modulePath}" is on a different Windows drive than the project. ` +
        `Move the plugin directory onto ${outputRoot} or use a symlink/junction under the project.`
    );
  }
}

function moduleSpecifier(modulePath: string): string {
  assertSameVolumeForImport(modulePath);
  let relativePath = path.relative(OUTPUT_DIR, modulePath).replace(/\\/g, '/');
  if (!relativePath.startsWith('.')) {
    relativePath = `./${relativePath}`;
  }
  return relativePath;
}

function moduleMap(
  plugin: PluginInfo,
  modules: string[],
  keyPrefix: string,
  importPrefix: string
): string | null {
  if (modules.length === 0) {
    return null;
  }

  return modules
    .map((modulePath) => {
      const key = keyPrefix ? `${keyPrefix}/${modulePath}` : modulePath;
      const importPath = importPrefix ? path.join(importPrefix, modulePath) : modulePath;
      return `      '${key}': () => import(${JSON.stringify(
        moduleSpecifier(path.join(plugin.absoluteRootDir, importPath))
      )})`;
    })
    .join(',\n');
}

function generatePluginMap(plugins: PluginInfo[]): string {
  const entries = plugins.map((plugin) => {
    const parts: string[] = [
      `    rootDir: ${JSON.stringify(plugin.rootDir)},`,
      `    sourceDir: ${JSON.stringify(plugin.sourceDir)},`,
      `    sourceKind: ${JSON.stringify(plugin.sourceKind)},`,
      `    plugin: () => import(${JSON.stringify(
        moduleSpecifier(path.join(plugin.absoluteRootDir, 'plugin'))
      )}),`,
    ];

    const components = moduleMap(plugin, plugin.components, 'components', 'components');
    if (components) {
      parts.push(`    components: {\n${components}\n    },`);
    }

    const pages = moduleMap(plugin, plugin.pages, 'pages', 'pages');
    if (pages) {
      parts.push(`    pages: {\n${pages}\n    },`);
    }

    const apis = moduleMap(plugin, plugin.apiModules, '', '');
    if (apis) {
      parts.push(`    apis: {\n${apis}\n    },`);
    }

    const lifecycleModules = moduleMap(plugin, plugin.lifecycleModules, '', '');
    if (lifecycleModules) {
      parts.push(`    lifecycleModules: {\n${lifecycleModules}\n    },`);
    }

    const jobModules = moduleMap(plugin, plugin.jobModules, '', '');
    if (jobModules) {
      parts.push(`    jobModules: {\n${jobModules}\n    },`);
    }

    const webhookModules = moduleMap(plugin, plugin.webhookModules, '', '');
    if (webhookModules) {
      parts.push(`    webhookModules: {\n${webhookModules}\n    },`);
    }

    const eventModules = moduleMap(plugin, plugin.eventModules, '', '');
    if (eventModules) {
      parts.push(`    eventModules: {\n${eventModules}\n    },`);
    }

    const hookModules = moduleMap(plugin, plugin.hookModules, '', '');
    if (hookModules) {
      parts.push(`    hookModules: {\n${hookModules}\n    },`);
    }

    const slotModules = moduleMap(plugin, plugin.slotModules, '', '');
    if (slotModules) {
      parts.push(`    slotModules: {\n${slotModules}\n    },`);
    }

    return `  '${plugin.id}': {\n${parts.join('\n')}\n  }`;
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

export interface PluginMapEntry {
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
}

export const PLUGIN_MAP: Record<string, PluginMapEntry> = {
${entries.join(',\n')}
};
`;
}

function generatePluginManifest(plugins: PluginInfo[]): string {
  return `${JSON.stringify(
    {
      version: 4,
      sourceDirs: getPluginSourceTargets({ cwd: PROJECT_ROOT }).map((target) => ({
        path: target.displayPath,
        kind: target.kind,
        directPluginRoot: target.directPluginRoot,
      })),
      plugins: plugins.map((plugin) => ({
        id: plugin.id,
        rootDir: plugin.rootDir,
        sourceDir: plugin.sourceDir,
        sourceKind: plugin.sourceKind,
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

function printPlugins(plugins: PluginInfo[]): void {
  console.log(`Found ${plugins.length} plugins:`);
  plugins.forEach((plugin) => {
    const features = ['plugin.ts'];
    if (plugin.components.length > 0) features.push(`${plugin.components.length} components`);
    if (plugin.pages.length > 0) features.push(`${plugin.pages.length} pages`);
    if (plugin.apiModules.length > 0) features.push(`${plugin.apiModules.length} api modules`);
    if (plugin.lifecycleModules.length > 0) {
      features.push(`${plugin.lifecycleModules.length} lifecycle modules`);
    }
    if (plugin.jobModules.length > 0) features.push(`${plugin.jobModules.length} job modules`);
    if (plugin.webhookModules.length > 0) {
      features.push(`${plugin.webhookModules.length} webhook modules`);
    }
    if (plugin.eventModules.length > 0) {
      features.push(`${plugin.eventModules.length} event modules`);
    }
    if (plugin.hookModules.length > 0) features.push(`${plugin.hookModules.length} hook modules`);
    if (plugin.slotModules.length > 0) features.push(`${plugin.slotModules.length} slot modules`);
    console.log(`   - ${plugin.id} (${features.join(', ')})`);
  });
}

function main() {
  const isCI = process.env.CI === 'true';
  const isBuild = process.argv.includes('--build');
  const isCheck = process.argv.includes('--check');
  const isQuiet = isCI || isBuild || isCheck;

  if (!isQuiet) {
    console.log('Scanning plugin source directories...');
  }

  const plugins = scanPlugins();

  if (!isQuiet) {
    printPlugins(plugins);
  }

  const content = generatePluginMap(plugins);
  const manifestContent = generatePluginManifest(plugins);

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

    if (
      getContentHash(content) !== getContentHash(existingContent) ||
      getContentHash(manifestContent) !== getContentHash(existingManifestContent)
    ) {
      console.error(
        'Plugin map check failed: configured plugin source directories do not match src/lib/plugin-map.ts'
      );
      console.error(
        '   Fix: run npm run plugins:scan, then commit src/lib/plugin-map.ts and manifest'
      );
      process.exit(1);
    }

    console.log('Plugin map check passed');
    return;
  }

  const outputDir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const contentChanged =
    !fs.existsSync(OUTPUT_FILE) ||
    getContentHash(content) !== getContentHash(fs.readFileSync(OUTPUT_FILE, 'utf-8'));
  const manifestChanged =
    !fs.existsSync(MANIFEST_FILE) ||
    getContentHash(manifestContent) !== getContentHash(fs.readFileSync(MANIFEST_FILE, 'utf-8'));

  if (!contentChanged && !manifestChanged) {
    if (!isQuiet) {
      console.log('No changes detected, skipping write');
    }
    return;
  }

  if (contentChanged) {
    fs.writeFileSync(OUTPUT_FILE, content, 'utf-8');
    if (!isQuiet) {
      console.log(`Generated: ${path.relative(process.cwd(), OUTPUT_FILE)}`);
    }
  }

  if (manifestChanged) {
    fs.writeFileSync(MANIFEST_FILE, manifestContent, 'utf-8');
    if (!isQuiet) {
      console.log(`Generated: ${path.relative(process.cwd(), MANIFEST_FILE)}`);
    }
  }
}

main();

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { register } from 'tsx/esm/api';

const PROJECT_ROOT = process.cwd();
const MODULE_DIRS_ENV = 'PLOYKIT_MODULE_DIRS';
const MODULE_DIR_ALLOWLIST_ENV = 'PLOYKIT_MODULE_DIR_ALLOWLIST';
const SOURCE_MAP_FILE = path.join(PROJECT_ROOT, 'src', 'lib', 'module-map.ts');
const SOURCE_MANIFEST_FILE = path.join(PROJECT_ROOT, 'src', 'lib', 'module-map.manifest.json');
const BUILD_ID = process.env.PLOYKIT_MODULE_BUILD_ID ?? 'local-dev';
const GENERATED_AT = '1970-01-01T00:00:00.000Z';
const tsx = register({ namespace: 'ploykit-module-map' });

function splitExternalDirs(value) {
  return value
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function slash(value) {
  return value.replace(/\\/g, '/');
}

function canonicalPath(value) {
  const resolved = path.resolve(PROJECT_ROOT, value);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function isPathInsideDirectory(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function externalDirAllowlist() {
  return [
    canonicalPath(PROJECT_ROOT),
    ...splitExternalDirs(process.env[MODULE_DIR_ALLOWLIST_ENV] ?? '').map(canonicalPath),
  ];
}

function assertExternalDirAllowed(configuredValue, dir) {
  const candidate = canonicalPath(dir);
  if (externalDirAllowlist().some((allowed) => isPathInsideDirectory(allowed, candidate))) {
    return;
  }

  throw new Error(
    `External module directory "${configuredValue}" resolves outside the allowed module roots. ` +
      `Move it under the project root or add its parent directory to ${MODULE_DIR_ALLOWLIST_ENV}.`
  );
}

function getSourceTargets() {
  const targets = [
    {
      kind: 'default',
      configuredValue: 'modules',
      dir: path.join(PROJECT_ROOT, 'modules'),
    },
  ];

  for (const configuredValue of splitExternalDirs(process.env[MODULE_DIRS_ENV] ?? '')) {
    const dir = path.resolve(PROJECT_ROOT, configuredValue);
    assertExternalDirAllowed(configuredValue, dir);
    targets.push({
      kind: 'external',
      configuredValue,
      dir,
    });
  }

  return targets;
}

function findModuleRoots(target) {
  if (!fs.existsSync(target.dir)) {
    if (target.kind === 'external') {
      throw new Error(`Configured module directory not found: ${target.configuredValue}`);
    }
    return [];
  }

  if (fs.existsSync(path.join(target.dir, 'module.ts'))) {
    return [target.dir];
  }

  return fs
    .readdirSync(target.dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(target.dir, entry.name))
    .filter((dir) => fs.existsSync(path.join(dir, 'module.ts')));
}

function relativeToProject(file) {
  return slash(path.relative(PROJECT_ROOT, file));
}

function moduleSpecifier(modulePath, outputDir) {
  let relativePath = slash(path.relative(outputDir, modulePath));
  if (!relativePath.startsWith('.')) {
    relativePath = `./${relativePath}`;
  }
  return relativePath.replace(/\.(ts|tsx|js|jsx)$/, '');
}

function scanDirectory(root, dirName, extensions = ['.ts', '.tsx', '.js', '.jsx']) {
  const dir = path.join(root, dirName);
  const modules = [];
  if (!fs.existsSync(dir)) {
    return modules;
  }

  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (!entry.isFile() || entry.name.includes('.test.')) {
        continue;
      }
      const extension = extensions.find((candidate) => entry.name.endsWith(candidate));
      if (!extension) {
        continue;
      }
      modules.push(slash(path.relative(root, fullPath).slice(0, -extension.length)));
    }
  }

  visit(dir);
  return modules.sort();
}

function scanFiles(root, dirName) {
  const dir = path.join(root, dirName);
  const files = [];
  if (!fs.existsSync(dir)) {
    return files;
  }

  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (entry.isFile()) {
        files.push(slash(path.relative(root, fullPath)));
      }
    }
  }

  visit(dir);
  return files.sort();
}

function readDefaultExport(value) {
  return value && typeof value === 'object' && 'default' in value ? value.default : value;
}

async function readModuleDefinition(root) {
  const loaded = await tsx.import(pathToFileURL(path.join(root, 'module.ts')).href, import.meta.url);
  const definition = readDefaultExport(loaded);
  if (!definition || typeof definition !== 'object') {
    throw new Error(`Module ${relativeToProject(root)} did not export a module definition.`);
  }
  return definition;
}

function readModuleSummary(root, definition) {
  const source = fs.readFileSync(path.join(root, 'module.ts'), 'utf8');
  const id =
    typeof definition.id === 'string'
      ? definition.id
      : source.match(/\bid\s*:\s*['"`]([^'"`]+)['"`]/)?.[1] ?? path.basename(root);
  const name =
    typeof definition.name === 'string'
      ? definition.name
      : source.match(/\bname\s*:\s*['"`]([^'"`]+)['"`]/)?.[1] ?? id;
  const version =
    typeof definition.version === 'string'
      ? definition.version
      : source.match(/\bversion\s*:\s*['"`]([^'"`]+)['"`]/)?.[1] ?? '0.0.0';
  return { id, name, version };
}

function listSourceFiles(root) {
  const files = [];
  const ignored = new Set(['node_modules', '.next', '.runtime', 'dist']);

  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.') && entry.name !== '.ploykit') {
        continue;
      }
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) {
          visit(path.join(current, entry.name));
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const extension = path.extname(entry.name);
      if (!['.ts', '.tsx', '.js', '.jsx', '.json', '.sql', '.md'].includes(extension)) {
        continue;
      }
      if (entry.name.includes('.test.')) {
        continue;
      }
      files.push(path.join(current, entry.name));
    }
  }

  visit(root);
  return files.sort((left, right) => slash(path.relative(root, left)).localeCompare(slash(path.relative(root, right))));
}

function hashFiles(root, files) {
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    const relative = slash(path.relative(root, file));
    hash.update(relative);
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function readModuleSource(root) {
  return fs.readFileSync(path.join(root, 'module.ts'), 'utf8');
}

function recordKeys(value) {
  return Object.keys(value ?? {});
}

function countNavigation(navigation) {
  if (!navigation) {
    return 0;
  }
  return Array.isArray(navigation) ? navigation.length : 1;
}

function routeCommercialRequirements(definition) {
  const routes = definition.routes ?? {};
  return [
    ...(routes.site ?? []),
    ...(routes.dashboard ?? []),
    ...(routes.admin ?? []),
    ...(routes.api ?? []),
  ]
    .map((route) => route.commercial)
    .filter(Boolean);
}

function actionCommercialRequirements(definition) {
  return Object.values(definition.actions ?? {})
    .map((action) => action.commercial)
    .filter(Boolean);
}

function collectEntitlements(requirements) {
  return [
    ...new Set(requirements.flatMap((requirement) => [...(requirement.entitlements ?? [])])),
  ];
}

function hasCredits(requirements) {
  return requirements.some((requirement) => Boolean(requirement.credits));
}

function createMapCapabilitySummary(definition) {
  const routes = definition.routes ?? {};
  const routeCommercial = routeCommercialRequirements(definition);
  const actionCommercial = actionCommercialRequirements(definition);
  return {
    routes:
      (routes.site ?? []).length +
      (routes.dashboard ?? []).length +
      (routes.admin ?? []).length +
      (routes.api ?? []).length,
    dataModels:
      recordKeys(definition.data?.tables).length +
      recordKeys(definition.data?.documents).length +
      recordKeys(definition.data?.views).length,
    permissions: (definition.permissions ?? []).length,
    backgroundHandlers:
      recordKeys(definition.jobs).length +
      recordKeys(definition.events?.subscribes).length +
      recordKeys(definition.webhooks).length,
    providerRequirements:
      recordKeys(definition.serviceRequirements).length +
      recordKeys(definition.resourceBindings).length +
      (definition.egress ?? []).length,
    commercialRequirements:
      recordKeys(definition.meters).length +
      collectEntitlements(routeCommercial).length +
      collectEntitlements(actionCommercial).length +
      (hasCredits([...routeCommercial, ...actionCommercial]) ? 1 : 0),
    presentationContributions:
      countNavigation(definition.navigation) +
      recordKeys(definition.surfaces).length +
      (definition.presentation?.replaces ?? []).length +
      recordKeys(definition.theme?.tokens).length,
  };
}

function normalizeQualityDefinition(definition) {
  if (!definition.quality || typeof definition.quality !== 'object') {
    return undefined;
  }
  return JSON.parse(JSON.stringify(definition.quality));
}

function normalizeProductDefinition(definition) {
  if (!definition.product || typeof definition.product !== 'object') {
    return undefined;
  }
  return JSON.parse(JSON.stringify(definition.product));
}

async function scanModules() {
  const modules = [];
  const seen = new Map();

  for (const target of getSourceTargets()) {
    for (const root of findModuleRoots(target)) {
      const definition = await readModuleDefinition(root);
      const summary = readModuleSummary(root, definition);
      if (seen.has(summary.id)) {
        throw new Error(
          `Duplicate module id "${summary.id}" found in ${seen.get(summary.id)} and ${relativeToProject(root)}.`
        );
      }
      seen.set(summary.id, relativeToProject(root));
      modules.push({
        ...summary,
        root,
        rootDir: relativeToProject(root),
        sourceDir: relativeToProject(target.dir),
        sourceKind: target.kind,
        pages: scanDirectory(root, 'pages'),
        apis: scanDirectory(root, 'api', ['.ts', '.js']),
        loaders: scanDirectory(root, 'loaders', ['.ts', '.js']),
        actions: scanDirectory(root, 'actions', ['.ts', '.js']),
        services: scanDirectory(root, 'services', ['.ts', '.js']),
        components: scanDirectory(root, 'components'),
        surfaces: scanDirectory(root, 'surfaces'),
        lifecycle: scanDirectory(root, 'lifecycle', ['.ts', '.js']),
        jobs: scanDirectory(root, 'jobs', ['.ts', '.js']),
        events: scanDirectory(root, 'events', ['.ts', '.js']),
        webhooks: scanDirectory(root, 'webhooks', ['.ts', '.js']),
        assets: scanFiles(root, 'assets'),
      });
      const latest = modules[modules.length - 1];
      const sourceFiles = listSourceFiles(root);
      latest.release = {
        generatedAt: GENERATED_AT,
        buildId: BUILD_ID,
        sourceHash: hashFiles(root, sourceFiles),
        contractDigest: crypto.createHash('sha256').update(readModuleSource(root)).digest('hex'),
        sourceFiles: sourceFiles.map((file) => slash(path.relative(root, file))),
        capabilitySummary: createMapCapabilitySummary(definition),
      };
      const quality = normalizeQualityDefinition(definition);
      if (quality) {
        latest.quality = quality;
      }
      const product = normalizeProductDefinition(definition);
      if (product) {
        latest.product = product;
      }
    }
  }

  return modules.sort((left, right) => left.id.localeCompare(right.id));
}

function runtimeModuleInfo(moduleInfo) {
  const { root, ...rest } = moduleInfo;
  return rest;
}

function moduleMapBlock(moduleInfo, modules, keyPrefix, importPrefix, outputDir) {
  if (modules.length === 0) {
    return null;
  }

  const lines = modules.map((modulePath) => {
    const key = keyPrefix
      ? `${keyPrefix}/${modulePath.replace(new RegExp(`^${keyPrefix}/`), '')}`
      : modulePath;
    const importPath = path.join(
      moduleInfo.root,
      importPrefix,
      modulePath.replace(new RegExp(`^${importPrefix}/`), '')
    );
    return `      ${JSON.stringify(key)}: () => import(${JSON.stringify(moduleSpecifier(importPath, outputDir))})`;
  });

  return lines.join(',\n');
}

function generateModuleMap(modules) {
  const outputDir = path.dirname(SOURCE_MAP_FILE);
  const entries = modules.map((moduleInfo) => {
    const runtimeInfo = runtimeModuleInfo(moduleInfo);
    const parts = [
      `    rootDir: ${JSON.stringify(runtimeInfo.rootDir)},`,
      `    sourceDir: ${JSON.stringify(runtimeInfo.sourceDir)},`,
      `    sourceKind: ${JSON.stringify(runtimeInfo.sourceKind)},`,
      `    release: ${JSON.stringify(runtimeInfo.release)},`,
      `    module: () => import(${JSON.stringify(moduleSpecifier(path.join(moduleInfo.root, 'module.ts'), outputDir))}),`,
    ];

    for (const [property, importPrefix] of [
      ['pages', ''],
      ['apis', ''],
      ['loaders', ''],
      ['actions', ''],
      ['services', ''],
      ['components', ''],
      ['surfaces', ''],
      ['lifecycle', ''],
      ['jobs', ''],
      ['events', ''],
      ['webhooks', ''],
    ]) {
      const block = moduleMapBlock(moduleInfo, moduleInfo[property], '', importPrefix, outputDir);
      if (block) {
        parts.push(`    ${property}: {\n${block}\n    },`);
      }
    }

    if (runtimeInfo.assets.length > 0) {
      parts.push(`    assets: ${JSON.stringify(runtimeInfo.assets)},`);
    }

    return `  ${JSON.stringify(moduleInfo.id)}: {\n${parts.join('\n')}\n  }`;
  });

  return `/**
 * This file is auto-generated by scripts/generate-module-map.mjs.
 * Do not edit manually.
 *
 * Module count: ${modules.length}
 */
import type { ModuleMapArtifact, ModuleRuntimeMapEntry } from './module-runtime';

export const MODULE_MAP: Record<string, ModuleRuntimeMapEntry> = {
${entries.join(',\n')}
};

export const MODULE_MAP_ARTIFACT: ModuleMapArtifact = {
  kind: 'source',
  buildId: ${JSON.stringify(BUILD_ID)},
  generatedAt: ${JSON.stringify(GENERATED_AT)},
  modules: MODULE_MAP,
};
`;
}

function generateManifest(modules) {
  return `${JSON.stringify(
    {
      version: 1,
      sourceDirs: getSourceTargets().map((target) => ({
        path: relativeToProject(target.dir),
        kind: target.kind,
      })),
      buildId: BUILD_ID,
      generatedAt: GENERATED_AT,
      modules: modules.map(runtimeModuleInfo),
    },
    null,
    2
  )}\n`;
}

function writeIfChanged(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (existing === content) {
    return false;
  }
  fs.writeFileSync(file, content, 'utf8');
  return true;
}

async function main() {
  const check = process.argv.includes('--check');
  const modules = await scanModules();
  const mapContent = generateModuleMap(modules);
  const manifestContent = generateManifest(modules);

  if (check) {
    const mapOk =
      fs.existsSync(SOURCE_MAP_FILE) && fs.readFileSync(SOURCE_MAP_FILE, 'utf8') === mapContent;
    const manifestOk =
      fs.existsSync(SOURCE_MANIFEST_FILE) &&
      fs.readFileSync(SOURCE_MANIFEST_FILE, 'utf8') === manifestContent;
    if (!mapOk || !manifestOk) {
      console.error('Module map check failed. Fix: run npm run modules:scan');
      process.exit(1);
    }
    console.log('Module map check passed');
    return;
  }

  const changed =
    writeIfChanged(SOURCE_MAP_FILE, mapContent) |
    writeIfChanged(SOURCE_MANIFEST_FILE, manifestContent);
  console.log(`Scanned ${modules.length} module(s)${changed ? ' and updated module map' : ''}.`);
}

try {
  await main();
} finally {
  await tsx.unregister();
}

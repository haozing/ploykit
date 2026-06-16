import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { register } from 'tsx/esm/api';
import {
  findModuleRootsInSource,
  getModuleSources,
  portableProjectPath,
  slash,
} from './lib/module-sources.mjs';
import './lib/module-sdk-alias.cjs';

const PROJECT_ROOT = process.cwd();
const SOURCE_MAP_FILE = path.join(PROJECT_ROOT, 'src', 'lib', 'module-map.ts');
const SOURCE_MANIFEST_FILE = path.join(PROJECT_ROOT, 'src', 'lib', 'module-map.manifest.json');
const BUILD_ID = process.env.PLOYKIT_MODULE_BUILD_ID ?? 'local-dev';
const GENERATED_AT = '1970-01-01T00:00:00.000Z';
const TSX_TSCONFIG = path.join(PROJECT_ROOT, 'tsconfig.json');
const tsx = register({ namespace: 'ploykit-module-map', tsconfig: TSX_TSCONFIG });

function getSourceTargets() {
  return getModuleSources(PROJECT_ROOT);
}

function relativeToProject(file) {
  return portableProjectPath(PROJECT_ROOT, file);
}

function isInsideProject(file) {
  const relative = path.relative(PROJECT_ROOT, file);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function moduleSpecifier(modulePath, outputDir) {
  if (!isInsideProject(modulePath)) {
    throw new Error(
      `Module map cannot import files outside the PloyKit workspace: ${relativeToProject(modulePath)}`
    );
  }
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

function isInsideDirectory(root, file) {
  const relative = path.relative(root, file);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalizeModuleResourcePath(moduleRoot, moduleId, resourcePath, kind) {
  if (typeof resourcePath !== 'string') {
    throw new Error(`Module ${moduleId} declares a non-string ${kind} resource path.`);
  }

  const normalized = resourcePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  if (!normalized || normalized.split('/').includes('..')) {
    throw new Error(`Module ${moduleId} declares an unsafe ${kind} resource path: ${resourcePath}`);
  }

  const file = path.resolve(moduleRoot, normalized);
  if (!isInsideDirectory(moduleRoot, file)) {
    throw new Error(
      `Module ${moduleId} ${kind} resource must stay inside ${relativeToProject(moduleRoot)}: ${resourcePath}`
    );
  }
  return { file, normalized: slash(path.relative(moduleRoot, file)) };
}

function readModuleLocaleMessages(root, definition, moduleId) {
  const locales = definition.resources?.locales;
  if (!locales || typeof locales !== 'object' || Array.isArray(locales)) {
    return undefined;
  }

  const messages = {};
  for (const [locale, resourcePath] of Object.entries(locales).sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    const { file, normalized } = normalizeModuleResourcePath(
      root,
      moduleId,
      resourcePath,
      'locale'
    );
    if (!fs.existsSync(file)) {
      throw new Error(
        `Module ${moduleId} locale "${locale}" points to a missing file: ${normalized}`
      );
    }

    try {
      messages[locale] = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Module ${moduleId} locale "${locale}" must be valid JSON (${normalized}): ${message}`
      );
    }
  }

  return Object.keys(messages).length > 0 ? messages : undefined;
}

function readDefaultExport(value) {
  let current = value;
  for (let index = 0; index < 5; index += 1) {
    if (!current || typeof current !== 'object' || !('default' in current)) {
      return current;
    }
    current = current.default;
  }
  return current;
}

async function readModuleDefinition(root) {
  const loaded = await tsx.import(
    pathToFileURL(path.join(root, 'module.ts')).href,
    import.meta.url
  );
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
      : (source.match(/\bid\s*:\s*['"`]([^'"`]+)['"`]/)?.[1] ?? path.basename(root));
  const name =
    typeof definition.name === 'string'
      ? definition.name
      : (source.match(/\bname\s*:\s*['"`]([^'"`]+)['"`]/)?.[1] ?? id);
  const version =
    typeof definition.version === 'string'
      ? definition.version
      : (source.match(/\bversion\s*:\s*['"`]([^'"`]+)['"`]/)?.[1] ?? '0.0.0');
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
  return files.sort((left, right) =>
    slash(path.relative(root, left)).localeCompare(slash(path.relative(root, right)))
  );
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
  return [...new Set(requirements.flatMap((requirement) => [...(requirement.entitlements ?? [])]))];
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
  const sourceConfig = getSourceTargets();

  for (const target of sourceConfig.sources) {
    for (const root of findModuleRootsInSource(target)) {
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
      const messages = readModuleLocaleMessages(root, definition, summary.id);
      if (messages) {
        latest.messages = messages;
      }
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

function manifestModuleInfo(moduleInfo) {
  const { messages, ...rest } = runtimeModuleInfo(moduleInfo);
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

    if (runtimeInfo.messages && Object.keys(runtimeInfo.messages).length > 0) {
      parts.push(`    messages: ${JSON.stringify(runtimeInfo.messages)},`);
    }

    return `  ${JSON.stringify(moduleInfo.id)}: {\n${parts.join('\n')}\n  }`;
  });

  return `/**
 * This file is auto-generated by scripts/generate-module-map.mjs.
 * Do not edit manually.
 *
 * Module count: ${modules.length}
 */
import type {
  ModuleMapArtifact,
  ModuleRuntimeMapEntry,
} from './module-runtime/loader/module-map-types';

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

function createManifestArtifact(modules) {
  return {
    version: 1,
    buildId: BUILD_ID,
    generatedAt: GENERATED_AT,
    modules: modules.map(manifestModuleInfo),
  };
}

function generateManifest(modules) {
  return `${JSON.stringify(createManifestArtifact(modules), null, 2)}\n`;
}

function readJsonFile(file) {
  if (!fs.existsSync(file)) {
    return { ok: false, reason: 'missing' };
  }

  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function shortDigest(value) {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 12) : '<none>';
}

function mapManifestModules(manifest) {
  if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.modules)) {
    return null;
  }
  return new Map(
    manifest.modules
      .filter((moduleInfo) => moduleInfo && typeof moduleInfo.id === 'string')
      .map((moduleInfo) => [moduleInfo.id, moduleInfo])
  );
}

function formatValue(value) {
  return typeof value === 'string' && value.length > 0 ? value : '<none>';
}

function summarizeManifestDrift(existingManifest, nextManifest) {
  const lines = [];

  for (const field of ['buildId', 'generatedAt']) {
    if (existingManifest?.[field] !== nextManifest[field]) {
      lines.push(
        `${field}: ${formatValue(existingManifest?.[field])} -> ${formatValue(nextManifest[field])}`
      );
    }
  }

  const existingModules = mapManifestModules(existingManifest);
  const nextModules = mapManifestModules(nextManifest);
  if (!existingModules || !nextModules) {
    lines.push('module-map.manifest.json: existing manifest shape is invalid');
    return lines;
  }

  const moduleIds = [...new Set([...existingModules.keys(), ...nextModules.keys()])].sort();
  for (const id of moduleIds) {
    const previous = existingModules.get(id);
    const next = nextModules.get(id);
    if (!previous) {
      lines.push(`${id}: added at ${formatValue(next?.rootDir)}`);
      continue;
    }
    if (!next) {
      lines.push(`${id}: removed from ${formatValue(previous.rootDir)}`);
      continue;
    }

    const changes = [];
    if (previous.rootDir !== next.rootDir) {
      changes.push(`rootDir ${formatValue(previous.rootDir)} -> ${formatValue(next.rootDir)}`);
    }
    if (previous.version !== next.version) {
      changes.push(`version ${formatValue(previous.version)} -> ${formatValue(next.version)}`);
    }

    const previousRelease = previous.release ?? {};
    const nextRelease = next.release ?? {};
    for (const field of ['sourceHash', 'contractDigest']) {
      if (previousRelease[field] !== nextRelease[field]) {
        changes.push(
          `${field} ${shortDigest(previousRelease[field])} -> ${shortDigest(nextRelease[field])}`
        );
      }
    }

    if (changes.length > 0) {
      lines.push(`${id}: ${changes.join('; ')}`);
    }
  }

  return lines;
}

function printModuleMapCheckFailure({ mapOk, manifestOk, nextManifest }) {
  console.error('Module map check failed. Fix: run npm run modules:scan');
  console.error('');
  console.error('Drift summary:');

  if (!fs.existsSync(SOURCE_MAP_FILE)) {
    console.error('- src/lib/module-map.ts: missing generated file');
  } else if (!mapOk) {
    console.error('- src/lib/module-map.ts: generated import map differs');
  }

  const existingManifest = readJsonFile(SOURCE_MANIFEST_FILE);
  if (!existingManifest.ok) {
    console.error(`- src/lib/module-map.manifest.json: ${existingManifest.reason}`);
  } else if (!manifestOk) {
    const driftLines = summarizeManifestDrift(existingManifest.value, nextManifest);
    if (driftLines.length === 0) {
      console.error('- src/lib/module-map.manifest.json: generated manifest bytes differ');
    } else {
      for (const line of driftLines) {
        console.error(`- ${line}`);
      }
    }
  }

  console.error('');
  console.error('Fix command: npm run modules:scan');
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
  const nextManifest = createManifestArtifact(modules);
  const manifestContent = `${JSON.stringify(nextManifest, null, 2)}\n`;

  if (check) {
    const mapOk =
      fs.existsSync(SOURCE_MAP_FILE) && fs.readFileSync(SOURCE_MAP_FILE, 'utf8') === mapContent;
    const manifestOk =
      fs.existsSync(SOURCE_MANIFEST_FILE) &&
      fs.readFileSync(SOURCE_MANIFEST_FILE, 'utf8') === manifestContent;
    if (!mapOk || !manifestOk) {
      printModuleMapCheckFailure({ mapOk, manifestOk, nextManifest });
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

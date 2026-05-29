import fs from 'node:fs';
import path from 'node:path';

export const PLOYKIT_CONFIG_ENV = 'PLOYKIT_CONFIG';
export const PLOYKIT_CONFIG_FILE = 'ploykit.config.json';

const MODULE_SOURCE_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export function slash(value) {
  return value.replace(/\\/g, '/');
}

export function portableProjectPath(projectRoot, filePath) {
  const relative = path.relative(projectRoot, filePath);
  return slash(relative || '.');
}

export function canonicalPath(projectRoot, value) {
  const resolved = path.resolve(projectRoot, value);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

export function isPathInsideDirectory(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Failed to read ${slash(filePath)}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export function loadPloyKitConfig(projectRoot = process.cwd()) {
  const configuredPath = process.env[PLOYKIT_CONFIG_ENV] ?? PLOYKIT_CONFIG_FILE;
  const configPath = path.resolve(projectRoot, configuredPath);
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `PloyKit config not found: ${portableProjectPath(projectRoot, configPath)}. ` +
        `Create ${PLOYKIT_CONFIG_FILE} with moduleSources.`
    );
  }

  const config = readJson(configPath);
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`${portableProjectPath(projectRoot, configPath)} must contain a JSON object.`);
  }

  return { configPath, config };
}

function normalizeTrustedRoots(projectRoot, config) {
  const configuredRoots = Array.isArray(config.trustedModuleRoots)
    ? config.trustedModuleRoots
    : ['.'];
  const roots = configuredRoots
    .filter((entry) => typeof entry === 'string' && entry.trim())
    .map((entry) => canonicalPath(projectRoot, entry));
  const project = canonicalPath(projectRoot, projectRoot);
  return [...new Set([project, ...roots])];
}

function inferSourceKind(projectRoot, dir) {
  return isPathInsideDirectory(canonicalPath(projectRoot, projectRoot), canonicalPath(projectRoot, dir))
    ? 'workspace'
    : 'external';
}

function normalizeModuleSource(projectRoot, source, trustedRoots, index) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error(`moduleSources[${index}] must be an object with id and path.`);
  }

  const id = typeof source.id === 'string' ? source.id.trim() : '';
  const configuredPath = typeof source.path === 'string' ? source.path.trim() : '';
  if (!MODULE_SOURCE_ID_PATTERN.test(id)) {
    throw new Error(`moduleSources[${index}].id must match ${MODULE_SOURCE_ID_PATTERN}.`);
  }
  if (!configuredPath) {
    throw new Error(`moduleSources[${index}].path is required.`);
  }

  const dir = path.resolve(projectRoot, configuredPath);
  const canonicalDir = canonicalPath(projectRoot, dir);
  if (!trustedRoots.some((root) => isPathInsideDirectory(root, canonicalDir))) {
    throw new Error(
      `Module source "${id}" resolves outside trusted module roots: ${configuredPath}. ` +
        `Add its parent directory to trustedModuleRoots in ${PLOYKIT_CONFIG_FILE}.`
    );
  }

  return {
    id,
    configuredPath,
    dir,
    path: portableProjectPath(projectRoot, dir),
    kind: inferSourceKind(projectRoot, dir),
  };
}

export function getModuleSources(projectRoot = process.cwd()) {
  const { configPath, config } = loadPloyKitConfig(projectRoot);
  const sources = Array.isArray(config.moduleSources) ? config.moduleSources : [];
  if (sources.length === 0) {
    throw new Error(`${portableProjectPath(projectRoot, configPath)} must declare at least one module source.`);
  }

  const trustedRoots = normalizeTrustedRoots(projectRoot, config);
  const normalized = sources.map((source, index) =>
    normalizeModuleSource(projectRoot, source, trustedRoots, index)
  );
  const sourceIds = new Set();
  const sourcePaths = new Set();
  for (const source of normalized) {
    if (sourceIds.has(source.id)) {
      throw new Error(`Duplicate module source id: ${source.id}.`);
    }
    sourceIds.add(source.id);
    const canonicalDir = canonicalPath(projectRoot, source.dir);
    if (sourcePaths.has(canonicalDir)) {
      throw new Error(`Duplicate module source path: ${source.configuredPath}.`);
    }
    sourcePaths.add(canonicalDir);
  }

  return {
    configPath,
    trustedRoots: trustedRoots.map((root) => portableProjectPath(projectRoot, root)),
    sources: normalized,
  };
}

export function findModuleRootsInSource(source) {
  if (!fs.existsSync(source.dir)) {
    throw new Error(`Configured module source not found: ${source.configuredPath}`);
  }

  if (fs.existsSync(path.join(source.dir, 'module.ts'))) {
    return [source.dir];
  }

  return fs
    .readdirSync(source.dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(source.dir, entry.name))
    .filter((dir) => fs.existsSync(path.join(dir, 'module.ts')));
}

export function discoverConfiguredModuleRoots(projectRoot = process.cwd()) {
  return getModuleSources(projectRoot).sources.flatMap(findModuleRootsInSource);
}

export function discoverModuleRoots(projectRoot = process.cwd(), targetPath) {
  if (!targetPath || targetPath === 'all') {
    return discoverConfiguredModuleRoots(projectRoot);
  }

  const resolved = path.resolve(projectRoot, targetPath);
  if (fs.existsSync(path.join(resolved, 'module.ts'))) {
    return [resolved];
  }

  if (!fs.existsSync(resolved)) {
    const byId = discoverConfiguredModuleRoots(projectRoot).filter(
      (root) => readModuleIdFromSource(root) === targetPath || path.basename(root) === targetPath
    );
    return byId;
  }

  const source = {
    id: 'explicit',
    configuredPath: targetPath,
    dir: resolved,
    path: portableProjectPath(projectRoot, resolved),
    kind: inferSourceKind(projectRoot, resolved),
  };
  return findModuleRootsInSource(source);
}

export function readModuleIdFromSource(moduleRoot) {
  const moduleFile = path.join(moduleRoot, 'module.ts');
  if (!fs.existsSync(moduleFile)) {
    return path.basename(moduleRoot);
  }
  const source = fs.readFileSync(moduleFile, 'utf8');
  return source.match(/\bid\s*:\s*['"`]([^'"`]+)['"`]/)?.[1] ?? path.basename(moduleRoot);
}

export function readModuleMapManifest(projectRoot = process.cwd()) {
  const manifestPath = path.join(projectRoot, 'src', 'lib', 'module-map.manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return { manifestPath, modules: [], error: 'Module map manifest is missing.' };
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return {
      manifestPath,
      modules: Array.isArray(manifest.modules) ? manifest.modules : [],
      manifest,
    };
  } catch (error) {
    return {
      manifestPath,
      modules: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function resolveModuleRoot(projectRoot = process.cwd(), target) {
  if (!target) {
    throw new Error('Pass a module id or module root path.');
  }

  const resolved = path.resolve(projectRoot, target);
  if (fs.existsSync(path.join(resolved, 'module.ts'))) {
    return resolved;
  }

  const manifest = readModuleMapManifest(projectRoot);
  const targetAbsolute = slash(resolved);
  const match = manifest.modules.find((moduleInfo) => {
    const rootDir = typeof moduleInfo.rootDir === 'string' ? moduleInfo.rootDir : '';
    const absoluteRoot = rootDir ? slash(path.resolve(projectRoot, rootDir)) : '';
    return moduleInfo.id === target || rootDir === slash(target) || absoluteRoot === targetAbsolute;
  });
  if (match?.rootDir) {
    return path.resolve(projectRoot, match.rootDir);
  }

  const configuredMatch = discoverConfiguredModuleRoots(projectRoot).find((root) => {
    const id = readModuleIdFromSource(root);
    return id === target || path.basename(root) === target || slash(path.resolve(root)) === targetAbsolute;
  });
  if (configuredMatch) {
    return configuredMatch;
  }

  throw new Error(`Module target not found: ${target}. Run npm run modules:scan after updating moduleSources.`);
}

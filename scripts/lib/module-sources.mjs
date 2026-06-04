import fs from 'node:fs';
import path from 'node:path';

export const MODULE_CONFIG_FILE = 'ploykit.config.json';

const MODULE_SOURCE_ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const WORKSPACE_MODULE_SOURCE = Object.freeze({ id: 'workspace', path: 'modules' });

export function slash(value) {
  return value.replace(/\\/g, '/');
}

export function portableProjectPath(projectRoot, filePath) {
  const relative = path.relative(projectRoot, filePath);
  return slash(relative || '.');
}

export function canonicalPath(value) {
  const resolved = path.resolve(value);
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
  const configPath = path.resolve(projectRoot, MODULE_CONFIG_FILE);
  if (!fs.existsSync(configPath)) {
    return { configPath, config: {} };
  }

  const config = readJson(configPath);
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`${portableProjectPath(projectRoot, configPath)} must contain a JSON object.`);
  }

  return { configPath, config };
}

function assertProjectPath(projectRoot, filePath, label) {
  const project = canonicalPath(projectRoot);
  const candidate = canonicalPath(filePath);
  if (!isPathInsideDirectory(project, candidate)) {
    throw new Error(
      `${label} must live inside the PloyKit workspace. Move the module source into modules/<id>.`
    );
  }
  return candidate;
}

function moduleRootRelativePath(projectRoot, filePath) {
  return path.relative(canonicalPath(path.resolve(projectRoot, 'modules')), canonicalPath(filePath));
}

function isDirectWorkspaceModuleRoot(projectRoot, filePath) {
  const relative = moduleRootRelativePath(projectRoot, filePath);
  return (
    relative !== '' &&
    !relative.startsWith('..') &&
    !path.isAbsolute(relative) &&
    relative.split(path.sep).filter(Boolean).length === 1
  );
}

function isWorkspaceModuleSourcePath(projectRoot, filePath) {
  const relative = moduleRootRelativePath(projectRoot, filePath);
  return relative === '' || isDirectWorkspaceModuleRoot(projectRoot, filePath);
}

function assertModuleSourcePath(projectRoot, filePath, label) {
  assertProjectPath(projectRoot, filePath, label);
  if (!isWorkspaceModuleSourcePath(projectRoot, filePath)) {
    throw new Error(`${label} must point to modules or a module under modules/<id>.`);
  }
}

function assertModuleRootPath(projectRoot, filePath, label) {
  assertProjectPath(projectRoot, filePath, label);
  if (!isDirectWorkspaceModuleRoot(projectRoot, filePath)) {
    throw new Error(`${label} must live under modules/<id>.`);
  }
}

function normalizeModuleSource(projectRoot, source, index) {
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
  assertModuleSourcePath(projectRoot, dir, `Module source "${id}"`);

  return {
    id,
    configuredPath,
    dir,
    projectRoot,
    path: portableProjectPath(projectRoot, dir),
  };
}

export function getModuleSources(projectRoot = process.cwd()) {
  const { configPath, config } = loadPloyKitConfig(projectRoot);
  if (Array.isArray(config.trustedModuleRoots)) {
    throw new Error(
      `${portableProjectPath(projectRoot, configPath)} must not declare trustedModuleRoots. ` +
        'PloyKit modules must live under modules/<id>.'
    );
  }
  const sources = Array.isArray(config.moduleSources) ? config.moduleSources : [WORKSPACE_MODULE_SOURCE];
  if (sources.length === 0) {
    throw new Error(`${portableProjectPath(projectRoot, configPath)} must declare at least one module source.`);
  }

  const normalized = sources.map((source, index) => normalizeModuleSource(projectRoot, source, index));
  const sourceIds = new Set();
  const sourcePaths = new Set();
  for (const source of normalized) {
    if (sourceIds.has(source.id)) {
      throw new Error(`Duplicate module source id: ${source.id}.`);
    }
    sourceIds.add(source.id);
    const canonicalDir = canonicalPath(source.dir);
    if (sourcePaths.has(canonicalDir)) {
      throw new Error(`Duplicate module source path: ${source.configuredPath}.`);
    }
    sourcePaths.add(canonicalDir);
  }

  return {
    configPath,
    sources: normalized,
  };
}

export function findModuleRootsInSource(source) {
  if (!fs.existsSync(source.dir)) {
    throw new Error(`Configured module source not found: ${source.configuredPath}`);
  }

  if (fs.existsSync(path.join(source.dir, 'module.ts'))) {
    if (source.projectRoot) {
      assertModuleRootPath(source.projectRoot, source.dir, `Module root "${source.configuredPath}"`);
    }
    return [source.dir];
  }

  const roots = fs
    .readdirSync(source.dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(source.dir, entry.name))
    .filter((dir) => fs.existsSync(path.join(dir, 'module.ts')));
  if (source.projectRoot) {
    for (const root of roots) {
      assertModuleRootPath(source.projectRoot, root, `Module root "${portableProjectPath(source.projectRoot, root)}"`);
    }
  }
  return roots;
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
    assertModuleRootPath(projectRoot, resolved, `Module target "${targetPath}"`);
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
    projectRoot,
    path: portableProjectPath(projectRoot, resolved),
  };
  assertModuleSourcePath(projectRoot, resolved, `Module target "${targetPath}"`);
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
    assertModuleRootPath(projectRoot, resolved, `Module target "${target}"`);
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
    const matchedRoot = path.resolve(projectRoot, match.rootDir);
    assertModuleRootPath(projectRoot, matchedRoot, `Module target "${target}"`);
    return matchedRoot;
  }

  const configuredMatch = discoverConfiguredModuleRoots(projectRoot).find((root) => {
    const id = readModuleIdFromSource(root);
    return id === target || path.basename(root) === target || slash(path.resolve(root)) === targetAbsolute;
  });
  if (configuredMatch) {
    return configuredMatch;
  }

  throw new Error(`Module target not found: ${target}. Modules must live under modules/<id>.`);
}

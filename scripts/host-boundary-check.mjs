import fs from 'node:fs';
import path from 'node:path';
import { readModuleMapManifest, readModuleIdFromSource } from './lib/module-sources.mjs';

const PROJECT_ROOT = process.cwd();
const CODE_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
const HOST_DATA_EXTENSIONS = new Set(['.json']);
const HOST_TARGETS = [
  'apps/host-next/app',
  'apps/host-next/components',
  'apps/host-next/lib',
  'apps/host-next/locales',
  'src/lib/module-capabilities',
  'src/module-sdk',
  'src/lib/module-runtime',
  'src/lib/runtime-config',
  'scripts/host-accessibility-smoke.mjs',
  'scripts/host-browser-matrix.mjs',
  'scripts/host-dashboard-transition-smoke.mjs',
  'scripts/host-theme-matrix.mjs',
  'scripts/release-candidate-gate.ts',
];
const ROOT_SCRIPT_TARGET = 'scripts';
const PACKAGE_SCRIPT_TARGET = 'package.json#scripts';
const HOST_POLICY_FILES = [
  'package.json',
  'ploykit.config.json',
  'apps/host-next/app/globals.css',
  'apps/host-next/next.config.mjs',
  'apps/host-next/tsconfig.json',
  'tsconfig.json',
];
const GENERATED_MODULE_MAP_FILES = [
  'src/lib/module-map.ts',
  'src/lib/module-map.manifest.json',
];
const ALLOWED_FILES = new Set([
  normalizePath('src/lib/module-map.ts'),
  normalizePath('src/lib/module-map.manifest.json'),
]);
const ALLOWED_ROOT_SCRIPT_FILES = new Set([
  normalizePath('scripts/generate-module-map.mjs'),
  normalizePath('scripts/module-bundle.mjs'),
  normalizePath('scripts/module-catalog.mjs'),
  normalizePath('scripts/module-data-diff.mjs'),
  normalizePath('scripts/module-data.mjs'),
  normalizePath('scripts/module-evidence.mjs'),
  normalizePath('scripts/module-quality-manifest.mjs'),
  normalizePath('scripts/module-quality.mjs'),
  normalizePath('scripts/module-test.mjs'),
  normalizePath('scripts/ploykit-module.mjs'),
]);
const ROOT_SCRIPT_LITERAL_ALLOWLIST = [
  /^modules\/<id>(?:\/|$)/,
  /^modules\/<module-id>(?:\/|$)/,
  /^modules\/my-module(?:\/|$)/,
];

function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/');
}

function relativePath(filePath) {
  return normalizePath(path.relative(PROJECT_ROOT, filePath));
}

function readModuleRecords() {
  const manifest = readModuleMapManifest(PROJECT_ROOT);
  if (!manifest.error && manifest.modules.length > 0) {
    return manifest.modules
      .filter((moduleInfo) => typeof moduleInfo.id === 'string' && moduleInfo.id.length > 0)
      .map((moduleInfo) => ({
        id: moduleInfo.id,
        rootDir: typeof moduleInfo.rootDir === 'string' ? normalizePath(moduleInfo.rootDir) : '',
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  const modulesDir = path.join(PROJECT_ROOT, 'modules');
  if (!fs.existsSync(modulesDir)) {
    return [];
  }

  return fs
    .readdirSync(modulesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(modulesDir, entry.name))
    .filter((dir) => fs.existsSync(path.join(dir, 'module.ts')))
    .map((dir) => ({
      id: readModuleIdFromSource(dir),
      rootDir: relativePath(dir),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function collectFiles(target) {
  const absolute = path.resolve(PROJECT_ROOT, target);
  if (!fs.existsSync(absolute)) {
    return [];
  }

  const stat = fs.statSync(absolute);
  if (stat.isFile()) {
    return shouldScanFile(absolute) ? [absolute] : [];
  }

  const files = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') {
      continue;
    }
    const child = path.join(absolute, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(child));
    } else if (shouldScanFile(child)) {
      files.push(child);
    }
  }
  return files;
}

function shouldScanFile(filePath) {
  const relative = relativePath(filePath);
  const extension = path.extname(filePath);
  return (
    (CODE_EXTENSIONS.has(extension) || HOST_DATA_EXTENSIONS.has(extension)) &&
    !ALLOWED_FILES.has(relative)
  );
}

function shouldScanRootScriptFile(filePath) {
  const relative = relativePath(filePath);
  return (
    CODE_EXTENSIONS.has(path.extname(filePath)) && !ALLOWED_ROOT_SCRIPT_FILES.has(relative)
  );
}

function lineNumber(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function moduleImportViolation(specifier, modules) {
  const normalized = specifier.replace(/\\/g, '/');
  return modules.some((moduleInfo) => {
    if (moduleInfo.rootDir && new RegExp(`(^|/)${escapeRegex(moduleInfo.rootDir)}($|/)`).test(normalized)) {
      return true;
    }
    return new RegExp(`(^|/)modules/${escapeRegex(moduleInfo.id)}($|/)`).test(normalized);
  });
}

function moduleLiteralViolation(value, modules) {
  const normalized = value.replace(/\\/g, '/');
  return modules.find((moduleInfo) => {
    if (normalized === moduleInfo.id) {
      return moduleInfo.id;
    }
    const escaped = escapeRegex(moduleInfo.id);
    if (new RegExp(`(^|/)${escaped}($|[/?#])`).test(normalized)) {
      return moduleInfo.id;
    }
    if (
      moduleInfo.rootDir &&
      new RegExp(`(^|/)${escapeRegex(moduleInfo.rootDir)}($|[/?#])`).test(normalized)
    ) {
      return moduleInfo.id;
    }
    return undefined;
  });
}

function concreteModuleReference(value, modules) {
  const normalized = value.replace(/\\/g, '/');
  return modules.find((moduleInfo) => {
    const escaped = escapeRegex(moduleInfo.id);
    return (
      (moduleInfo.rootDir &&
        new RegExp(`(^|/)${escapeRegex(moduleInfo.rootDir)}($|[/?#])`).test(normalized)) ||
      new RegExp(`(^|/)modules/${escaped}($|[/?#])`).test(normalized) ||
      new RegExp(`(^|/)dashboard/${escaped}($|[/?#])`).test(normalized) ||
      new RegExp(`^module:${escaped}($|[-:])`).test(normalized)
    );
  })?.id;
}

function externalModuleSourceReference(value) {
  const normalized = value.replace(/\\/g, '/');
  if (!normalized.includes('../')) {
    return undefined;
  }
  return /(?:^|\/)(?:\.\.\/)+(?:[^/?#*]+\/)*modules\/[a-z][a-z0-9-]*(?:$|[/?#])/.test(normalized)
    ? normalized
    : undefined;
}

function allowedRootScriptLiteral(value) {
  const normalized = value.replace(/\\/g, '/');
  return ROOT_SCRIPT_LITERAL_ALLOWLIST.some((pattern) => pattern.test(normalized));
}

function collectStringLiterals(source) {
  const literals = [];
  const pattern = /(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  for (const match of source.matchAll(pattern)) {
    literals.push({
      value: match[2],
      index: match.index ?? 0,
    });
  }
  return literals;
}

function scanImports(source, file, modules) {
  const violations = [];
  const patterns = [
    /\bimport\s+(?:[^'"`]*?\s+from\s*)?["']([^"']+)["']/g,
    /\bexport\s+[^'"`]*?\s+from\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s*\(\s*`([^`]*modules\/[^`]*)`\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1] ?? '';
      if (moduleImportViolation(specifier, modules)) {
        violations.push({
          type: 'concrete-module-import',
          file,
          line: lineNumber(source, match.index ?? 0),
          detail: specifier,
        });
      }
    }
  }

  return violations;
}

function scanModuleLiterals(source, file, modules) {
  const violations = [];
  for (const literal of collectStringLiterals(source)) {
    const moduleId = moduleLiteralViolation(literal.value, modules);
    if (!moduleId) {
      continue;
    }
    violations.push({
      type: 'concrete-module-literal',
      file,
      line: lineNumber(source, literal.index),
      detail: moduleId,
    });
  }
  return violations;
}

function scanFile(filePath, modules) {
  const source = fs.readFileSync(filePath, 'utf8');
  const file = relativePath(filePath);
  return [...scanImports(source, file, modules), ...scanModuleLiterals(source, file, modules)];
}

function scanRootScriptFile(filePath, modules) {
  const source = fs.readFileSync(filePath, 'utf8');
  const file = relativePath(filePath);
  const violations = [];
  const basename = path.basename(file);
  const filenameModuleId = modules.find((moduleInfo) =>
    new RegExp(`(^|[-_.])${escapeRegex(moduleInfo.id)}($|[-_.])`).test(basename)
  )?.id;
  if (filenameModuleId) {
    violations.push({
      type: 'root-script-concrete-module-filename',
      file,
      line: 1,
      detail: filenameModuleId,
    });
  }

  for (const literal of collectStringLiterals(source)) {
    if (allowedRootScriptLiteral(literal.value)) {
      continue;
    }
    const moduleId = concreteModuleReference(literal.value, modules);
    if (!moduleId) {
      continue;
    }
    violations.push({
      type: 'root-script-concrete-module-literal',
      file,
      line: lineNumber(source, literal.index),
      detail: moduleId,
    });
  }

  return violations;
}

function scanHostPolicyFile(filePath, modules) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const source = fs.readFileSync(filePath, 'utf8');
  const file = relativePath(filePath);
  const violations = [];
  for (const literal of collectStringLiterals(source)) {
    const moduleId = concreteModuleReference(literal.value, modules);
    if (moduleId) {
      violations.push({
        type: 'host-policy-concrete-module-literal',
        file,
        line: lineNumber(source, literal.index),
        detail: moduleId,
      });
    }

    const externalModulePath = externalModuleSourceReference(literal.value);
    if (externalModulePath) {
      violations.push({
        type: 'host-policy-external-module-source-literal',
        file,
        line: lineNumber(source, literal.index),
        detail: externalModulePath,
      });
    }
  }
  return violations;
}

function scanPackageScripts(modules) {
  const packagePath = path.join(PROJECT_ROOT, 'package.json');
  if (!fs.existsSync(packagePath)) {
    return [];
  }
  const source = fs.readFileSync(packagePath, 'utf8');
  const file = 'package.json';
  const violations = [];
  let packageJson;
  try {
    packageJson = JSON.parse(source);
  } catch (error) {
    violations.push({
      type: 'package-json-parse-error',
      file,
      line: 1,
      detail: error instanceof Error ? error.message : String(error),
    });
    return violations;
  }

  const scripts = packageJson.scripts && typeof packageJson.scripts === 'object'
    ? packageJson.scripts
    : {};
  for (const [scriptName, command] of Object.entries(scripts)) {
    const scriptModuleId = concreteModuleReference(scriptName, modules);
    const commandModuleId =
      typeof command === 'string' ? concreteModuleReference(command, modules) : undefined;
    if (scriptModuleId || commandModuleId) {
      const needle = scriptModuleId ? `"${scriptName}"` : String(command);
      violations.push({
        type: 'package-script-concrete-module',
        file,
        line: source.split(/\r?\n/).findIndex((line) => line.includes(needle)) + 1 || 1,
        detail: scriptModuleId ?? commandModuleId,
      });
    }
  }
  return violations;
}

function generatedPathViolation(value) {
  const normalized = value.replace(/\\/g, '/');
  return (
    normalized.startsWith('../') ||
    normalized.includes('/../') ||
    path.isAbsolute(value) ||
    /^[a-zA-Z]:[\\/]/.test(value)
  );
}

function scanGeneratedModuleMapFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const source = fs.readFileSync(filePath, 'utf8');
  const file = relativePath(filePath);
  const violations = [];

  if (file.endsWith('.json')) {
    try {
      const manifest = JSON.parse(source);
      if ('trustedModuleRoots' in manifest) {
        violations.push({
          type: 'module-map-trusted-roots',
          file,
          line: 1,
          detail: 'trustedModuleRoots',
        });
      }
      const config = typeof manifest.config === 'string' ? manifest.config : '';
      if (/ploykit\.local\.config|\.runtime\/.*external|\.runtime\\.*external/i.test(config)) {
        violations.push({
          type: 'module-map-local-config',
          file,
          line: lineNumber(source, source.indexOf(config)),
          detail: config,
        });
      }
      for (const [index, moduleInfo] of (manifest.modules ?? []).entries()) {
        const rootDir = typeof moduleInfo.rootDir === 'string' ? moduleInfo.rootDir : '';
        if (rootDir && generatedPathViolation(rootDir)) {
          violations.push({
            type: 'module-map-external-root',
            file,
            line: lineNumber(source, source.indexOf(rootDir)),
            detail: `${moduleInfo.id ?? index}:${rootDir}`,
          });
        }
        if (moduleInfo.sourceKind === 'external') {
          violations.push({
            type: 'module-map-external-source-kind',
            file,
            line: lineNumber(source, source.indexOf('"sourceKind"')),
            detail: moduleInfo.id ?? index,
          });
        }
        const sourceDir = typeof moduleInfo.sourceDir === 'string' ? moduleInfo.sourceDir : '';
        if (sourceDir && generatedPathViolation(sourceDir)) {
          violations.push({
            type: 'module-map-external-source-dir',
            file,
            line: lineNumber(source, source.indexOf(sourceDir)),
            detail: `${moduleInfo.id ?? index}:${sourceDir}`,
          });
        }
      }
    } catch (error) {
      violations.push({
        type: 'module-map-json-parse-error',
        file,
        line: 1,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    return violations;
  }

  for (const match of source.matchAll(/\b(rootDir|sourceDir)\s*:\s*["'`]([^"'`]+)["'`]/g)) {
    const [, key, value] = match;
    if (generatedPathViolation(value)) {
      violations.push({
        type: key === 'rootDir' ? 'module-map-external-root' : 'module-map-external-source-dir',
        file,
        line: lineNumber(source, match.index ?? 0),
        detail: value,
      });
    }
  }
  for (const match of source.matchAll(/\bsourceKind\s*:\s*["'`]external["'`]/g)) {
    violations.push({
      type: 'module-map-external-source-kind',
      file,
      line: lineNumber(source, match.index ?? 0),
      detail: 'external',
    });
  }
  return violations;
}

const modules = readModuleRecords();
const hostFiles = [...new Set(HOST_TARGETS.flatMap(collectFiles))].sort();
const rootScriptFiles = collectFiles(ROOT_SCRIPT_TARGET).filter(shouldScanRootScriptFile).sort();
const hostPolicyFiles = HOST_POLICY_FILES.map((file) => path.join(PROJECT_ROOT, file));
const generatedModuleMapFiles = GENERATED_MODULE_MAP_FILES.map((file) => path.join(PROJECT_ROOT, file));
const violations = [
  ...hostFiles.flatMap((file) => scanFile(file, modules)),
  ...rootScriptFiles.flatMap((file) => scanRootScriptFile(file, modules)),
  ...hostPolicyFiles.flatMap((file) => scanHostPolicyFile(file, modules)),
  ...generatedModuleMapFiles.flatMap(scanGeneratedModuleMapFile),
  ...scanPackageScripts(modules),
];

if (violations.length > 0) {
  console.error('Host boundary check failed.');
  console.error('Host/shared code must not import concrete modules or hard-code module ids.');
  for (const violation of violations) {
    console.error(
      `${violation.file}:${violation.line} ${violation.type} ${JSON.stringify(violation.detail)}`
    );
  }
  process.exitCode = 1;
} else {
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        files: hostFiles.length + rootScriptFiles.length + hostPolicyFiles.length + generatedModuleMapFiles.length + 1,
        modules: modules.length,
        targets: [...HOST_TARGETS, ROOT_SCRIPT_TARGET, ...HOST_POLICY_FILES, ...GENERATED_MODULE_MAP_FILES, PACKAGE_SCRIPT_TARGET],
      },
      null,
      2
    )}\n`
  );
}

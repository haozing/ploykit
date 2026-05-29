import fs from 'node:fs';
import path from 'node:path';

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
  'scripts/host-theme-matrix.mjs',
  'scripts/release-candidate-gate.ts',
];
const ROOT_SCRIPT_TARGET = 'scripts';
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

function readModuleIds() {
  const modulesDir = path.join(PROJECT_ROOT, 'modules');
  if (!fs.existsSync(modulesDir)) {
    return [];
  }

  return fs
    .readdirSync(modulesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((moduleId) => fs.existsSync(path.join(modulesDir, moduleId, 'module.ts')))
    .sort();
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

function moduleImportViolation(specifier, moduleIds) {
  const normalized = specifier.replace(/\\/g, '/');
  return moduleIds.some((moduleId) =>
    new RegExp(`(^|/)modules/${escapeRegex(moduleId)}($|/)`).test(normalized)
  );
}

function moduleLiteralViolation(value, moduleIds) {
  const normalized = value.replace(/\\/g, '/');
  return moduleIds.find((moduleId) => {
    if (normalized === moduleId) {
      return true;
    }
    const escaped = escapeRegex(moduleId);
    return new RegExp(`(^|/)${escaped}($|[/?#])`).test(normalized);
  });
}

function concreteModuleReference(value, moduleIds) {
  const normalized = value.replace(/\\/g, '/');
  return moduleIds.find((moduleId) => {
    const escaped = escapeRegex(moduleId);
    return (
      new RegExp(`(^|/)modules/${escaped}($|[/?#])`).test(normalized) ||
      new RegExp(`(^|/)dashboard/${escaped}($|[/?#])`).test(normalized) ||
      new RegExp(`^module:${escaped}($|[-:])`).test(normalized)
    );
  });
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

function scanImports(source, file, moduleIds) {
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
      if (moduleImportViolation(specifier, moduleIds)) {
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

function scanModuleLiterals(source, file, moduleIds) {
  const violations = [];
  for (const literal of collectStringLiterals(source)) {
    const moduleId = moduleLiteralViolation(literal.value, moduleIds);
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

function scanFile(filePath, moduleIds) {
  const source = fs.readFileSync(filePath, 'utf8');
  const file = relativePath(filePath);
  return [...scanImports(source, file, moduleIds), ...scanModuleLiterals(source, file, moduleIds)];
}

function scanRootScriptFile(filePath, moduleIds) {
  const source = fs.readFileSync(filePath, 'utf8');
  const file = relativePath(filePath);
  const violations = [];
  const basename = path.basename(file);
  const filenameModuleId = moduleIds.find((moduleId) =>
    new RegExp(`(^|[-_.])${escapeRegex(moduleId)}($|[-_.])`).test(basename)
  );
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
    const moduleId = concreteModuleReference(literal.value, moduleIds);
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

function scanPackageScripts(moduleIds) {
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
    const scriptModuleId = concreteModuleReference(scriptName, moduleIds);
    const commandModuleId =
      typeof command === 'string' ? concreteModuleReference(command, moduleIds) : undefined;
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

const moduleIds = readModuleIds();
const hostFiles = [...new Set(HOST_TARGETS.flatMap(collectFiles))].sort();
const rootScriptFiles = collectFiles(ROOT_SCRIPT_TARGET).filter(shouldScanRootScriptFile).sort();
const violations = [
  ...hostFiles.flatMap((file) => scanFile(file, moduleIds)),
  ...rootScriptFiles.flatMap((file) => scanRootScriptFile(file, moduleIds)),
  ...scanPackageScripts(moduleIds),
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
        files: hostFiles.length + rootScriptFiles.length + 1,
        modules: moduleIds.length,
        targets: [...HOST_TARGETS, ROOT_SCRIPT_TARGET, 'package.json'],
      },
      null,
      2
    )}\n`
  );
}

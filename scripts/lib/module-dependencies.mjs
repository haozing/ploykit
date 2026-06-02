import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { register } from 'tsx/esm/api';
import {
  discoverConfiguredModuleRoots,
  portableProjectPath,
  slash,
} from './module-sources.mjs';

const PACKAGE_FILE = 'package.json';
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const TSX_TSCONFIG = path.join(DEFAULT_PROJECT_ROOT, 'tsconfig.json');
const MODULE_DEPENDENCY_POLICY = Object.freeze({
  source: 'npm-registry-semver-only',
  localSources: 'forbidden',
  remoteSources: 'forbidden',
  aliases: 'forbidden',
  lifecycleScripts: 'ignored-on-install',
  nativePackages: 'unsupported-when-install-scripts-are-required',
});

register({ namespace: 'ploykit-module-dependencies', tsconfig: TSX_TSCONFIG });

const {
  normalizeModuleNpmDependencyInputs,
  normalizeModuleNpmDependencies,
} = await import(pathToFileURL(path.join(DEFAULT_PROJECT_ROOT, 'src', 'module-sdk', 'dependencies.ts')).href);

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function diagnostic(code, message, pathValue, fix, location = {}) {
  return {
    severity: 'error',
    code,
    message,
    path: pathValue,
    ...(fix ? { fix } : {}),
    ...(location.line ? { line: location.line } : {}),
    ...(location.column ? { column: location.column } : {}),
  };
}

function sourceLocation(sourceFile, node) {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { line: position.line + 1, column: position.character + 1 };
}

function propertyNameText(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function findProperty(objectLiteral, key) {
  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property)) {
      continue;
    }
    const propertyName = propertyNameText(property.name);
    if (propertyName === key) {
      return property;
    }
  }
  return undefined;
}

function findObjectMember(objectLiteral, key) {
  for (const property of objectLiteral.properties) {
    if (ts.isPropertyAssignment(property)) {
      const propertyName = propertyNameText(property.name);
      if (propertyName === key) {
        return property;
      }
      continue;
    }
    if (ts.isShorthandPropertyAssignment(property) && property.name.text === key) {
      return property;
    }
  }
  return undefined;
}

function findDefineModuleObject(sourceFile) {
  let result;
  function visit(node) {
    if (result) {
      return;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'defineModule' &&
      node.arguments.length > 0 &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      result = node.arguments[0];
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return result;
}

function stringLiteralValue(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return undefined;
}

function unsupportedDiagnostic(sourceFile, node, pathValue, label) {
  return diagnostic(
    'MODULE_DEPENDENCY_STATIC_DECLARATION_REQUIRED',
    `${label} must be a static string literal in module.ts.`,
    pathValue,
    'Declare dependencies.npm with a static array of package names or an object of package ranges.',
    sourceLocation(sourceFile, node)
  );
}

function extractNpmDependencyInputsFromObject(sourceFile, objectLiteral) {
  const inputs = [];
  const diagnostics = [];

  for (const property of objectLiteral.properties) {
    if (ts.isSpreadAssignment(property)) {
      diagnostics.push(
        diagnostic(
          'MODULE_DEPENDENCY_STATIC_DECLARATION_REQUIRED',
          'dependencies.npm must not use object spread.',
          'dependencies.npm',
          'Declare each npm dependency directly so host tooling can validate it without evaluating module code.',
          sourceLocation(sourceFile, property)
        )
      );
      continue;
    }

    if (!ts.isPropertyAssignment(property)) {
      diagnostics.push(
        diagnostic(
          'MODULE_DEPENDENCY_STATIC_DECLARATION_REQUIRED',
          'dependencies.npm entries must be property assignments.',
          'dependencies.npm',
          'Declare each npm dependency as "package": "range".',
          sourceLocation(sourceFile, property)
        )
      );
      continue;
    }

    const name = propertyNameText(property.name);
    const pathValue = `dependencies.npm.${name ?? '<computed>'}`;
    if (name === undefined) {
      diagnostics.push(
        diagnostic(
          'MODULE_DEPENDENCY_STATIC_DECLARATION_REQUIRED',
          'dependencies.npm package names must be static property names.',
          pathValue,
          'Use a quoted npm package name such as "@scope/package".',
          sourceLocation(sourceFile, property.name)
        )
      );
      continue;
    }

    const range = stringLiteralValue(property.initializer);
    if (range === undefined) {
      diagnostics.push(unsupportedDiagnostic(sourceFile, property.initializer, pathValue, `Dependency "${name}" range`));
      continue;
    }

    inputs.push({
      name,
      range,
      path: pathValue,
      rangePath: pathValue,
    });
  }

  return { inputs, diagnostics };
}

function extractNpmDependencyInputsFromArray(sourceFile, arrayLiteral) {
  const inputs = [];
  const diagnostics = [];

  arrayLiteral.elements.forEach((element, index) => {
    const pathValue = `dependencies.npm.${index}`;
    const name = stringLiteralValue(element);
    if (name === undefined) {
      diagnostics.push(unsupportedDiagnostic(sourceFile, element, pathValue, 'Dependency package name'));
      return;
    }
    inputs.push({ name, path: pathValue, range: '*' });
  });

  return { inputs, diagnostics };
}

function extractNpmDependencyInputs(sourceFile) {
  const moduleObject = findDefineModuleObject(sourceFile);
  if (!moduleObject) {
    return { inputs: [], diagnostics: [] };
  }

  const dependenciesProperty = findProperty(moduleObject, 'dependencies');
  if (!dependenciesProperty) {
    return { inputs: [], diagnostics: [] };
  }

  if (!ts.isObjectLiteralExpression(dependenciesProperty.initializer)) {
    return {
      inputs: [],
      diagnostics: [
        diagnostic(
          'MODULE_DEPENDENCY_STATIC_DECLARATION_REQUIRED',
          'dependencies must be a static object literal in module.ts.',
          'dependencies',
          'Declare dependencies: { npm: { package: "range" } } directly in defineModule(...).',
          sourceLocation(sourceFile, dependenciesProperty.initializer)
        ),
      ],
    };
  }

  const dependencyObjectDiagnostics = [];
  for (const property of dependenciesProperty.initializer.properties) {
    if (ts.isSpreadAssignment(property)) {
      dependencyObjectDiagnostics.push(
        diagnostic(
          'MODULE_DEPENDENCY_STATIC_DECLARATION_REQUIRED',
          'dependencies must not use object spread.',
          'dependencies',
          'Declare dependencies.npm directly so host tooling can validate it without evaluating module code.',
          sourceLocation(sourceFile, property)
        )
      );
    }
  }

  const npmProperty = findObjectMember(dependenciesProperty.initializer, 'npm');
  if (!npmProperty) {
    if (dependencyObjectDiagnostics.length > 0) {
      return { inputs: [], diagnostics: dependencyObjectDiagnostics };
    }
    return { inputs: [], diagnostics: [] };
  }

  if (!ts.isPropertyAssignment(npmProperty)) {
    return {
      inputs: [],
      diagnostics: [
        ...dependencyObjectDiagnostics,
        diagnostic(
          'MODULE_DEPENDENCY_STATIC_DECLARATION_REQUIRED',
          'dependencies.npm must be declared as a direct property assignment.',
          'dependencies.npm',
          'Use dependencies: { npm: { zod: "^3.0.0" } } instead of shorthand or dynamic values.',
          sourceLocation(sourceFile, npmProperty)
        ),
      ],
    };
  }

  const npmValue = npmProperty.initializer;
  if (ts.isObjectLiteralExpression(npmValue)) {
    const extracted = extractNpmDependencyInputsFromObject(sourceFile, npmValue);
    return { inputs: extracted.inputs, diagnostics: [...dependencyObjectDiagnostics, ...extracted.diagnostics] };
  }
  if (ts.isArrayLiteralExpression(npmValue)) {
    const extracted = extractNpmDependencyInputsFromArray(sourceFile, npmValue);
    return { inputs: extracted.inputs, diagnostics: [...dependencyObjectDiagnostics, ...extracted.diagnostics] };
  }

  return {
    inputs: [],
    diagnostics: [
      ...dependencyObjectDiagnostics,
      diagnostic(
        'MODULE_DEPENDENCY_NPM_INVALID',
        'dependencies.npm must be a static object or array literal in module.ts.',
        'dependencies.npm',
        'Use dependencies: { npm: { zod: "^3.0.0" } } or dependencies: { npm: ["zod"] }.',
        sourceLocation(sourceFile, npmValue)
      ),
    ],
  };
}

function addDependency(dependencies, dependency, moduleRoot) {
  const existing = dependencies.get(dependency.name);
  if (!existing) {
    dependencies.set(dependency.name, {
      name: dependency.name,
      range: dependency.range,
      modules: [moduleRoot],
    });
    return undefined;
  }

  if (!existing.modules.includes(moduleRoot)) {
    existing.modules.push(moduleRoot);
  }
  if (existing.range === dependency.range) {
    return undefined;
  }
  if (existing.range === '*') {
    existing.range = dependency.range;
    return undefined;
  }
  if (dependency.range === '*') {
    return undefined;
  }

  return diagnostic(
    'MODULE_DEPENDENCY_VERSION_CONFLICT',
    `Dependency "${dependency.name}" is declared with conflicting ranges "${existing.range}" and "${dependency.range}".`,
    `dependencies.npm.${dependency.name}`,
    'Align module dependency ranges before installing host npm dependencies.'
  );
}

function throwDependencyDiagnostics(diagnostics) {
  const errors = diagnostics.filter((item) => item.severity === 'error');
  if (errors.length === 0) {
    return;
  }
  const details = errors
    .map((item) => `${item.code} at ${item.path}: ${item.message}`)
    .join('; ');
  throw new Error(`Module npm dependency validation failed: ${details}`);
}

export function moduleDependencyPolicy() {
  return MODULE_DEPENDENCY_POLICY;
}

export function extractDeclaredNpmDependencyReport(source, options = {}) {
  const sourceFile = ts.createSourceFile(
    options.fileName ?? 'module.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const extracted = extractNpmDependencyInputs(sourceFile);
  const normalized = normalizeModuleNpmDependencyInputs(extracted.inputs);

  return {
    dependencies: normalized.dependencies,
    diagnostics: [...extracted.diagnostics, ...normalized.diagnostics],
    policy: MODULE_DEPENDENCY_POLICY,
  };
}

export function extractDeclaredNpmDependencyMap(source, options = {}) {
  const report = extractDeclaredNpmDependencyReport(source, options);
  return new Map(report.dependencies.map((dependency) => [dependency.name, dependency]));
}

export function readHostPackageManifest(projectRoot = process.cwd()) {
  return readJson(path.join(projectRoot, PACKAGE_FILE), {
    dependencies: {},
    devDependencies: {},
  });
}

export function collectModuleNpmDependencyReport(projectRoot = process.cwd()) {
  const dependencies = new Map();
  const diagnostics = [];
  const moduleRoots = discoverConfiguredModuleRoots(projectRoot);

  for (const moduleRoot of moduleRoots) {
    const moduleFile = path.join(moduleRoot, 'module.ts');
    if (!fs.existsSync(moduleFile)) {
      continue;
    }

    const modulePath = portableProjectPath(projectRoot, moduleRoot);
    const report = extractDeclaredNpmDependencyReport(fs.readFileSync(moduleFile, 'utf8'), {
      fileName: moduleFile,
    });
    for (const item of report.diagnostics) {
      diagnostics.push({
        ...item,
        moduleRoot: modulePath,
        path: `${modulePath}:${item.path}`,
      });
    }
    for (const dependency of report.dependencies) {
      const conflict = addDependency(dependencies, dependency, modulePath);
      if (conflict) {
        diagnostics.push({ ...conflict, moduleRoot: modulePath, path: `${modulePath}:${conflict.path}` });
      }
    }
  }

  return {
    dependencies: [...dependencies.values()].sort((left, right) => left.name.localeCompare(right.name)),
    diagnostics,
    policy: MODULE_DEPENDENCY_POLICY,
  };
}

export function collectModuleNpmDependencies(projectRoot = process.cwd()) {
  const report = collectModuleNpmDependencyReport(projectRoot);
  throwDependencyDiagnostics(report.diagnostics);
  return report.dependencies;
}

export function findMissingModuleNpmDependencyReport(projectRoot = process.cwd()) {
  const dependencyReport = collectModuleNpmDependencyReport(projectRoot);
  const packageManifest = readHostPackageManifest(projectRoot);
  const hostDependencies = {
    ...(packageManifest.dependencies ?? {}),
    ...(packageManifest.devDependencies ?? {}),
  };
  const missing = dependencyReport.dependencies.filter((dependency) => !hostDependencies[dependency.name]);

  return {
    ...dependencyReport,
    missing,
    success:
      missing.length === 0 &&
      dependencyReport.diagnostics.every((diagnosticItem) => diagnosticItem.severity !== 'error'),
  };
}

export function findMissingModuleNpmDependencies(projectRoot = process.cwd()) {
  const report = findMissingModuleNpmDependencyReport(projectRoot);
  throwDependencyDiagnostics(report.diagnostics);
  return report.missing;
}

function installSpec(dependency) {
  return dependency.range === '*' ? dependency.name : `${dependency.name}@${dependency.range}`;
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

export function installMissingModuleNpmDependencies(projectRoot = process.cwd(), options = {}) {
  const report = findMissingModuleNpmDependencyReport(projectRoot);
  throwDependencyDiagnostics(report.diagnostics);
  if (report.missing.length === 0) {
    return { installed: [], missing: report.missing, diagnostics: report.diagnostics, policy: report.policy };
  }

  const specs = report.missing.map(installSpec);
  if (options.dryRun) {
    return { installed: [], missing: report.missing, diagnostics: report.diagnostics, policy: report.policy };
  }

  const command = npmCommand();
  const result = childProcess.spawnSync(command, ['install', '--ignore-scripts', ...specs], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: options.stdio ?? 'inherit',
  });

  if (result.status !== 0) {
    throw new Error(`Failed to install module npm dependencies: ${specs.map(slash).join(', ')}`);
  }

  return { installed: specs, missing: report.missing, diagnostics: report.diagnostics, policy: report.policy };
}

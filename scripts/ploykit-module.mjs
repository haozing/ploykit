import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'tsx/esm/api';
import {
  discoverModuleRoots as discoverConfiguredModuleRoots,
  getModuleSources,
  resolveModuleRoot as resolveConfiguredModuleRoot,
} from './lib/module-sources.mjs';
import { createModuleFromTemplate } from './lib/module-create-command.mjs';
import { runLocalScript, runSdkContractValidation } from './lib/module-command-execution.mjs';
import { contractSourceDigest } from './lib/module-digests.mjs';
import {
  extractAllContractLocalPaths,
  extractContractParts,
  extractString,
} from './lib/module-contract-source.mjs';
import {
  dedupeDiagnostics,
  diagnostic,
  locateInSource,
  normalizeDiagnostic,
} from './lib/module-doctor-diagnostics.mjs';
import {
  MODULE_ID_PATTERN,
  SEMVER_PATTERN,
  createModuleDoctorContractRules,
} from './lib/module-doctor-contract-rules.mjs';
import { createModuleDoctorCapabilityRules } from './lib/module-doctor-capability-rules.mjs';
import { createModuleDoctorDependencyRules } from './lib/module-doctor-dependency-rules.mjs';
import { createModuleDoctorMapRules } from './lib/module-doctor-map-rules.mjs';
import { createModuleDoctorSourceBoundaryRules } from './lib/module-doctor-source-boundary-rules.mjs';
import { createRootHelp, printJson, runModuleCliCommand } from './lib/module-cli-runner.mjs';
import { createUsage, listModuleTemplateCatalog } from './lib/module-template-catalog.mjs';
import './lib/module-sdk-alias.cjs';

const PROJECT_ROOT = process.cwd();
const CLI_FILE = fileURLToPath(import.meta.url);
const TSX_TSCONFIG = path.join(PROJECT_ROOT, 'tsconfig.json');
const tsx = register({ namespace: 'ploykit-module-doctor', tsconfig: TSX_TSCONFIG });
const CONTRACT_VALIDATION_TIMEOUT_MS = 10_000;
function slash(value) {
  return value.replace(/\\/g, '/');
}

function toProjectPath(file) {
  return slash(path.relative(PROJECT_ROOT, file));
}

const contractRules = createModuleDoctorContractRules({ diagnostic, toProjectPath });
const capabilityRules = createModuleDoctorCapabilityRules({ diagnostic });
const dependencyRules = createModuleDoctorDependencyRules({
  projectRoot: PROJECT_ROOT,
  diagnostic,
  normalizeDiagnostic,
});
const mapRules = createModuleDoctorMapRules({
  projectRoot: PROJECT_ROOT,
  diagnostic,
  slash,
  toProjectPath,
});
const sourceBoundaryRules = createModuleDoctorSourceBoundaryRules({
  projectRoot: PROJECT_ROOT,
  diagnostic,
  locateInSource,
  toProjectPath,
});

function printHelp() {
  process.stdout.write(createRootHelp(createUsage));
}

function resolveModuleRoot(inputPath) {
  return resolveConfiguredModuleRoot(PROJECT_ROOT, inputPath ?? '.');
}

function discoverModuleRoots(inputPath) {
  return discoverConfiguredModuleRoots(PROJECT_ROOT, inputPath);
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

async function loadSdkValidator() {
  const sdk = await tsx.import(
    pathToFileURL(path.join(PROJECT_ROOT, 'src', 'module-sdk', 'index.ts')).href,
    import.meta.url
  );
  return sdk.validateModuleDefinition;
}

async function evaluateSdkContractValidation(moduleRoot) {
  const diagnostics = [];
  try {
    const [loaded, validateModuleDefinition] = await Promise.all([
      tsx.import(pathToFileURL(path.join(moduleRoot, 'module.ts')).href, import.meta.url),
      loadSdkValidator(),
    ]);
    const definition = readDefaultExport(loaded);
    if (!definition || typeof definition !== 'object') {
      return [
        diagnostic(
          'error',
          'MODULE_CONTRACT_INVALID_EXPORT',
          'module.ts must export a module definition object.',
          'module.ts',
          'Export default defineModule(...).'
        ),
      ];
    }

    for (const sdkDiagnostic of validateModuleDefinition(definition)) {
      diagnostics.push(normalizeDiagnostic(sdkDiagnostic));
    }
  } catch (error) {
    diagnostics.push(
      diagnostic(
        'error',
        'MODULE_CONTRACT_EVALUATION_FAILED',
        error instanceof Error ? error.message : String(error),
        'module.ts',
        'Ensure module.ts exports defineModule(...) and compiles.'
      )
    );
  }
  return diagnostics;
}

function hasSourceBoundaryErrors(diagnostics) {
  return diagnostics.some(
    (item) =>
      item.severity === 'error' &&
      (item.category === 'source' ||
        item.code === 'MODULE_LOCAL_PATH_ESCAPES_ROOT' ||
        item.code === 'MODULE_SOURCE_IMPORT_ESCAPES_ROOT')
  );
}

function checkSdkContractValidation(moduleRoot, diagnostics) {
  if (hasSourceBoundaryErrors(diagnostics)) {
    diagnostics.push(
      diagnostic(
        'info',
        'MODULE_CONTRACT_EVALUATION_SKIPPED',
        'Skipped SDK contract evaluation because source boundary errors must be fixed first.',
        'module.ts',
        'Fix source safety diagnostics, then rerun module doctor.'
      )
    );
    return;
  }

  diagnostics.push(
    ...runSdkContractValidation({
      projectRoot: PROJECT_ROOT,
      cliFile: CLI_FILE,
      moduleRoot,
      timeoutMs: CONTRACT_VALIDATION_TIMEOUT_MS,
      diagnostic,
      normalizeDiagnostic,
    })
  );
}

async function doctorModule(moduleRoot) {
  const diagnostics = [];
  const moduleFile = path.join(moduleRoot, 'module.ts');

  if (!fs.existsSync(moduleFile)) {
    diagnostics.push(
      diagnostic(
        'error',
        'MODULE_FILE_MISSING',
        `Module root "${toProjectPath(moduleRoot)}" does not contain module.ts.`,
        'module.ts',
        'Create module.ts with defineModule(...).'
      )
    );
    return {
      moduleRoot: toProjectPath(moduleRoot),
      moduleId: path.basename(moduleRoot),
      success: false,
      diagnostics,
    };
  }

  const source = fs.readFileSync(moduleFile, 'utf8');
  const moduleId = extractString(source, 'id');
  const name = extractString(source, 'name');
  const version = extractString(source, 'version');

  if (!source.includes('defineModule')) {
    diagnostics.push(
      diagnostic(
        'error',
        'MODULE_DEFINE_MODULE_MISSING',
        'module.ts must call defineModule(...).',
        'module.ts',
        'Import and use defineModule from @ploykit/module-sdk.'
      )
    );
  }

  if (!moduleId) {
    diagnostics.push(
      diagnostic(
        'error',
        'MODULE_ID_REQUIRED',
        'Module id is required.',
        'id',
        'Add id: "my-module".'
      )
    );
  } else if (!MODULE_ID_PATTERN.test(moduleId)) {
    diagnostics.push(
      diagnostic(
        'error',
        'MODULE_ID_INVALID',
        `Module id "${moduleId}" must contain only lowercase letters, numbers, and hyphens.`,
        'id',
        'Use an id like "cms", "shop", or "workflow".'
      )
    );
  }

  if (!name) {
    diagnostics.push(
      diagnostic(
        'error',
        'MODULE_NAME_REQUIRED',
        'Module name is required.',
        'name',
        'Add a readable module name.'
      )
    );
  }

  if (!version) {
    diagnostics.push(
      diagnostic(
        'error',
        'MODULE_VERSION_REQUIRED',
        'Module version is required.',
        'version',
        'Add version: "0.1.0".'
      )
    );
  } else if (!SEMVER_PATTERN.test(version)) {
    diagnostics.push(
      diagnostic(
        'error',
        'MODULE_VERSION_INVALID',
        `Module version "${version}" must follow semantic versioning.`,
        'version',
        'Use a version like "0.1.0".'
      )
    );
  }

  sourceBoundaryRules.checkSourceBoundaries(moduleRoot, source, diagnostics);
  contractRules.checkDataArtifacts(moduleRoot, source, diagnostics);
  contractRules.checkPublicAliases(source, diagnostics);
  contractRules.checkResourceKinds(source, diagnostics);
  contractRules.checkEventNames(source, diagnostics);
  contractRules.checkWebhookSignatures(source, diagnostics);
  capabilityRules.checkCapabilityPermissions(moduleRoot, source, diagnostics);
  capabilityRules.checkCapabilityDeclarations(moduleRoot, source, diagnostics);
  capabilityRules.checkPrivilegedServiceSourceUsage(moduleRoot, source, diagnostics);
  contractRules.checkHttpEgress(moduleRoot, source, diagnostics);
  contractRules.checkPublicRouteContracts(source, diagnostics);
  contractRules.checkDashboardRoutePerformanceShape(source, diagnostics);
  contractRules.checkLifecycleContracts(moduleRoot, source, diagnostics);
  dependencyRules.checkModuleDependencies(source, diagnostics);
  await checkSdkContractValidation(moduleRoot, diagnostics);
  mapRules.checkModuleMapManifest(moduleRoot, moduleId || path.basename(moduleRoot), diagnostics);
  const finalDiagnostics = dedupeDiagnostics(diagnostics);

  return {
    moduleRoot: toProjectPath(moduleRoot),
    moduleId: moduleId || path.basename(moduleRoot),
    success: !finalDiagnostics.some((item) => item.severity === 'error'),
    summary: {
      parts: extractContractParts(source).map((part) => part.part),
      sourceHash: mapRules.sourceHash(moduleRoot),
      contractDigest: contractSourceDigest(moduleRoot),
      diagnostics: {
        errors: finalDiagnostics.filter((item) => item.severity === 'error').length,
        warnings: finalDiagnostics.filter((item) => item.severity === 'warning').length,
        infos: finalDiagnostics.filter((item) => item.severity === 'info').length,
      },
      categories: [
        ...new Set(finalDiagnostics.map((item) => item.category).filter(Boolean)),
      ].sort(),
      subsystems: [
        ...new Set(finalDiagnostics.map((item) => item.subsystem).filter(Boolean)),
      ].sort(),
    },
    diagnostics: finalDiagnostics,
  };
}

async function commandDoctor(args) {
  const target = args[0];
  const roots = discoverModuleRoots(target);
  const results = await Promise.all(roots.map(doctorModule));
  const result =
    roots.length === 1 && target !== 'all'
      ? results[0]
      : {
          success: results.every((item) => item.success),
          count: results.length,
          results,
        };
  printJson(result);
  if (!result.success) {
    process.exitCode = 1;
  }
}

async function commandCheck(args) {
  const target = args[0];
  const roots = discoverModuleRoots(target);
  const results = await Promise.all(roots.map(doctorModule));
  const success = results.every((result) => result.success);
  printJson({ success, count: results.length, results });
  if (!success) {
    process.exitCode = 1;
  }
}

async function commandValidateContractInternal(args) {
  const moduleRoot = resolveConfiguredModuleRoot(PROJECT_ROOT, args[0] ?? '.');
  const diagnostics = await evaluateSdkContractValidation(moduleRoot);
  printJson({
    success: !diagnostics.some((item) => item.severity === 'error'),
    diagnostics,
  });
}

function commandInspect(args) {
  const target = args[0];
  const roots = discoverModuleRoots(target);
  const results = roots.map((root) => {
    const source = fs.readFileSync(path.join(root, 'module.ts'), 'utf8');
    return {
      moduleRoot: toProjectPath(root),
      id: extractString(source, 'id') || path.basename(root),
      name: extractString(source, 'name') || null,
      version: extractString(source, 'version') || null,
      localPaths: extractAllContractLocalPaths(source),
      parts: extractContractParts(source),
      sourceHash: mapRules.sourceHash(root),
      contractDigest: contractSourceDigest(root),
    };
  });
  printJson({ count: results.length, modules: results });
}

function commandCreate(args) {
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }
  const result = createModuleFromTemplate({
    args,
    projectRoot: PROJECT_ROOT,
    getModuleSources,
    moduleIdPattern: MODULE_ID_PATTERN,
    toProjectPath,
  });
  printJson(result);
}

function commandTemplates() {
  const { templates, extensions } = listModuleTemplateCatalog(PROJECT_ROOT, {
    slash,
    toProjectPath,
  });
  printJson({ success: true, templates, extensions });
}

function commandDev(args) {
  const target = args[0] ?? 'all';
  runLocalScript(PROJECT_ROOT, path.join('scripts', 'module-deps.mjs'), ['--install']);
  runLocalScript(PROJECT_ROOT, path.join('scripts', 'generate-module-map.mjs'), ['--check']);
  runLocalScript(PROJECT_ROOT, path.join('scripts', 'ploykit-module.mjs'), ['check', target]);
  printJson({
    success: true,
    target,
    checks: ['modules:deps --install', 'modules:scan --check', 'modules:check'],
    next: [
      `npm run module:doctor -- ${target}`,
      `npm run module:test -- ${target}`,
      'npm run module:build',
    ],
  });
}

await runModuleCliCommand({
  argv: process.argv,
  printHelp,
  commands: {
    doctor: commandDoctor,
    check: commandCheck,
    'validate-contract-internal': commandValidateContractInternal,
    inspect: commandInspect,
    create: commandCreate,
    templates: commandTemplates,
    dev: commandDev,
  },
  createErrorDiagnostic(error) {
    return diagnostic(
      'error',
      'MODULE_CLI_ERROR',
      error instanceof Error ? error.message : String(error)
    );
  },
  onFinally: () => tsx.unregister(),
});

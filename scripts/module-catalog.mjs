import fs from 'node:fs';
import path from 'node:path';

const PROJECT_ROOT = process.cwd();
const MANIFEST_FILE = path.join(PROJECT_ROOT, 'src', 'lib', 'module-map.manifest.json');
const DEFAULT_CATALOG_FILE = path.join(PROJECT_ROOT, 'catalog', 'default.catalog.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function diagnostic(severity, code, message, pathValue, fix) {
  return {
    severity,
    code,
    message,
    ...(pathValue ? { path: pathValue } : {}),
    ...(fix ? { fix } : {}),
  };
}

function moduleIdsFromManifest(manifest) {
  return new Set((manifest.modules ?? []).map((moduleInfo) => moduleInfo.id));
}

function diagnose(manifest, catalog) {
  const diagnostics = [];
  const moduleIds = moduleIdsFromManifest(manifest);
  const stateByModule = new Map(
    (catalog.moduleStates ?? []).map((state) => [state.moduleId, state])
  );

  for (const [bundleIndex, bundle] of (catalog.bundles ?? []).entries()) {
    for (const [moduleIndex, moduleInfo] of (bundle.modules ?? []).entries()) {
      if (!moduleIds.has(moduleInfo.moduleId)) {
        diagnostics.push(
          diagnostic(
            'error',
            'MODULE_CATALOG_BUNDLE_MODULE_MISSING',
            `Bundle "${bundle.id}" references missing module "${moduleInfo.moduleId}".`,
            `bundles.${bundleIndex}.modules.${moduleIndex}.moduleId`,
            'Add the module to modules/ or remove it from the bundle.'
          )
        );
      }
    }

    for (const requiredModuleId of bundle.requiredModuleIds ?? []) {
      const state = stateByModule.get(requiredModuleId);
      if (!state || state.status !== 'enabled') {
        diagnostics.push(
          diagnostic(
            'error',
            'MODULE_CATALOG_REQUIRED_MODULE_NOT_ENABLED',
            `Required module "${requiredModuleId}" is not enabled.`,
            `bundles.${bundleIndex}.requiredModuleIds`,
            'Add an enabled module state for the required module.'
          )
        );
      }
    }
  }

  for (const [index, state] of (catalog.moduleStates ?? []).entries()) {
    if (!moduleIds.has(state.moduleId)) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_CATALOG_STATE_MODULE_MISSING',
          `Catalog state references missing module "${state.moduleId}".`,
          `moduleStates.${index}.moduleId`,
          'Remove the state entry or add the module to modules/.'
        )
      );
    }
  }

  return diagnostics;
}

function createPlan(catalog) {
  const product = catalog.products?.[0];
  if (!product) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          'error',
          'MODULE_CATALOG_PRODUCT_MISSING',
          'Catalog has no products.',
          'products',
          'Add at least one product.'
        ),
      ],
    };
  }

  const bundle =
    (catalog.bundles ?? []).find((candidate) => candidate.id === product.defaultBundleId) ??
    catalog.bundles?.[0];
  if (!bundle) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          'error',
          'MODULE_CATALOG_BUNDLE_MISSING',
          'Catalog has no bundles.',
          'bundles',
          'Add at least one bundle.'
        ),
      ],
    };
  }

  const existing = new Map((catalog.moduleStates ?? []).map((state) => [state.moduleId, state]));
  const operations = (bundle.modules ?? []).map((moduleInfo) => {
    const previous = existing.get(moduleInfo.moduleId);
    const nextStatus = moduleInfo.status ?? 'enabled';
    return {
      type: previous ? (previous.status === nextStatus ? 'noop' : 'update') : 'enable',
      productId: product.id,
      moduleId: moduleInfo.moduleId,
      previousStatus: previous?.status,
      nextStatus,
      required:
        moduleInfo.required ?? (bundle.requiredModuleIds ?? []).includes(moduleInfo.moduleId),
      bundleId: bundle.id,
    };
  });

  return {
    ok: true,
    productId: product.id,
    bundleId: bundle.id,
    operations,
  };
}

function main() {
  const command = process.argv[2] ?? 'doctor';
  const catalogFile = process.argv.includes('--catalog')
    ? path.resolve(PROJECT_ROOT, process.argv[process.argv.indexOf('--catalog') + 1])
    : DEFAULT_CATALOG_FILE;
  const manifest = readJson(MANIFEST_FILE);
  const catalog = readJson(catalogFile);

  if (command === 'doctor') {
    const diagnostics = diagnose(manifest, catalog);
    process.stdout.write(
      `${JSON.stringify({ success: diagnostics.every((item) => item.severity !== 'error'), diagnostics }, null, 2)}\n`
    );
    process.exitCode = diagnostics.some((item) => item.severity === 'error') ? 1 : 0;
    return;
  }

  if (command === 'plan') {
    process.stdout.write(`${JSON.stringify(createPlan(catalog), null, 2)}\n`);
    return;
  }

  if (command === 'inspect') {
    process.stdout.write(`${JSON.stringify(catalog, null, 2)}\n`);
    return;
  }

  process.stderr.write(`Unknown catalog command: ${command}\n`);
  process.exitCode = 1;
}

main();

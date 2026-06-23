import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_VIEWPORTS = ['desktop', 'mobile'];

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

function asStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

function normalizeRoute(moduleInfo, route) {
  if (!route || typeof route.path !== 'string' || !route.path.startsWith('/')) {
    return undefined;
  }
  const contains =
    typeof route.contains === 'string' || Array.isArray(route.contains)
      ? route.contains
      : moduleInfo.name ?? moduleInfo.id;
  return {
    path: route.path,
    auth: route.auth ?? true,
    contains,
    viewports: asStringArray(route.viewports),
    moduleId: moduleInfo.id,
    source: 'module-quality',
  };
}

function productPageSamplePath(page) {
  const sample = typeof page?.samplePath === 'string' ? page.samplePath : page?.path;
  return typeof sample === 'string' ? sample.replace(/:[^/]+/g, 'demo') : undefined;
}

function productPageHostPath(page) {
  const sample = productPageSamplePath(page);
  if (!sample || !sample.startsWith('/')) {
    return undefined;
  }
  if (page.shell === 'site') {
    return sample;
  }
  if (page.shell === 'dashboard') {
    return sample === '/' ? '/dashboard' : `/dashboard${sample}`;
  }
  if (page.shell === 'admin') {
    return sample === '/' ? '/zh/admin' : `/zh/admin${sample}`;
  }
  return undefined;
}

function productPageQualityRoute(moduleInfo, page, kind) {
  if (!page || typeof page !== 'object' || page.required === false) {
    return undefined;
  }
  const quality = asObject(page.quality) ?? {};
  if (quality[kind] === false) {
    return undefined;
  }
  const path = productPageHostPath(page);
  if (!path) {
    return undefined;
  }
  return normalizeRoute(moduleInfo, {
    path,
    auth: quality.auth ?? (page.shell === 'site' ? 'public' : true),
    contains: quality.contains ?? page.title ?? moduleInfo.name ?? moduleInfo.id,
    viewports: asStringArray(quality.viewports),
  });
}

function collectProductQualityRoutes(moduleRecord, kind) {
  const product = asObject(moduleRecord?.product);
  const pages = Array.isArray(product?.pages) ? product.pages : [];
  return pages
    .map((page) => productPageQualityRoute(moduleRecord, page, kind))
    .filter(Boolean);
}

function normalizeEvidence(moduleInfo, evidence) {
  if (!evidence || typeof evidence.id !== 'string') {
    return undefined;
  }
  const command = asObject(evidence.command);
  return {
    id: evidence.id,
    title:
      typeof evidence.title === 'string'
        ? evidence.title
        : `${moduleInfo.name ?? moduleInfo.id} module quality`,
    moduleId: moduleInfo.id,
    runtimeDir: typeof evidence.runtimeDir === 'string' ? evidence.runtimeDir : evidence.id,
    required: evidence.required !== false,
    checks: asStringArray(evidence.checks),
    command:
      command && typeof command.script === 'string'
        ? {
            script: command.script,
            args: asStringArray(command.args),
          }
        : undefined,
  };
}

function normalizeApiPerformanceRoute(moduleInfo, route) {
  if (!route || typeof route.path !== 'string' || !route.path.startsWith('/')) {
    return undefined;
  }
  const method = typeof route.method === 'string' ? route.method.toUpperCase() : 'GET';
  return {
    moduleId: moduleInfo.id,
    path: route.path,
    method,
    auth: typeof route.auth === 'string' ? route.auth : 'admin',
    maxP95Ms: Number.isFinite(route.maxP95Ms) ? route.maxP95Ms : undefined,
    maxResponseBytes: Number.isFinite(route.maxResponseBytes)
      ? route.maxResponseBytes
      : undefined,
    source: 'module-quality-performance',
  };
}

function normalizePagePerformanceRoute(moduleInfo, route) {
  if (!route || typeof route.path !== 'string' || !route.path.startsWith('/')) {
    return undefined;
  }
  return {
    moduleId: moduleInfo.id,
    shell: typeof route.shell === 'string' ? route.shell : 'dashboard',
    path: route.path,
    params: asObject(route.params),
    samplePath:
      typeof route.samplePath === 'string' && route.samplePath.startsWith('/')
        ? route.samplePath
        : undefined,
    maxLoaderMs: Number.isFinite(route.maxLoaderMs) ? route.maxLoaderMs : undefined,
    maxLoaderDataBytes: Number.isFinite(route.maxLoaderDataBytes)
      ? route.maxLoaderDataBytes
      : undefined,
    source: 'module-quality-performance',
  };
}

export function readModuleQualityManifest(projectRoot = process.cwd()) {
  const manifestPath = path.resolve(projectRoot, 'src', 'lib', 'module-map.manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return { path: manifestPath, modules: [], error: 'Module map manifest is missing.' };
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const modules = Array.isArray(manifest.modules) ? manifest.modules : [];
    return { path: manifestPath, modules };
  } catch (error) {
    return {
      path: manifestPath,
      modules: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function collectModuleQualityRoutes(kind, projectRoot = process.cwd()) {
  const manifest = readModuleQualityManifest(projectRoot);
  if (manifest.error) {
    return [];
  }
  return manifest.modules.flatMap((moduleInfo) => {
    const moduleRecord = asObject(moduleInfo);
    const routes = asObject(asObject(moduleRecord?.quality)?.routes)?.[kind];
    const declared = Array.isArray(routes)
      ? routes.map((route) => normalizeRoute(moduleRecord, route)).filter(Boolean)
      : [];
    const product = collectProductQualityRoutes(moduleRecord, kind);
    const known = new Set();
    return [...declared, ...product].filter((route) => {
      const key = `${route.path}:${route.moduleId}`;
      if (known.has(key)) {
        return false;
      }
      known.add(key);
      return true;
    });
  });
}

export function collectModuleQualityEvidence(projectRoot = process.cwd()) {
  const manifest = readModuleQualityManifest(projectRoot);
  if (manifest.error) {
    return [];
  }
  return manifest.modules.flatMap((moduleInfo) => {
    const moduleRecord = asObject(moduleInfo);
    const evidence = asObject(moduleRecord?.quality)?.evidence;
    return Array.isArray(evidence)
      ? evidence.map((item) => normalizeEvidence(moduleRecord, item)).filter(Boolean)
      : [];
  });
}

export function collectModuleApiPerformanceRoutes(projectRoot = process.cwd()) {
  const manifest = readModuleQualityManifest(projectRoot);
  if (manifest.error) {
    return [];
  }
  return manifest.modules.flatMap((moduleInfo) => {
    const moduleRecord = asObject(moduleInfo);
    const routes = asObject(asObject(moduleRecord?.quality)?.performance)?.apiRoutes;
    return Array.isArray(routes)
      ? routes.map((route) => normalizeApiPerformanceRoute(moduleRecord, route)).filter(Boolean)
      : [];
  });
}

export function collectModulePagePerformanceRoutes(projectRoot = process.cwd()) {
  const manifest = readModuleQualityManifest(projectRoot);
  if (manifest.error) {
    return [];
  }
  return manifest.modules.flatMap((moduleInfo) => {
    const moduleRecord = asObject(moduleInfo);
    const routes = asObject(asObject(moduleRecord?.quality)?.performance)?.pageRoutes;
    return Array.isArray(routes)
      ? routes.map((route) => normalizePagePerformanceRoute(moduleRecord, route)).filter(Boolean)
      : [];
  });
}

export function apiPerformanceCheckId(route) {
  return `api:${route.moduleId}:${(route.method ?? 'GET').toUpperCase()}:${route.path}`;
}

export function pagePerformanceCheckId(route) {
  return `page:${route.moduleId}:${route.samplePath ?? route.path}`;
}

export function collectModuleProductChecks(projectRoot = process.cwd()) {
  const manifest = readModuleQualityManifest(projectRoot);
  if (manifest.error) {
    return [];
  }

  return manifest.modules.flatMap((moduleInfo) => {
    const moduleRecord = asObject(moduleInfo);
    const product = asObject(moduleRecord?.product);
    if (!product) {
      return [];
    }
    const pages = Array.isArray(product.pages) ? product.pages.map(asObject).filter(Boolean) : [];
    const requiredShells = asStringArray(product.requiredShells);
    const pageShells = new Set(pages.map((page) => page?.shell).filter(Boolean));
    const issues = [];
    for (const shell of requiredShells) {
      if (!pageShells.has(shell)) {
        issues.push(`required shell "${shell}" has no declared product page`);
      }
    }
    for (const [index, page] of pages.entries()) {
      if (typeof page.path !== 'string' || !page.path.startsWith('/')) {
        issues.push(`product.pages.${index}.path is invalid`);
      }
      if (typeof page.audience !== 'string' || !page.audience.trim()) {
        issues.push(`product.pages.${index}.audience is missing`);
      }
      if (typeof page.userQuestion !== 'string' || !page.userQuestion.trim()) {
        issues.push(`product.pages.${index}.userQuestion is missing`);
      }
      if (!Array.isArray(page.primaryActions) || page.primaryActions.length === 0) {
        issues.push(`product.pages.${index}.primaryActions is missing`);
      }
    }
    return [
      {
        id: `${moduleRecord.id}:product-shape`,
        title: `${moduleRecord.name ?? moduleRecord.id} product shape declaration`,
        moduleId: moduleRecord.id,
        ok: issues.length === 0,
        status: issues.length === 0 ? 'passed' : 'failed',
        requiredShells,
        productPages: pages.length,
        issues,
      },
    ];
  });
}

export function routeAppliesToViewport(route, viewportId) {
  const viewports = Array.isArray(route.viewports) ? route.viewports : [];
  return viewports.length === 0 || viewports.includes(viewportId);
}

export function routeViewports(route) {
  const viewports = Array.isArray(route.viewports) ? route.viewports : [];
  return viewports.length > 0 ? viewports : DEFAULT_VIEWPORTS;
}

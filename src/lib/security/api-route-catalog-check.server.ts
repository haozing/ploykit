import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  API_HTTP_METHODS,
  type ApiHttpMethod,
  isApiStateChangingMethod,
  resolveApiRoutePolicy,
} from './api-route-catalog';

export interface DiscoveredApiRoute {
  routePath: string;
  filePath: string;
  methods: ApiHttpMethod[];
  source: string;
}

export interface ApiRouteCatalogValidationResult {
  valid: boolean;
  routesScanned: number;
  methodsScanned: number;
  issues: string[];
  routes: DiscoveredApiRoute[];
}

const ROUTE_FILE_NAME = 'route.ts';
const METHOD_SET = new Set<string>(API_HTTP_METHODS);
const NAMED_METHOD_EXPORT_RE =
  /export\s+(?:async\s+function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;
const DESTRUCTURED_METHOD_EXPORT_RE = /export\s+const\s+\{\s*([^}]+?)\s*\}\s*=/g;

async function collectRouteFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectRouteFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && entry.name === ROUTE_FILE_NAME) {
      files.push(fullPath);
    }
  }

  return files;
}

function parseDestructuredMethodNames(source: string): ApiHttpMethod[] {
  const methods = new Set<ApiHttpMethod>();
  const matches = source.matchAll(DESTRUCTURED_METHOD_EXPORT_RE);

  for (const match of matches) {
    const names = match[1]
      .split(',')
      .map((name) => name.trim().split(':')[0].trim())
      .filter(Boolean);

    for (const name of names) {
      if (METHOD_SET.has(name)) {
        methods.add(name as ApiHttpMethod);
      }
    }
  }

  return [...methods];
}

export function parseRouteMethods(source: string): ApiHttpMethod[] {
  const methods = new Set<ApiHttpMethod>();

  for (const match of source.matchAll(NAMED_METHOD_EXPORT_RE)) {
    methods.add(match[1] as ApiHttpMethod);
  }

  for (const method of parseDestructuredMethodNames(source)) {
    methods.add(method);
  }

  return [...methods].sort();
}

function toApiRoutePath(apiRoot: string, routeFilePath: string): string {
  const routeDirectory = path.dirname(routeFilePath);
  const relativeRoute = path.relative(apiRoot, routeDirectory).split(path.sep).join('/');
  return relativeRoute ? `/api/${relativeRoute}` : '/api';
}

export async function discoverAppApiRoutes(
  apiRoot = path.join(process.cwd(), 'src', 'app', 'api')
): Promise<DiscoveredApiRoute[]> {
  const files = await collectRouteFiles(apiRoot);
  const routes: DiscoveredApiRoute[] = [];

  for (const filePath of files) {
    const source = await readFile(filePath, 'utf8');
    routes.push({
      routePath: toApiRoutePath(apiRoot, filePath),
      filePath,
      methods: parseRouteMethods(source),
      source,
    });
  }

  return routes.sort((left, right) => left.routePath.localeCompare(right.routePath));
}

function hasGuardSource(source: string, guards: string[]): boolean {
  return guards.some((guard) => new RegExp(`\\b${guard}\\b`).test(source));
}

function validatePolicyGuardSource(
  route: DiscoveredApiRoute,
  method: ApiHttpMethod
): string | null {
  const policy = resolveApiRoutePolicy(route.routePath, method);

  if (!policy) {
    return null;
  }

  if (policy.access === 'admin' && !hasGuardSource(route.source, ['withAdminGuard'])) {
    return `${method} ${route.routePath} is declared admin but route source does not reference withAdminGuard`;
  }

  if (
    policy.access === 'authenticated' &&
    !hasGuardSource(route.source, ['withAuth', 'withAdminGuard'])
  ) {
    return `${method} ${route.routePath} is declared authenticated but route source does not reference withAuth or withAdminGuard`;
  }

  return null;
}

export function validateApiRouteCatalog(
  routes: DiscoveredApiRoute[]
): ApiRouteCatalogValidationResult {
  const issues: string[] = [];
  let methodsScanned = 0;

  for (const route of routes) {
    if (route.methods.length === 0) {
      issues.push(`${route.routePath} does not export any supported HTTP method`);
      continue;
    }

    for (const method of route.methods) {
      methodsScanned += 1;
      const policy = resolveApiRoutePolicy(route.routePath, method);

      if (!policy) {
        issues.push(`${method} ${route.routePath} is missing an API route catalog policy`);
        continue;
      }

      if (isApiStateChangingMethod(method) && policy.mutationProtection === 'none') {
        issues.push(`${method} ${route.routePath} is state-changing but has no mutation guard`);
      }

      const guardIssue = validatePolicyGuardSource(route, method);
      if (guardIssue) {
        issues.push(guardIssue);
      }
    }
  }

  return {
    valid: issues.length === 0,
    routesScanned: routes.length,
    methodsScanned,
    issues,
    routes,
  };
}

export async function inspectApiRouteCatalog(
  apiRoot = path.join(process.cwd(), 'src', 'app', 'api')
): Promise<ApiRouteCatalogValidationResult> {
  const routes = await discoverAppApiRoutes(apiRoot);
  return validateApiRouteCatalog(routes);
}

import fs from 'node:fs';
import path from 'node:path';
import { ADMIN_CONSOLE_ROUTES } from './admin-console-nav';
import {
  getAdminRegistryEntries,
  type AdminRegistryEntry,
} from './admin-route-registry';
import { discoverHostApiRoutes } from './route-security-audit';
import type { HostApiRouteDescriptor } from './security';

export interface AdminShellAudit {
  ok: boolean;
  registryEntries: number;
  pageFiles: number;
  apiRouteFiles: number;
  pageRoutesMissingRegistry: readonly string[];
  registryPagesWithoutFiles: readonly string[];
  apiRoutesMissingRegistry: readonly HostApiRouteDescriptor[];
  registryApisWithoutFiles: readonly string[];
  navRoutesMissingRegistry: readonly string[];
  navRoutesMissingCapability: readonly string[];
  actionDefinitionsMissingRegistry: readonly string[];
  registryActionsWithoutDefinitions: readonly string[];
  duplicateActionDefinitions: readonly string[];
  manualActionContexts: readonly string[];
}

function slash(value: string): string {
  return value.replace(/\\/g, '/');
}

function routeSegment(segment: string): string | null {
  if (segment.startsWith('(') && segment.endsWith(')')) {
    return null;
  }
  return segment;
}

function adminPageFileToPath(adminRoot: string, filePath: string): string {
  const relative = slash(path.relative(adminRoot, path.dirname(filePath)));
  if (!relative || relative === '.') {
    return '/admin';
  }
  const segments = relative.split('/').map(routeSegment).filter(Boolean);
  return `/admin/${segments.join('/')}`;
}

function discoverAdminPageFiles(adminRoot: string): string[] {
  if (!fs.existsSync(adminRoot)) {
    return [];
  }

  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }
      if (entry.isFile() && entry.name === 'page.tsx') {
        files.push(entryPath);
      }
    }
  };
  visit(adminRoot);
  return files.sort();
}

function discoverSourceFiles(root: string): string[] {
  if (!fs.existsSync(root)) {
    return [];
  }

  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.next') {
          continue;
        }
        visit(entryPath);
        continue;
      }
      if (entry.isFile() && /\.(tsx?|mts)$/.test(entry.name)) {
        files.push(entryPath);
      }
    }
  };
  visit(root);
  return files.sort();
}

function adminActionDefinitionIds(source: string): string[] {
  const ids: string[] = [];
  const pattern =
    /createAdminAction(?:<[\s\S]*?>)?\s*\(\s*{[\s\S]*?id:\s*['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    ids.push(match[1]!);
  }
  return ids;
}

function routeMethodKey(pathname: string, method: string): string {
  return `${pathname} ${method.toUpperCase()}`;
}

function apiMethods(entry: AdminRegistryEntry): readonly string[] {
  return entry.methods && entry.methods.length > 0 ? entry.methods : ['GET'];
}

export function discoverAdminPageRoutes(projectRoot = process.cwd()): readonly string[] {
  const adminRoot = path.join(
    projectRoot,
    'apps',
    'host-next',
    'app',
    '[lang]',
    'admin'
  );
  return discoverAdminPageFiles(adminRoot).map((filePath) =>
    adminPageFileToPath(adminRoot, filePath)
  );
}

export function auditAdminShellRegistry(projectRoot = process.cwd()): AdminShellAudit {
  const registryEntries = getAdminRegistryEntries();
  const pageEntries = registryEntries.filter((entry) => entry.kind === 'page');
  const apiEntries = registryEntries.filter((entry) => entry.kind === 'api');
  const actionEntries = registryEntries.filter((entry) => entry.kind === 'action');

  const actualPageRoutes = discoverAdminPageRoutes(projectRoot);
  const actualPageSet = new Set(actualPageRoutes);
  const registryPageSet = new Set(pageEntries.map((entry) => entry.path));

  const actualAdminApiRoutes = discoverHostApiRoutes(projectRoot).filter((route) =>
    route.path.startsWith('/api/admin')
  );
  const actualApiMethodSet = new Set<string>();
  for (const route of actualAdminApiRoutes) {
    for (const method of route.methods) {
      actualApiMethodSet.add(routeMethodKey(route.path, method));
    }
  }

  const registryApiMethodSet = new Set<string>();
  for (const entry of apiEntries) {
    for (const method of apiMethods(entry)) {
      registryApiMethodSet.add(routeMethodKey(entry.path, method));
    }
  }

  const pageRoutesMissingRegistry = actualPageRoutes.filter((route) => !registryPageSet.has(route));
  const registryPagesWithoutFiles = pageEntries
    .map((entry) => entry.path)
    .filter((route) => !actualPageSet.has(route));

  const apiRoutesMissingRegistry = actualAdminApiRoutes.flatMap((route) => {
    const missingMethods = route.methods.filter(
      (method) => !registryApiMethodSet.has(routeMethodKey(route.path, method))
    );
    return missingMethods.length > 0 ? [{ ...route, methods: missingMethods }] : [];
  });
  const registryApisWithoutFiles = apiEntries.flatMap((entry) =>
    apiMethods(entry)
      .map((method) => routeMethodKey(entry.path, method))
      .filter((key) => !actualApiMethodSet.has(key))
  );

  const pageByPath = new Map(pageEntries.map((entry) => [entry.path, entry]));
  const navRoutesMissingRegistry = ADMIN_CONSOLE_ROUTES.filter(
    (route) => !pageByPath.has(route.href)
  ).map((route) => route.href);
  const navRoutesMissingCapability = ADMIN_CONSOLE_ROUTES.flatMap((route) => {
    const page = pageByPath.get(route.href);
    if (!page || route.capabilities.includes(page.capability)) {
      return [];
    }
    return [`${route.href} -> ${page.capability}`];
  });

  const hostSourceFiles = discoverSourceFiles(path.join(projectRoot, 'apps', 'host-next'));
  const actionDefinitionCounts = new Map<string, number>();
  const manualActionContexts: string[] = [];
  for (const filePath of hostSourceFiles) {
    const source = fs.readFileSync(filePath, 'utf8');
    const relativeFile = slash(path.relative(projectRoot, filePath));
    for (const actionId of adminActionDefinitionIds(source)) {
      actionDefinitionCounts.set(actionId, (actionDefinitionCounts.get(actionId) ?? 0) + 1);
    }
    if (
      source.includes('requireAdminActionContext(') &&
      !relativeFile.endsWith('/lib/admin-action.ts') &&
      !relativeFile.endsWith('/lib/request-context.ts') &&
      !relativeFile.endsWith('/lib/admin-shell-audit.ts')
    ) {
      manualActionContexts.push(relativeFile);
    }
  }
  const actionDefinitionSet = new Set(actionDefinitionCounts.keys());
  const registryActionSet = new Set(actionEntries.map((entry) => entry.id));
  const actionDefinitionsMissingRegistry = [...actionDefinitionSet].filter(
    (actionId) => !registryActionSet.has(actionId)
  );
  const registryActionsWithoutDefinitions = actionEntries
    .map((entry) => entry.id)
    .filter((actionId) => !actionDefinitionSet.has(actionId));
  const duplicateActionDefinitions = [...actionDefinitionCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([actionId]) => actionId);

  return {
    ok:
      pageRoutesMissingRegistry.length === 0 &&
      registryPagesWithoutFiles.length === 0 &&
      apiRoutesMissingRegistry.length === 0 &&
      registryApisWithoutFiles.length === 0 &&
      navRoutesMissingRegistry.length === 0 &&
      navRoutesMissingCapability.length === 0 &&
      actionDefinitionsMissingRegistry.length === 0 &&
      registryActionsWithoutDefinitions.length === 0 &&
      duplicateActionDefinitions.length === 0 &&
      manualActionContexts.length === 0,
    registryEntries: registryEntries.length,
    pageFiles: actualPageRoutes.length,
    apiRouteFiles: actualAdminApiRoutes.length,
    pageRoutesMissingRegistry,
    registryPagesWithoutFiles,
    apiRoutesMissingRegistry,
    registryApisWithoutFiles,
    navRoutesMissingRegistry,
    navRoutesMissingCapability,
    actionDefinitionsMissingRegistry,
    registryActionsWithoutDefinitions,
    duplicateActionDefinitions,
    manualActionContexts,
  };
}

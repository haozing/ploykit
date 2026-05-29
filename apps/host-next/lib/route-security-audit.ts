import fs from 'node:fs';
import path from 'node:path';
import {
  auditHostRouteSecurityCatalog,
  type HostApiRouteDescriptor,
  type HostRouteSecurityAudit,
} from './security';

const ROUTE_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

function slash(value: string): string {
  return value.replace(/\\/g, '/');
}

function routeFileToApiPath(apiRoot: string, filePath: string): string {
  const relative = slash(path.relative(apiRoot, path.dirname(filePath)));
  return `/api/${relative}`.replace(/\/index$/, '').replace(/\/$/, '');
}

function discoverRouteFiles(apiRoot: string): string[] {
  if (!fs.existsSync(apiRoot)) {
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
      if (entry.isFile() && entry.name === 'route.ts') {
        files.push(entryPath);
      }
    }
  };
  visit(apiRoot);
  return files.sort();
}

function exportedMethods(source: string): string[] {
  return ROUTE_METHODS.filter((method) =>
    new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b`).test(source)
  );
}

export function discoverHostApiRoutes(
  projectRoot = process.cwd()
): HostApiRouteDescriptor[] {
  const apiRoot = path.join(projectRoot, 'apps', 'host-next', 'app', 'api');
  return discoverRouteFiles(apiRoot).flatMap((filePath) => {
    const source = fs.readFileSync(filePath, 'utf8');
    const methods = exportedMethods(source);
    if (methods.length === 0) {
      return [];
    }

    return [
      {
        path: routeFileToApiPath(apiRoot, filePath),
        methods,
        file: slash(path.relative(projectRoot, filePath)),
      },
    ];
  });
}

export function auditDiscoveredHostApiRoutes(
  projectRoot = process.cwd()
): HostRouteSecurityAudit {
  return auditHostRouteSecurityCatalog(discoverHostApiRoutes(projectRoot));
}

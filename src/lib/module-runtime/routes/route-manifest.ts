import type {
  ModuleApiRoute,
  ModulePageRoute,
  ModuleRouteAuth,
  PermissionValue,
} from '@ploykit/module-sdk';
import type { ModuleRuntimeContract } from '../contract';
import {
  compileModuleRoutePath,
  matchModuleRoutePath,
  type CompiledModuleRoutePath,
  type ModuleRoutePathMatch,
} from './route-pattern';

export type ModuleRuntimeRouteKind = 'site' | 'dashboard' | 'admin' | 'api';
export type ModuleRuntimeRouteSource = 'route' | 'alias' | 'publicAlias';

export type ModuleRuntimeRouteDefinition = ModulePageRoute | ModuleApiRoute;

export interface ModuleRuntimeRouteEntry {
  moduleId: string;
  kind: ModuleRuntimeRouteKind;
  path: string;
  source: ModuleRuntimeRouteSource;
  canonicalPath: string;
  auth: ModuleRouteAuth;
  permissions: readonly PermissionValue[];
  route: ModuleRuntimeRouteDefinition;
  compiled: CompiledModuleRoutePath;
}

export interface ModuleRuntimeRouteMatch {
  entry: ModuleRuntimeRouteEntry;
  params: ModuleRoutePathMatch['params'];
}

function routeSpecificity(entry: ModuleRuntimeRouteEntry): number {
  return entry.compiled.segments.reduce((score, segment) => {
    if (segment.kind === 'static') {
      return score + 3;
    }
    if (segment.kind === 'param') {
      return score + 1;
    }
    return score;
  }, 0);
}

function createEntry(
  contract: ModuleRuntimeContract,
  kind: ModuleRuntimeRouteKind,
  route: ModuleRuntimeRouteDefinition,
  path = route.path,
  source: ModuleRuntimeRouteSource = 'route'
): ModuleRuntimeRouteEntry {
  return {
    moduleId: contract.id,
    kind,
    path,
    source,
    canonicalPath: route.path,
    auth: route.auth ?? (kind === 'admin' ? 'admin' : 'auth'),
    permissions: route.permissions ?? [],
    route,
    compiled: compileModuleRoutePath(path),
  };
}

export function createModuleRouteManifest(
  contracts: readonly ModuleRuntimeContract[]
): ModuleRuntimeRouteEntry[] {
  const entries: ModuleRuntimeRouteEntry[] = [];

  for (const contract of contracts) {
    for (const kind of ['site', 'dashboard', 'admin'] as const) {
      for (const route of contract.routes[kind]) {
        entries.push(createEntry(contract, kind, route));

        for (const alias of route.aliases ?? []) {
          entries.push(createEntry(contract, kind, route, alias, 'alias'));
        }

        if (kind === 'site') {
          for (const publicAlias of route.publicAliases ?? []) {
            entries.push(createEntry(contract, kind, route, publicAlias, 'publicAlias'));
          }
        }
      }
    }

    entries.push(...contract.routes.api.map((route) => createEntry(contract, 'api', route)));
  }

  return entries.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind.localeCompare(right.kind);
    }
    if (left.compiled.segments.length !== right.compiled.segments.length) {
      return right.compiled.segments.length - left.compiled.segments.length;
    }
    return routeSpecificity(right) - routeSpecificity(left);
  });
}

export function findModuleRouteMatch(
  manifest: readonly ModuleRuntimeRouteEntry[],
  kind: ModuleRuntimeRouteKind,
  pathname: string
): ModuleRuntimeRouteMatch | null {
  for (const entry of manifest) {
    if (entry.kind !== kind) {
      continue;
    }

    const match = matchModuleRoutePath(entry.compiled, pathname);
    if (match) {
      return { entry, params: match.params };
    }
  }

  return null;
}

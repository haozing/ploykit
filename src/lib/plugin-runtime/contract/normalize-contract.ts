import {
  type DefinedPlugin,
  type PluginDefinition,
  type PluginHttpMethod,
  type PluginPublicRouteAlias,
  type PluginPublicRouteAliasDeclaration,
  type PluginRouteAuth,
  type PluginRouteLayout,
  type PluginToolRoute,
} from '@ploykit/plugin-sdk';
import { normalizeRuntimePath } from './route-matcher';
import type {
  PluginRuntimeContract,
  RuntimeApiRoute,
  RuntimePageRoute,
  RuntimePluginDefinition,
  RuntimeRouteArea,
} from './types';

const DEFAULT_API_METHODS: readonly PluginHttpMethod[] = ['GET'];
const TOOL_PATH_PREFIX = '/tools';

function layoutDefaultAuth(layout: PluginRouteLayout | undefined): PluginRouteAuth {
  if (layout === 'dashboard-admin') {
    return 'admin';
  }

  if (layout === 'dashboard') {
    return 'auth';
  }

  return 'public';
}

function routeAuth(
  auth: PluginRouteAuth | undefined,
  layout: PluginRouteLayout | undefined
): PluginRouteAuth {
  return auth ?? layoutDefaultAuth(layout);
}

function routeArea(layout: PluginRouteLayout): RuntimeRouteArea {
  return layout === 'dashboard-admin' ? 'admin' : 'public';
}

function normalizePublicAlias(alias: PluginPublicRouteAliasDeclaration): PluginPublicRouteAlias {
  if (typeof alias === 'string') {
    return { path: normalizeRuntimePath(alias) };
  }

  return {
    ...alias,
    path: normalizeRuntimePath(alias.path),
  };
}

function normalizePublicAliases(
  aliases: readonly PluginPublicRouteAliasDeclaration[] | undefined
): readonly PluginPublicRouteAlias[] {
  return (aliases ?? []).map(normalizePublicAlias);
}

function normalizePageRoutes(definition: PluginDefinition): RuntimePageRoute[] {
  return (definition.routes?.pages ?? []).map((route) => {
    const layout = route.layout ?? 'site';

    return {
      kind: 'page',
      path: normalizeRuntimePath(route.path),
      component: route.component,
      auth: routeAuth(route.auth, layout),
      layout,
      area: routeArea(layout),
      permissions: route.permissions ?? [],
      commercial: route.commercial,
      publicAliases: normalizePublicAliases(route.publicAliases),
    };
  });
}

function normalizeToolRuntimePath(path: string): string {
  const routePath = normalizeRuntimePath(path);
  if (routePath === TOOL_PATH_PREFIX || routePath.startsWith(`${TOOL_PATH_PREFIX}/`)) {
    return routePath;
  }

  return normalizeRuntimePath(`${TOOL_PATH_PREFIX}${routePath}`);
}

function normalizeToolRoutes(definition: PluginDefinition): RuntimePageRoute[] {
  return (definition.routes?.tools ?? []).map((route: PluginToolRoute) => {
    const path = normalizeToolRuntimePath(route.path);

    return {
      kind: 'page',
      path,
      component: route.component,
      auth: route.auth ?? 'public',
      layout: 'site',
      area: 'public',
      permissions: route.permissions ?? [],
      commercial: route.commercial,
      publicAliases: normalizePublicAliases(route.publicAliases),
      tool: {
        path,
        seo: route.seo,
        sitemap: route.sitemap,
        cache: route.cache,
        anonymousPolicy: route.anonymousPolicy,
      },
    };
  });
}

function normalizeApiRoutes(definition: PluginDefinition): RuntimeApiRoute[] {
  return (definition.routes?.apis ?? []).flatMap((route) => {
    const methods = route.methods?.length ? route.methods : DEFAULT_API_METHODS;

    return methods.map((method) => ({
      kind: 'api' as const,
      path: normalizeRuntimePath(route.path),
      handler: route.handler,
      method,
      auth: route.auth ?? 'auth',
      machineAuth: route.machineAuth,
      layout: 'dashboard' as const,
      permissions: route.permissions ?? [],
      commercial: route.commercial,
      anonymousPolicy: route.anonymousPolicy,
    }));
  });
}

function normalizeMenus(definition: PluginDefinition) {
  const menu = definition.menu;

  if (!menu) {
    return [];
  }

  return Array.isArray(menu) ? [...menu] : [menu];
}

export function isDefinedPlugin(value: unknown): value is DefinedPlugin {
  return Boolean(
    value &&
      typeof value === 'object' &&
      '$$ploykit' in value &&
      (value as { $$ploykit?: { type?: unknown } }).$$ploykit?.type === 'ploykit.plugin'
  );
}

export function normalizePluginRuntimeContract(
  definition: RuntimePluginDefinition
): PluginRuntimeContract {
  const pages = [...normalizePageRoutes(definition), ...normalizeToolRoutes(definition)];
  const apis = normalizeApiRoutes(definition);

  return {
    id: definition.id,
    name: definition.name,
    version: definition.version,
    kind: definition.kind ?? 'app',
    trustLevel: definition.trustLevel ?? 'untrusted',
    permissions: definition.permissions ?? [],
    data: definition.data,
    menu: normalizeMenus(definition),
    slots: definition.slots ?? {},
    resources: definition.resources ?? {},
    theme: definition.theme,
    config: definition.config,
    events: {
      publishes: definition.events?.publishes ?? [],
      subscribes: definition.events?.subscribes ?? {},
    },
    jobs: definition.jobs ?? {},
    webhooks: definition.webhooks ?? {},
    hooks: definition.hooks ?? {},
    meters: definition.meters ?? [],
    services: definition.services ?? [],
    resourceBindings: definition.resourceBindings ?? [],
    egress: definition.egress ?? [],
    definition,
    routes: {
      pages,
      apis,
      all: [...pages, ...apis],
    },
    lifecycle: definition.lifecycle ?? {},
  };
}

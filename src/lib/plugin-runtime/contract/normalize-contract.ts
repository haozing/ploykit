import {
  type DefinedPlugin,
  type PluginDefinition,
  type PluginHostPageOverrideDefinition,
  type PluginHostPageSlotDefinition,
  type PluginHttpMethod,
  type PluginPublicRouteAlias,
  type PluginPublicRouteAliasDeclaration,
  type PluginRouteAuth,
  type PluginRouteLayout,
  type PluginToolRoute,
} from '@ploykit/plugin-sdk';
import { normalizeRuntimePath } from './route-matcher';
import { EMPTY_RUNTIME_HOST_PAGES } from './types';
import type {
  PluginRuntimeContract,
  RuntimeApiRoute,
  RuntimeHostPageOverride,
  RuntimeHostPageSlot,
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

function normalizeHostPageSlots(definition: PluginDefinition): RuntimeHostPageSlot[] {
  return (definition.hostPages?.slots ?? [])
    .filter(
      (
        slot
      ): slot is PluginHostPageSlotDefinition & {
        position: Exclude<PluginHostPageSlotDefinition['position'], 'main.replace'>;
      } => slot.position !== 'main.replace'
    )
    .map((slot) => ({
      page: normalizeRuntimePath(slot.page),
      position: slot.position,
      component: slot.component,
      priority: slot.priority ?? 100,
    }));
}

function normalizeHostPageOverride(
  override: PluginHostPageOverrideDefinition
): RuntimeHostPageOverride {
  const page = normalizeRuntimePath(override.page);

  return {
    page,
    mode: override.mode,
    component: override.component,
    priority: override.priority ?? 100,
    shell: {
      layout: override.shell?.layout ?? 'site',
      header: override.shell?.header ?? 'host',
      footer: override.shell?.footer ?? 'host',
      container: override.shell?.container ?? 'fixed',
      activeMenuPath: override.shell?.activeMenuPath
        ? normalizeRuntimePath(override.shell.activeMenuPath)
        : page,
    },
    seo: {
      ...override.seo,
      canonical: normalizeRuntimePath(override.seo.canonical),
    },
    i18n: {
      ...override.i18n,
      namespaces: [...(override.i18n.namespaces ?? [])],
      requiredLocales: [...override.i18n.requiredLocales],
    },
    cache: override.cache,
  };
}

function normalizeHostPages(definition: PluginDefinition) {
  return {
    slots: normalizeHostPageSlots(definition),
    overrides: (definition.hostPages?.overrides ?? []).map(normalizeHostPageOverride),
  };
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
    hostPages:
      definition.hostPages?.slots?.length || definition.hostPages?.overrides?.length
        ? normalizeHostPages(definition)
        : EMPTY_RUNTIME_HOST_PAGES,
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

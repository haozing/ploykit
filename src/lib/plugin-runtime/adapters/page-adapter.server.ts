import { PluginError } from '@ploykit/plugin-sdk';
import {
  findRuntimePageRouteMatch,
  normalizeRuntimePath,
  type PluginRuntimeContract,
  type RuntimePageRoute,
  type RuntimePathMatch,
} from '../contract';
import {
  getPluginRuntimeMapEntry,
  resolvePluginPageModule,
  type PluginRuntimeMapEntry,
} from '../loader';
import { enforcePluginPermissions, enforcePluginRuntimeAuth } from '../context';
import { enforcePluginRuntimeEnabled, pluginRuntimeRegistry } from '../registry';
import { enforcePluginCommercialGate } from './commercial-gate.server';

export interface PluginPageRuntimeOptions {
  entry?: PluginRuntimeMapEntry;
  enforceInstallation?: boolean;
  publicPathPrefix?: string;
  routeMatch?: { route: RuntimePageRoute } & RuntimePathMatch;
  query?: URLSearchParams | Record<string, string | string[] | undefined>;
  requestPathOverride?: string;
}

export interface PluginPageRuntimeResult {
  contract: PluginRuntimeContract;
  route: RuntimePageRoute;
  localPath: string;
  requestPath: string;
  params: Record<string, string>;
  query: Record<string, string | string[]>;
  module: {
    componentPath: string;
    load: () => Promise<unknown>;
  };
}

function createRequestPath(
  pluginId: string,
  slug: readonly string[],
  admin: boolean,
  publicPathPrefix?: string
): string {
  if (!admin && publicPathPrefix) {
    const prefix = normalizeRuntimePath(publicPathPrefix);
    const slugPath = normalizeRuntimePath(slug.join('/'));
    if (slugPath === prefix || slugPath.startsWith(`${prefix}/`)) {
      return slugPath;
    }

    return normalizeRuntimePath([publicPathPrefix, ...slug].filter(Boolean).join('/'));
  }

  return normalizeRuntimePath(
    [admin ? 'admin' : '', 'plugins', pluginId, ...slug].filter(Boolean).join('/')
  );
}

export async function resolvePluginPageRuntime(
  pluginId: string,
  slug: readonly string[],
  requestHeaders: Headers,
  options: PluginPageRuntimeOptions = {}
): Promise<PluginPageRuntimeResult> {
  return resolvePluginPageRuntimeInternal(pluginId, slug, requestHeaders, false, options);
}

export async function resolveAdminPluginPageRuntime(
  pluginId: string,
  slug: readonly string[],
  requestHeaders: Headers,
  options: PluginPageRuntimeOptions = {}
): Promise<PluginPageRuntimeResult> {
  return resolvePluginPageRuntimeInternal(pluginId, slug, requestHeaders, true, options);
}

async function resolvePluginPageRuntimeInternal(
  pluginId: string,
  slug: readonly string[],
  requestHeaders: Headers,
  admin: boolean,
  options: PluginPageRuntimeOptions
): Promise<PluginPageRuntimeResult> {
  const entry = options.entry ?? getPluginRuntimeMapEntry(pluginId);
  await enforcePluginRuntimeEnabled(pluginId, {
    enforce: options.enforceInstallation ?? !options.entry,
  });
  const contract = await pluginRuntimeRegistry.getOrLoad(pluginId, entry);
  const localPath = normalizeRuntimePath(slug.join('/'));
  const matched =
    options.routeMatch ??
    findRuntimePageRouteMatch(contract.routes.pages, localPath, admin ? 'admin' : 'public');
  const route = matched?.route;

  if (!route) {
    throw new PluginError({
      code: 'PLUGIN_PAGE_ROUTE_NOT_FOUND',
      message: `No plugin page route matches ${localPath}.`,
      statusCode: 404,
      details: {
        pluginId,
        localPath,
        area: admin ? 'admin' : 'public',
      },
    });
  }

  enforcePluginPermissions(contract, route.permissions);
  const { user } = await enforcePluginRuntimeAuth(contract, route, requestHeaders);
  await enforcePluginCommercialGate(contract, route, user);

  const moduleLoader = entry ? resolvePluginPageModule(entry, route.component) : null;
  if (!moduleLoader) {
    throw new PluginError({
      code: 'PLUGIN_PAGE_COMPONENT_NOT_FOUND',
      message: `Page component "${route.component}" was not found for plugin "${pluginId}".`,
      statusCode: 500,
      fix: 'Run npm run plugins:scan and ensure the component path exists inside the plugin.',
    });
  }

  return {
    contract,
    route,
    localPath,
    params: matched?.params ?? {},
    query: normalizeQuery(options.query),
    requestPath:
      options.requestPathOverride ??
      createRequestPath(pluginId, slug, admin, options.publicPathPrefix),
    module: {
      componentPath: route.component,
      load: moduleLoader,
    },
  };
}

function normalizeQuery(
  query: URLSearchParams | Record<string, string | string[] | undefined> | undefined
): Record<string, string | string[]> {
  if (!query) {
    return {};
  }

  if (query instanceof URLSearchParams) {
    const output: Record<string, string | string[]> = {};
    for (const [key, value] of query.entries()) {
      const existing = output[key];
      if (existing === undefined) {
        output[key] = value;
      } else if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        output[key] = [existing, value];
      }
    }
    return output;
  }

  return Object.fromEntries(
    Object.entries(query).filter((entry): entry is [string, string | string[]] => {
      const value = entry[1];
      return typeof value === 'string' || Array.isArray(value);
    })
  );
}

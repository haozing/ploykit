import 'server-only';

import { cache } from 'react';
import type { Metadata } from 'next';
import {
  PluginError,
  type PluginPublicRouteAlias,
  type PluginRouteSeoMetadata,
} from '@ploykit/plugin-sdk';
import { createPluginToolMetadata, createPluginToolStructuredDataScripts } from '../tools';
import {
  createPluginPublicAliasMetadata,
  createPluginPublicAliasStructuredDataScripts,
} from '../public-routes';
import { enforcePluginRuntimeAuth } from '../context';
import {
  getPluginRuntimeMapEntry,
  resolvePluginMetadataModule,
  type PluginRuntimeMapEntry,
} from '../loader';
import type { PluginRuntimeContract, RuntimePageRoute } from '../contract';
import { runPluginRouteMetadata } from '../adapters/route-loader.server';

export interface PluginRouteMetadataResolutionInput {
  pluginId: string;
  contract: PluginRuntimeContract;
  route: RuntimePageRoute;
  entry?: PluginRuntimeMapEntry | null;
  localPath: string;
  requestPath: string;
  params?: Record<string, string>;
  query?: Record<string, string | string[]>;
  locale: string;
  pathname: string;
  requestHeaders?: Headers;
  data?: unknown;
}

export interface PluginRouteStructuredDataScript {
  id: string;
  json: string;
}

export interface PluginRouteMetadataResolution {
  metadata: Metadata;
  structuredDataScripts: PluginRouteStructuredDataScript[];
}

interface StaticRouteMetadataSource {
  seo: PluginRouteSeoMetadata;
  publicAlias?: PluginPublicRouteAlias;
}

function staticMetadataSourceForRoute(
  route: RuntimePageRoute,
  requestPath: string
): StaticRouteMetadataSource | null {
  const matchingAlias = route.publicAliases.find(
    (alias) => alias.path === requestPath && alias.seo
  );
  if (matchingAlias?.seo) {
    return { seo: matchingAlias.seo, publicAlias: matchingAlias };
  }

  if (route.tool?.seo) {
    return { seo: route.tool.seo };
  }

  const fallbackAlias = route.publicAliases.find((alias) => alias.seo);
  return fallbackAlias?.seo ? { seo: fallbackAlias.seo, publicAlias: fallbackAlias } : null;
}

function metadataFromSeo(
  route: RuntimePageRoute,
  seo: PluginRouteSeoMetadata,
  input: PluginRouteMetadataResolutionInput,
  publicAlias?: PluginPublicRouteAlias
): PluginRouteMetadataResolution {
  if (publicAlias) {
    return {
      metadata: createPluginPublicAliasMetadata(publicAlias, {
        locale: input.locale,
        pathname: input.pathname,
      }),
      structuredDataScripts: createPluginPublicAliasStructuredDataScripts(publicAlias, {
        locale: input.locale,
      }),
    };
  }

  const tool = { path: route.tool?.path ?? route.path, seo };
  return {
    metadata: createPluginToolMetadata(tool, {
      locale: input.locale,
      pathname: input.pathname,
    }),
    structuredDataScripts: createPluginToolStructuredDataScripts(tool, {
      locale: input.locale,
    }),
  };
}

async function runDynamicMetadata(
  input: PluginRouteMetadataResolutionInput
): Promise<PluginRouteSeoMetadata | null> {
  if (!input.route.metadata) {
    return null;
  }

  const entry = input.entry ?? getPluginRuntimeMapEntry(input.pluginId);
  const moduleLoader = entry ? resolvePluginMetadataModule(entry, input.route.metadata) : null;
  if (!moduleLoader) {
    throw new PluginError({
      code: 'PLUGIN_ROUTE_METADATA_NOT_FOUND',
      message: `Route metadata "${input.route.metadata}" was not found for plugin "${input.pluginId}".`,
      statusCode: 500,
      fix: 'Run npm run plugins:scan and ensure the metadata path exists inside the plugin.',
    });
  }

  const auth = await enforcePluginRuntimeAuth(
    input.contract,
    input.route,
    input.requestHeaders ?? new Headers()
  );
  const result = await runPluginRouteMetadata(moduleLoader, input.route.metadata, {
    contract: input.contract,
    route: input.route,
    localPath: input.localPath,
    requestPath: input.requestPath,
    params: input.params ?? {},
    query: input.query ?? {},
    locale: input.locale,
    requestHeaders: input.requestHeaders ?? new Headers(),
    auth,
    data: input.data,
  });

  return result?.notFound ? null : (result?.metadata ?? null);
}

async function resolvePluginRouteMetadataInternal(
  input: PluginRouteMetadataResolutionInput
): Promise<PluginRouteMetadataResolution> {
  const dynamicSeo = await runDynamicMetadata(input);
  if (dynamicSeo) {
    return metadataFromSeo(input.route, dynamicSeo, input);
  }

  const staticSource = staticMetadataSourceForRoute(input.route, input.requestPath);

  if (!staticSource) {
    return { metadata: {}, structuredDataScripts: [] };
  }

  return metadataFromSeo(input.route, staticSource.seo, input, staticSource.publicAlias);
}

export const resolvePluginRouteMetadata = cache(resolvePluginRouteMetadataInternal);

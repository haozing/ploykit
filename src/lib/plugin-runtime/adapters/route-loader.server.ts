import 'server-only';

import {
  PluginError,
  type PluginRouteMetadataHandler,
  type PluginRouteSeoMetadata,
  type PluginRuntimeLoader,
  type PluginRuntimeLoaderInput,
  type PluginRuntimeLoaderResult,
} from '@ploykit/plugin-sdk';
import { createPluginRuntimeContext } from '../context';
import {
  normalizeRuntimePath,
  type PluginRuntimeContract,
  type RuntimePageRoute,
} from '../contract';
import type { PluginModuleLoader } from '../loader';
import type { PluginRuntimeAuthResult } from '../context/permission-gate.server';
import {
  checkAnonymousRateLimit,
  createAnonymousRateLimitError,
  verifyAnonymousCaptcha,
  type AnonymousRuntimePolicyState,
  type AnonymousRuntimeRoute,
} from '../anonymous';

export interface PluginRouteExecutionInput {
  contract: PluginRuntimeContract;
  route: RuntimePageRoute;
  localPath: string;
  requestPath: string;
  params: Record<string, string>;
  query: Record<string, string | string[]>;
  locale: string;
  requestHeaders: Headers;
  auth: PluginRuntimeAuthResult;
}

export interface PluginRouteLoaderOutput {
  data: unknown;
  cache?: RuntimePageRoute['cache'];
  redirect?: {
    location: string;
    status?: 301 | 302 | 303 | 307 | 308;
  };
  notFound?: boolean;
}

export interface PluginRouteMetadataOutput {
  metadata: PluginRouteSeoMetadata;
  notFound?: boolean;
}

type RouteModule = Record<string, unknown>;

function createRequest(
  requestHeaders: Headers,
  requestPath: string,
  query: Record<string, string | string[]>
): Request {
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? 'localhost';
  const protocol = requestHeaders.get('x-forwarded-proto') ?? 'http';
  const url = new URL(normalizeRuntimePath(requestPath), `${protocol}://${host}`);

  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(key, item);
      }
    } else {
      url.searchParams.set(key, value);
    }
  }

  return new Request(url, { headers: requestHeaders });
}

function runtimeRouteProps(route: RuntimePageRoute) {
  return {
    path: route.path,
    auth: route.auth,
    layout: route.layout,
    permissions: route.permissions,
    commercial: route.commercial,
    publicAliases: route.publicAliases,
    tool: route.tool,
  };
}

export function createRouteRuntimeInput(
  input: PluginRouteExecutionInput
): PluginRuntimeLoaderInput {
  return {
    localPath: input.localPath,
    requestPath: input.requestPath,
    params: input.params,
    query: input.query,
    locale: input.locale,
    route: runtimeRouteProps(input.route),
  };
}

function createRequestForInput(input: PluginRouteExecutionInput): Request {
  return createRequest(input.requestHeaders, input.requestPath, input.query);
}

function anonymousRouteFor(route: RuntimePageRoute): AnonymousRuntimeRoute {
  return {
    path: route.path,
    auth: route.auth,
  };
}

function anonymousPolicyState(
  input: PluginRouteExecutionInput
): AnonymousRuntimePolicyState | undefined {
  if (input.auth.user || input.route.auth !== 'public') {
    return undefined;
  }

  return {
    route: anonymousRouteFor(input.route),
    policy: input.route.anonymousPolicy,
    anonymous: true,
  };
}

async function enforceRouteAnonymousPolicy(input: PluginRouteExecutionInput): Promise<void> {
  if (input.auth.user || input.route.auth !== 'public') {
    return;
  }

  const request = createRequestForInput(input);
  const route = anonymousRouteFor(input.route);
  const policy = input.route.anonymousPolicy;
  const decision = checkAnonymousRateLimit({
    request,
    pluginId: input.contract.id,
    route,
    policy,
  });

  if (!decision.allowed) {
    throw createAnonymousRateLimitError({
      pluginId: input.contract.id,
      routePath: input.route.path,
      retryAfter: decision.retryAfter,
    });
  }

  await verifyAnonymousCaptcha({
    request,
    pluginId: input.contract.id,
    route,
    policy,
  });
}

function createRouteContext(input: PluginRouteExecutionInput) {
  return createPluginRuntimeContext({
    contract: input.contract,
    request: createRequestForInput(input),
    user: input.auth.user,
    apiKey: input.auth.apiKey,
    routeParams: input.params,
    anonymousPolicyState: anonymousPolicyState(input),
  });
}

function getHandler<THandler extends (...args: never[]) => unknown>(
  module: unknown,
  exportNames: readonly string[],
  label: string,
  modulePath: string
): THandler {
  const record = module as RouteModule;
  const handler = exportNames
    .map((name) => record[name])
    .find((value) => typeof value === 'function');

  if (typeof handler !== 'function') {
    throw new PluginError({
      code: 'PLUGIN_ROUTE_HANDLER_INVALID',
      message: `${label} "${modulePath}" must export a handler function.`,
      statusCode: 500,
      fix: `Export default or ${exportNames.join('/')} from ${modulePath}.`,
      details: {
        modulePath,
        label,
      },
    });
  }

  return handler as THandler;
}

function normalizeLoaderResult(result: PluginRuntimeLoaderResult): PluginRouteLoaderOutput {
  if (
    result &&
    typeof result === 'object' &&
    'kind' in result &&
    typeof (result as { kind?: unknown }).kind === 'string'
  ) {
    const typed = result as {
      kind: 'data' | 'notFound' | 'redirect';
      data?: unknown;
      cache?: RuntimePageRoute['cache'];
      location?: string;
      status?: 301 | 302 | 303 | 307 | 308;
    };
    if (typed.kind === 'data') {
      return { data: typed.data, cache: typed.cache };
    }
    if (typed.kind === 'notFound') {
      return { data: undefined, notFound: true };
    }
    if (typed.kind === 'redirect') {
      return {
        data: undefined,
        redirect: { location: typed.location ?? '/', status: typed.status },
      };
    }
  }

  return { data: result };
}

export async function runPluginRouteLoader(
  moduleLoader: PluginModuleLoader | null,
  modulePath: string | undefined,
  input: PluginRouteExecutionInput
): Promise<PluginRouteLoaderOutput> {
  if (!moduleLoader || !modulePath) {
    return { data: undefined };
  }

  await enforceRouteAnonymousPolicy(input);
  const loaded = await moduleLoader();
  const handler = getHandler<PluginRuntimeLoader>(
    loaded,
    ['default', 'loader', 'load'],
    'Route loader',
    modulePath
  );
  const result = await handler(createRouteContext(input), createRouteRuntimeInput(input));
  return normalizeLoaderResult(result);
}

export async function runPluginRouteMetadata(
  moduleLoader: PluginModuleLoader | null,
  modulePath: string | undefined,
  input: PluginRouteExecutionInput & { data?: unknown }
): Promise<PluginRouteMetadataOutput | null> {
  if (!moduleLoader || !modulePath) {
    return null;
  }

  await enforceRouteAnonymousPolicy(input);
  const loaded = await moduleLoader();
  const handler = getHandler<PluginRouteMetadataHandler>(
    loaded,
    ['default', 'metadata', 'generateMetadata'],
    'Route metadata',
    modulePath
  );
  const result = await handler(createRouteContext(input), {
    ...createRouteRuntimeInput(input),
    data: input.data,
  });

  if (!result) {
    return null;
  }

  if ('kind' in result) {
    if (result.kind === 'notFound') {
      return { metadata: {}, notFound: true };
    }
    return { metadata: result.metadata };
  }

  return { metadata: result };
}

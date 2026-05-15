import { PluginError, type PermissionValue, type PluginApiMethodName } from '@ploykit/plugin-sdk';
import { findRuntimeApiRouteMatch, normalizeRuntimePath, type RuntimeApiRoute } from '../contract';
import {
  extractDefinedApi,
  getPluginRuntimeMapEntry,
  resolvePluginApiModule,
  type PluginRuntimeMapEntry,
} from '../loader';
import { pluginRuntimeRegistry } from '../registry';
import {
  createPluginRuntimeContext,
  enforcePluginPermissions,
  enforcePluginRuntimeAuth,
} from '../context';
import { enforcePluginRuntimeEnabled } from '../registry';
import {
  checkAnonymousRateLimit,
  createAnonymousRateLimitError,
  verifyAnonymousCaptcha,
  type AnonymousRuntimePolicyState,
} from '../anonymous';
import { enforcePluginCommercialGate } from './commercial-gate.server';

export interface PluginApiRuntimeOptions {
  entry?: PluginRuntimeMapEntry;
  requiredPermissions?: readonly PermissionValue[];
  enforceInstallation?: boolean;
  now?: number;
}

export interface PluginApiRuntimeMatch {
  route: RuntimeApiRoute;
  localPath: string;
  params: Record<string, string>;
}

function methodToHandlerName(method: string): PluginApiMethodName {
  return method.toLowerCase() as PluginApiMethodName;
}

function jsonError(error: unknown): Response {
  if (error instanceof PluginError) {
    return Response.json(error.toJSON(), { status: error.statusCode });
  }

  const message = error instanceof Error ? error.message : String(error);
  return Response.json(
    {
      success: false,
      code: 'PLUGIN_RUNTIME_ERROR',
      error: {
        name: error instanceof Error ? error.name : 'Error',
        message,
        statusCode: 500,
      },
    },
    { status: 500 }
  );
}

function applyHeaders(response: Response, headers: Record<string, string>): Response {
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }
  return response;
}

export async function matchPluginApiRuntimeRoute(
  pluginId: string,
  slug: readonly string[],
  method: string,
  options: PluginApiRuntimeOptions = {}
): Promise<PluginApiRuntimeMatch> {
  const entry = options.entry ?? getPluginRuntimeMapEntry(pluginId);
  const contract = await pluginRuntimeRegistry.getOrLoad(pluginId, entry);
  const localPath = normalizeRuntimePath(slug.join('/'));
  const match = findRuntimeApiRouteMatch(contract.routes.apis, localPath, method);

  if (!match) {
    throw new PluginError({
      code: 'PLUGIN_ROUTE_NOT_FOUND',
      message: `No plugin API route matches ${method.toUpperCase()} ${localPath}.`,
      statusCode: 404,
      details: {
        pluginId,
        localPath,
      },
    });
  }

  return {
    route: match.route,
    localPath,
    params: match.params,
  };
}

export async function handlePluginApiRuntime(
  request: Request,
  pluginId: string,
  slug: readonly string[],
  options: PluginApiRuntimeOptions = {}
): Promise<Response> {
  try {
    const entry = options.entry ?? getPluginRuntimeMapEntry(pluginId);
    await enforcePluginRuntimeEnabled(pluginId, {
      enforce: options.enforceInstallation ?? !options.entry,
    });
    const contract = await pluginRuntimeRegistry.getOrLoad(pluginId, entry);
    const { route, params } = await matchPluginApiRuntimeRoute(pluginId, slug, request.method, {
      ...options,
      entry: entry ?? undefined,
    });

    enforcePluginPermissions(contract, [
      ...route.permissions,
      ...(options.requiredPermissions ?? []),
    ]);
    const authResult = await enforcePluginRuntimeAuth(contract, route, request.headers);
    const { user, apiKey } = authResult;
    await enforcePluginCommercialGate(contract, route, user);
    let anonymousPolicyState: AnonymousRuntimePolicyState | undefined;
    let anonymousRateLimitHeaders: Record<string, string> = {};

    if (route.auth === 'public' && !user) {
      const decision = checkAnonymousRateLimit({
        request,
        pluginId,
        route,
        policy: route.anonymousPolicy,
        now: options.now,
      });
      anonymousRateLimitHeaders = decision.headers;
      if (!decision.allowed) {
        throw createAnonymousRateLimitError({
          pluginId,
          routePath: route.path,
          retryAfter: decision.retryAfter,
        });
      }
      await verifyAnonymousCaptcha({
        request,
        pluginId,
        route,
        policy: route.anonymousPolicy,
      });
      anonymousPolicyState = {
        route,
        policy: route.anonymousPolicy,
        anonymous: true,
      };
    }

    const moduleLoader = entry ? resolvePluginApiModule(entry, route.handler) : null;
    if (!moduleLoader) {
      throw new PluginError({
        code: 'PLUGIN_API_HANDLER_NOT_FOUND',
        message: `API handler "${route.handler}" was not found for plugin "${pluginId}".`,
        statusCode: 500,
        fix: 'Run npm run plugins:scan and ensure the handler path exists inside the plugin.',
      });
    }

    const apiDefinition = extractDefinedApi(await moduleLoader());
    const handler = apiDefinition[methodToHandlerName(request.method)];

    if (!handler) {
      throw new PluginError({
        code: 'PLUGIN_API_METHOD_NOT_IMPLEMENTED',
        message: `API handler "${route.handler}" does not implement ${request.method.toUpperCase()}.`,
        statusCode: 405,
        details: {
          pluginId,
          handler: route.handler,
          method: request.method.toUpperCase(),
        },
      });
    }

    const context = createPluginRuntimeContext({
      contract,
      request,
      user,
      apiKey,
      routeParams: params,
      anonymousPolicyState,
    });

    return applyHeaders(await handler(context), anonymousRateLimitHeaders);
  } catch (error) {
    return jsonError(error);
  }
}

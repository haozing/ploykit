import type {
  ModuleArtifactsApi,
  ModuleAiApi,
  ModuleApiKeysApi,
  ModuleAuditApi,
  ModuleCacheApi,
  ModuleBillingApi,
  ModuleCommerceApi,
  ModuleConfigApi,
  ModuleConnectorsApi,
  ModuleContext,
  ModuleCreditsApi,
  ModuleEntitlementsApi,
  ModuleEventsApi,
  ModuleFilesApi,
  ModuleHttpApi,
  ModuleJobsApi,
  ModuleMeteringApi,
  ModuleNotificationsApi,
  ModuleRagApi,
  ModuleRedeemCodesApi,
  ModuleRateLimitApi,
  ModuleRiskApi,
  ModuleResourceBindingsApi,
  ModuleRunsApi,
  ModuleSecretsApi,
  ModuleServicesApi,
  ModuleUsageApi,
  ModuleWebhooksApi,
} from '@ploykit/module-sdk';
import {
  dispatchModuleApiRoute,
  executeModuleAction,
  resolveModuleNavigation,
  resolveModulePageRouteMetadata,
  resolveModulePageRoute,
  resolveModuleSurfaceContributions,
  type DispatchModuleApiRouteInput,
  type ExecuteModuleActionInput,
  type ModulePageRouteKind,
  type ResolvedModuleNavigationItem,
  type ResolveModulePageRouteInput,
  type ResolveModulePageRouteMetadataResult,
  type ResolveModulePageRouteResult,
  type ResolvedModuleSurfaceContribution,
  type VerifyModuleApiKeyHandler,
} from '../adapters';
import { executeModuleAdminResourceOperation } from '../admin';
import { createModuleRuntimeContext } from '../context';
import {
  createPostgresModuleDataApi,
  type ModuleDataPostgresExecutor,
  type ModuleDataRuntimeSession,
} from '../data';
import type { ModuleRuntimeContract } from '../contract';
import type { ModuleMapArtifact } from '../loader';
import type { RuntimeStore } from '../stores/runtime-store-types';
import {
  createModuleRuntimeHost,
  type CreateModuleRuntimeHostOptions,
  type ModuleRuntimeDataApiFactory,
  type ModuleRuntimeHost,
} from './module-runtime-host';
import {
  createAnonymousModuleHostSession,
  type ModuleHostSession,
  type ModuleHostSessionResolver,
} from './session';
import {
  mountCapabilityDescriptors,
  type CapabilityDescriptorRegistry,
  type CapabilityProviderRegistry,
} from '../../module-kernel/capability-registry';
import { resolveTrustedModuleCapabilities } from './trusted-module-capabilities';

export interface CreateModuleHostDataSessionInput {
  contract: ModuleRuntimeContract;
  request: Request;
  params: Record<string, string>;
  hostSession: ModuleHostSession;
}

export interface CreateModuleHostDataOptions {
  database: ModuleDataPostgresExecutor;
  session?:
    | ModuleDataRuntimeSession
    | ((input: CreateModuleHostDataSessionInput) => ModuleDataRuntimeSession | null);
  schema?: string;
  useRlsSession?: boolean;
  wrapOperationsInTransaction?: boolean;
  unsafeAllowRlsBypass?: boolean;
}

export interface CreateModuleHostCapabilityInput {
  contract: ModuleRuntimeContract;
  request: Request;
  params: Record<string, string>;
  hostSession: ModuleHostSession;
}

export type CreateModuleHostCapability<TCapability> =
  | TCapability
  | ((input: CreateModuleHostCapabilityInput) => TCapability);

export interface CreateModuleHostCapabilitiesOptions {
  registry?: CapabilityDescriptorRegistry;
  providers?: CapabilityProviderRegistry;
  config?: ModuleConfigApi;
  secrets?: ModuleSecretsApi;
  services?: CreateModuleHostCapability<ModuleServicesApi>;
  connectors?: CreateModuleHostCapability<ModuleConnectorsApi>;
  resourceBindings?: CreateModuleHostCapability<ModuleResourceBindingsApi>;
  http?: CreateModuleHostCapability<ModuleHttpApi>;
  files?: CreateModuleHostCapability<ModuleFilesApi>;
  artifacts?: CreateModuleHostCapability<ModuleArtifactsApi>;
  notifications?: CreateModuleHostCapability<ModuleNotificationsApi>;
  runs?: CreateModuleHostCapability<ModuleRunsApi>;
  jobs?: CreateModuleHostCapability<ModuleJobsApi>;
  events?: CreateModuleHostCapability<ModuleEventsApi>;
  webhooks?: CreateModuleHostCapability<ModuleWebhooksApi>;
  usage?: CreateModuleHostCapability<ModuleUsageApi>;
  metering?: CreateModuleHostCapability<ModuleMeteringApi>;
  credits?: CreateModuleHostCapability<ModuleCreditsApi>;
  billing?: CreateModuleHostCapability<ModuleBillingApi>;
  entitlements?: CreateModuleHostCapability<ModuleEntitlementsApi>;
  commerce?: CreateModuleHostCapability<ModuleCommerceApi>;
  redeemCodes?: CreateModuleHostCapability<ModuleRedeemCodesApi>;
  ai?: CreateModuleHostCapability<ModuleAiApi>;
  rag?: CreateModuleHostCapability<ModuleRagApi>;
  apiKeys?: CreateModuleHostCapability<ModuleApiKeysApi>;
  rateLimit?: CreateModuleHostCapability<ModuleRateLimitApi>;
  risk?: CreateModuleHostCapability<ModuleRiskApi>;
  cache?: CreateModuleHostCapability<ModuleCacheApi>;
  audit?: CreateModuleHostCapability<ModuleAuditApi>;
}

export interface CreateModuleHostOptions extends CreateModuleRuntimeHostOptions {
  artifact: ModuleMapArtifact;
  resolveSession?: ModuleHostSessionResolver;
  verifyApiKey?: VerifyModuleApiKeyHandler;
  runtimeStore?: RuntimeStore;
  data?: CreateModuleHostDataOptions;
  capabilities?: CreateModuleHostCapabilitiesOptions;
  createDataApi?: ModuleRuntimeDataApiFactory;
}

export interface DispatchModuleHostApiRouteInput extends Omit<
  DispatchModuleApiRouteInput,
  'pathname' | 'user' | 'createContext'
> {
  pathname?: string;
  session?: ModuleHostSession;
}

export interface ExecuteModuleHostActionInput<TInput = unknown> extends Omit<
  ExecuteModuleActionInput<TInput>,
  'user' | 'createContext'
> {
  session?: ModuleHostSession;
}

export interface ExecuteModuleHostAdminResourceOperationInput<TInput = unknown> {
  resourceId: string;
  operationName: string;
  input?: TInput;
  request?: Request;
  session?: ModuleHostSession;
  params?: Record<string, string>;
  confirmed?: boolean;
  confirmation?: Record<string, unknown>;
}

export interface ResolveModuleHostPageRouteInput extends Omit<
  ResolveModulePageRouteInput,
  'user' | 'createContext'
> {
  kind: ModulePageRouteKind;
  session?: ModuleHostSession;
}

export interface ResolveModuleHostSurfaceContributionsOptions {
  session?: ModuleHostSession;
}

export interface ResolveModuleHostNavigationOptions {
  session?: ModuleHostSession;
}

export interface ModuleHost {
  runtime: ModuleRuntimeHost;
  dispatchApiRoute(input: DispatchModuleHostApiRouteInput): Promise<Response>;
  executeAction<TInput = unknown, TResult = unknown>(
    input: ExecuteModuleHostActionInput<TInput>
  ): Promise<TResult>;
  executeAdminResourceOperation<TInput = unknown, TResult = unknown>(
    input: ExecuteModuleHostAdminResourceOperationInput<TInput>
  ): Promise<TResult>;
  resolvePageRoute(input: ResolveModuleHostPageRouteInput): Promise<ResolveModulePageRouteResult>;
  resolvePageRouteMetadata(
    input: ResolveModuleHostPageRouteInput
  ): Promise<ResolveModulePageRouteMetadataResult>;
  resolveSurfaceContributions(
    surfaceId: string,
    options?: ResolveModuleHostSurfaceContributionsOptions
  ): ResolvedModuleSurfaceContribution[];
  resolveNavigation(
    location?: ResolvedModuleNavigationItem['item']['location'],
    options?: ResolveModuleHostNavigationOptions
  ): ResolvedModuleNavigationItem[];
  getContract(moduleId: string): ModuleRuntimeContract | null;
}

function requestPathname(request: Request): string {
  return new URL(request.url).pathname;
}

function createSyntheticActionRequest(moduleId: string, name: string): Request {
  return new Request(`http://localhost/modules/${moduleId}/actions/${name}`, {
    method: 'POST',
  });
}

async function resolveHostSession(
  options: CreateModuleHostOptions,
  input: Parameters<ModuleHostSessionResolver>[0],
  override?: ModuleHostSession
): Promise<ModuleHostSession> {
  if (override) {
    return override;
  }

  return options.resolveSession?.(input) ?? createAnonymousModuleHostSession();
}

function resolveDataSession(
  options: CreateModuleHostOptions,
  input: CreateModuleHostDataSessionInput
): ModuleDataRuntimeSession | null {
  if (input.hostSession.data) {
    return input.hostSession.data;
  }

  const configuredSession = options.data?.session;
  if (!configuredSession) {
    return null;
  }

  return typeof configuredSession === 'function' ? configuredSession(input) : configuredSession;
}

function createModuleHostDataApiFactory(
  options: CreateModuleHostOptions
): ModuleRuntimeDataApiFactory | undefined {
  const customCreateDataApi = options.createDataApi;
  const dataOptions = options.data;
  if (!dataOptions) {
    return customCreateDataApi;
  }

  return (input) => {
    const customData = customCreateDataApi?.(input);
    if (customData) {
      return customData;
    }

    const hostSession = (input.session ?? {
      user: input.user,
      permissions: [],
    }) as ModuleHostSession;
    const dataSession = resolveDataSession(options, {
      contract: input.contract,
      request: input.request,
      params: input.params,
      hostSession,
    });
    if (!dataSession) {
      throw new Error(`MODULE_HOST_DATA_SESSION_REQUIRED: ${input.contract.id}`);
    }

    return createPostgresModuleDataApi({
      contract: input.contract,
      database: dataOptions.database,
      session: dataSession,
      schema: dataOptions.schema,
      useRlsSession: dataOptions.useRlsSession,
      wrapOperationsInTransaction: dataOptions.wrapOperationsInTransaction,
      unsafeAllowRlsBypass: dataOptions.unsafeAllowRlsBypass,
    });
  };
}

function resolveCapability<TCapability>(
  capability: CreateModuleHostCapability<TCapability> | undefined,
  input: CreateModuleHostCapabilityInput
): TCapability | undefined {
  if (!capability) {
    return undefined;
  }

  return typeof capability === 'function'
    ? (capability as (input: CreateModuleHostCapabilityInput) => TCapability)(input)
    : capability;
}

function createContextFactory(
  runtime: ModuleRuntimeHost,
  options: CreateModuleHostOptions,
  hostSession: ModuleHostSession,
  mountedExtensions: {
    registry?: CapabilityDescriptorRegistry;
    providers?: CapabilityProviderRegistry;
  }
) {
  return (input: {
    moduleId: string;
    request: Request;
    user: ModuleHostSession['user'];
    session?: ModuleHostSession;
    params: Record<string, string>;
  }): ModuleContext => {
    const contract = runtime.getContract(input.moduleId);
    if (!contract) {
      throw new Error(`MODULE_HOST_CONTRACT_MISSING: ${input.moduleId}`);
    }

    const contextSession = input.session ?? hostSession;
    const capabilityInput = {
      contract,
      request: input.request,
      params: input.params,
      hostSession: contextSession,
    };
    const data = runtime.createDataApi?.({
      contract,
      request: input.request,
      user: input.user,
      params: input.params,
      session: contextSession,
    });
    const descriptorExtensions = mountedExtensions.registry
      ? mountCapabilityDescriptors({
          descriptors: mountedExtensions.registry,
          providers: {
            ...mountedExtensions.providers,
            services: options.capabilities?.services,
            connectors: options.capabilities?.connectors,
            resourceBindings: options.capabilities?.resourceBindings,
            http: options.capabilities?.http,
            files: options.capabilities?.files,
            artifacts: options.capabilities?.artifacts,
            notifications: options.capabilities?.notifications,
            runs: options.capabilities?.runs,
            jobs: options.capabilities?.jobs,
            events: options.capabilities?.events,
            webhooks: options.capabilities?.webhooks,
            usage: options.capabilities?.usage,
            metering: options.capabilities?.metering,
            credits: options.capabilities?.credits,
            billing: options.capabilities?.billing,
            entitlements: options.capabilities?.entitlements,
            commerce: options.capabilities?.commerce,
            redeemCodes: options.capabilities?.redeemCodes,
            ai: options.capabilities?.ai,
            rag: options.capabilities?.rag,
            apiKeys: options.capabilities?.apiKeys,
            rateLimit: options.capabilities?.rateLimit,
            risk: options.capabilities?.risk,
            cache: options.capabilities?.cache,
            audit: options.capabilities?.audit,
          },
          mountInput: {
            contract,
            request: input.request,
            params: input.params,
            session: contextSession,
          },
          allowedNames: contract.definition.uses?.capabilities ?? [],
        })
      : {};

    return createModuleRuntimeContext({
      contract,
      request: input.request,
      user: input.user,
      params: input.params,
      data,
      config: options.capabilities?.config,
      secrets: options.capabilities?.secrets,
      services: resolveCapability(options.capabilities?.services, capabilityInput),
      connectors: resolveCapability(options.capabilities?.connectors, capabilityInput),
      resourceBindings: resolveCapability(options.capabilities?.resourceBindings, capabilityInput),
      http: resolveCapability(options.capabilities?.http, capabilityInput),
      files: resolveCapability(options.capabilities?.files, capabilityInput),
      artifacts: resolveCapability(options.capabilities?.artifacts, capabilityInput),
      notifications: resolveCapability(options.capabilities?.notifications, capabilityInput),
      runs: resolveCapability(options.capabilities?.runs, capabilityInput),
      jobs: resolveCapability(options.capabilities?.jobs, capabilityInput),
      events: resolveCapability(options.capabilities?.events, capabilityInput),
      webhooks: resolveCapability(options.capabilities?.webhooks, capabilityInput),
      usage: resolveCapability(options.capabilities?.usage, capabilityInput),
      metering: resolveCapability(options.capabilities?.metering, capabilityInput),
      credits: resolveCapability(options.capabilities?.credits, capabilityInput),
      billing: resolveCapability(options.capabilities?.billing, capabilityInput),
      entitlements: resolveCapability(options.capabilities?.entitlements, capabilityInput),
      commerce: resolveCapability(options.capabilities?.commerce, capabilityInput),
      redeemCodes: resolveCapability(options.capabilities?.redeemCodes, capabilityInput),
      ai: resolveCapability(options.capabilities?.ai, capabilityInput),
      rag: resolveCapability(options.capabilities?.rag, capabilityInput),
      apiKeys: resolveCapability(options.capabilities?.apiKeys, capabilityInput),
      rateLimit: resolveCapability(options.capabilities?.rateLimit, capabilityInput),
      risk: resolveCapability(options.capabilities?.risk, capabilityInput),
      cache: resolveCapability(options.capabilities?.cache, capabilityInput),
      audit: resolveCapability(options.capabilities?.audit, capabilityInput),
      extensions: descriptorExtensions,
      session: contextSession,
    });
  };
}

export async function createModuleHost(options: CreateModuleHostOptions): Promise<ModuleHost> {
  const createDataApi = createModuleHostDataApiFactory(options);
  const runtime = await createModuleRuntimeHost(options.artifact, {
    contracts: options.contracts,
    createDataApi,
    catalog: options.catalog,
  });
  const mountedExtensions = await resolveTrustedModuleCapabilities({
    runtime,
    catalog: options.catalog,
    registry: options.capabilities?.registry,
    providers: options.capabilities?.providers,
  });

  return {
    runtime,
    async dispatchApiRoute(input) {
      const pathname = input.pathname ?? requestPathname(input.request);
      const params = input.params ?? {};
      const hostSession = await resolveHostSession(
        options,
        {
          operation: 'api',
          request: input.request,
          pathname,
          params,
        },
        input.session
      );
      const createContext = createContextFactory(runtime, options, hostSession, mountedExtensions);

      return dispatchModuleApiRoute(runtime, {
        request: input.request,
        pathname,
        params,
        user: hostSession.user,
        session: hostSession,
        verifyApiKey: options.verifyApiKey,
        runtimeStore: options.runtimeStore,
        createContext(contextInput) {
          return createContext({
            moduleId: contextInput.moduleId,
            request: contextInput.request,
            user: contextInput.user,
            session: contextInput.session as ModuleHostSession,
            params: contextInput.params,
          });
        },
      });
    },
    async executeAction<TInput = unknown, TResult = unknown>(
      input: ExecuteModuleHostActionInput<TInput>
    ): Promise<TResult> {
      const request = input.request ?? createSyntheticActionRequest(input.moduleId, input.name);
      const params = input.params ?? {};
      const hostSession = await resolveHostSession(
        options,
        {
          operation: 'action',
          request,
          moduleId: input.moduleId,
          actionName: input.name,
          params,
        },
        input.session
      );
      const createContext = createContextFactory(runtime, options, hostSession, mountedExtensions);

      return executeModuleAction<TInput, TResult>(runtime, {
        ...input,
        request,
        params,
        user: hostSession.user,
        session: hostSession,
        createContext(contextInput) {
          return createContext({
            moduleId: contextInput.moduleId,
            request: contextInput.request,
            user: contextInput.user,
            session: contextInput.session as ModuleHostSession,
            params: contextInput.params,
          });
        },
      });
    },
    async executeAdminResourceOperation<TInput = unknown, TResult = unknown>(
      input: ExecuteModuleHostAdminResourceOperationInput<TInput>
    ): Promise<TResult> {
      const request =
        input.request ??
        new Request(
          `http://localhost/admin/resources/${input.resourceId}/${input.operationName}`,
          { method: 'POST' }
        );
      const params = input.params ?? {};
      const hostSession = await resolveHostSession(
        options,
        {
          operation: 'admin-resource',
          request,
          resourceId: input.resourceId,
          operationName: input.operationName,
          params,
        },
        input.session
      );
      const createContext = createContextFactory(runtime, options, hostSession, mountedExtensions);

      return executeModuleAdminResourceOperation<TInput, TResult>(
        {
          host: runtime,
          store: options.runtimeStore,
        },
        {
          ...input,
          request,
          params,
          session: hostSession,
          createContext(contextInput) {
            return createContext({
              moduleId: contextInput.moduleId,
              request: contextInput.request,
              user: contextInput.session.user ?? null,
              session: contextInput.session,
              params: contextInput.params,
            });
          },
        }
      );
    },
    async resolvePageRoute(input) {
      const params = input.params ?? {};
      const hostSession = await resolveHostSession(
        options,
        {
          operation: 'page',
          request: input.request,
          pathname: input.pathname,
          routeKind: input.kind,
          params,
        },
        input.session
      );
      const createContext = createContextFactory(runtime, options, hostSession, mountedExtensions);

      return resolveModulePageRoute(runtime, {
        request: input.request,
        kind: input.kind,
        pathname: input.pathname,
        params,
        user: hostSession.user,
        session: hostSession,
        onTimingSpan: input.onTimingSpan,
        createContext(contextInput) {
          return createContext({
            moduleId: contextInput.moduleId,
            request: contextInput.request,
            user: contextInput.user,
            session: contextInput.session as ModuleHostSession,
            params: contextInput.params,
          });
        },
      });
    },
    async resolvePageRouteMetadata(input) {
      const params = input.params ?? {};
      const hostSession = await resolveHostSession(
        options,
        {
          operation: 'page',
          request: input.request,
          pathname: input.pathname,
          routeKind: input.kind,
          params,
        },
        input.session
      );
      const createContext = createContextFactory(runtime, options, hostSession, mountedExtensions);

      return resolveModulePageRouteMetadata(runtime, {
        request: input.request,
        kind: input.kind,
        pathname: input.pathname,
        params,
        user: hostSession.user,
        session: hostSession,
        onTimingSpan: input.onTimingSpan,
        createContext(contextInput) {
          return createContext({
            moduleId: contextInput.moduleId,
            request: contextInput.request,
            user: contextInput.user,
            session: contextInput.session as ModuleHostSession,
            params: contextInput.params,
          });
        },
      });
    },
    resolveSurfaceContributions(surfaceId, surfaceOptions = {}) {
      return resolveModuleSurfaceContributions(runtime, surfaceId, {
        session: surfaceOptions.session,
      });
    },
    resolveNavigation(location, navigationOptions = {}) {
      return resolveModuleNavigation(runtime, {
        location,
        session: navigationOptions.session,
      });
    },
    getContract(moduleId) {
      return runtime.getContract(moduleId);
    },
  };
}

import type {
  ModuleAiApi,
  ModuleAuditApi,
  ModuleCommercialApi,
  ModuleContext,
  ModuleEventsApi,
  ModuleFilesApi,
  ModuleJobsApi,
  ModuleNotificationsApi,
  ModuleRagApi,
  ModuleRunsApi,
  ModuleServicesApi,
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
  services?: CreateModuleHostCapability<ModuleServicesApi>;
  files?: CreateModuleHostCapability<ModuleFilesApi>;
  notifications?: CreateModuleHostCapability<ModuleNotificationsApi>;
  runs?: CreateModuleHostCapability<ModuleRunsApi>;
  jobs?: CreateModuleHostCapability<ModuleJobsApi>;
  events?: CreateModuleHostCapability<ModuleEventsApi>;
  webhooks?: CreateModuleHostCapability<ModuleWebhooksApi>;
  ai?: CreateModuleHostCapability<ModuleAiApi>;
  rag?: CreateModuleHostCapability<ModuleRagApi>;
  audit?: CreateModuleHostCapability<ModuleAuditApi>;
  commercial?: CreateModuleHostCapability<ModuleCommercialApi>;
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
  hostSession: ModuleHostSession
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
    return createModuleRuntimeContext({
      contract,
      request: input.request,
      user: input.user,
      params: input.params,
      data,
      services: resolveCapability(options.capabilities?.services, capabilityInput),
      files: resolveCapability(options.capabilities?.files, capabilityInput),
      notifications: resolveCapability(options.capabilities?.notifications, capabilityInput),
      runs: resolveCapability(options.capabilities?.runs, capabilityInput),
      jobs: resolveCapability(options.capabilities?.jobs, capabilityInput),
      events: resolveCapability(options.capabilities?.events, capabilityInput),
      webhooks: resolveCapability(options.capabilities?.webhooks, capabilityInput),
      ai: resolveCapability(options.capabilities?.ai, capabilityInput),
      rag: resolveCapability(options.capabilities?.rag, capabilityInput),
      audit: resolveCapability(options.capabilities?.audit, capabilityInput),
      commercial: resolveCapability(options.capabilities?.commercial, capabilityInput),
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
      const createContext = createContextFactory(runtime, options, hostSession);

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
      const createContext = createContextFactory(runtime, options, hostSession);

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
      const createContext = createContextFactory(runtime, options, hostSession);

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
      const createContext = createContextFactory(runtime, options, hostSession);

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

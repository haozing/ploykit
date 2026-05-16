import { randomUUID } from 'crypto';
import { z } from 'zod';
import type {
  PluginContext,
  PluginRequest,
  PluginResponseFactory,
  PluginUser,
} from '@ploykit/plugin-sdk';
import { Permission } from '@ploykit/plugin-sdk';
import { createPluginStorageRuntime } from '../storage/db-storage.server';
import type { PluginRuntimeContract } from '../contract';
import { resolveHostPluginAiOptions } from '@/lib/ai/ai-provider-config.server';
import {
  createPluginAuditCapability,
  createPluginApiKeysCapability,
  createPluginArtifactsCapability,
  createPluginAiCapability,
  createPluginBillingCapability,
  createPluginConfigCapability,
  createPluginConnectorsCapability,
  createPluginCreditsCapability,
  createPluginEventsCapability,
  createPluginFilesCapability,
  createPluginHttpCapability,
  createPluginJobsCapability,
  createPluginMeteringCapability,
  createPluginNotificationsCapability,
  createPluginRagCapability,
  createPluginRateLimitCapability,
  createPluginResourceBindingsCapability,
  createPluginRunsCapability,
  createPluginSecretsCapability,
  createPluginServicesCapability,
  createPluginUsageCapability,
  createPluginWebhooksCapability,
  createPluginWorkspaceCapability,
  type CreatePluginAuditOptions,
  type CreatePluginApiKeysOptions,
  type CreatePluginArtifactsOptions,
  type CreatePluginAiOptions,
  type CreatePluginBillingOptions,
  type CreatePluginConfigOptions,
  type CreatePluginConnectorsOptions,
  type CreatePluginCreditsOptions,
  type CreatePluginEventsOptions,
  type CreatePluginFilesOptions,
  type CreatePluginHttpOptions,
  type CreatePluginJobsOptions,
  type CreatePluginMeteringOptions,
  type CreatePluginNotificationsOptions,
  type CreatePluginRagOptions,
  type CreatePluginRateLimitOptions,
  type CreatePluginResourceBindingsOptions,
  type CreatePluginRunsOptions,
  type CreatePluginSecretsOptions,
  type CreatePluginServicesOptions,
  type CreatePluginUsageOptions,
  type CreatePluginWebhooksOptions,
  type CreatePluginWorkspaceOptions,
  type PluginCapabilityScope,
  type PluginRuntimeApiKeyContext,
  enforceCapabilityPermission,
} from '../capabilities';
import { assertAnonymousHighCostAllowed, type AnonymousRuntimePolicyState } from '../anonymous';

export interface CreatePluginContextOptions {
  contract: PluginRuntimeContract;
  request: Request;
  user: PluginUser | null;
  apiKey?: PluginRuntimeApiKeyContext;
  requestId?: string;
  routeParams?: Record<string, string>;
  system?: boolean;
  anonymousPolicyState?: AnonymousRuntimePolicyState;
  capabilities?: PluginCapabilityFactoryOptions;
}

export interface PluginCapabilityFactoryOptions {
  files?: CreatePluginFilesOptions;
  workspace?: CreatePluginWorkspaceOptions;
  artifacts?: CreatePluginArtifactsOptions;
  ai?: CreatePluginAiOptions;
  events?: CreatePluginEventsOptions;
  jobs?: CreatePluginJobsOptions;
  http?: CreatePluginHttpOptions;
  audit?: CreatePluginAuditOptions;
  usage?: CreatePluginUsageOptions;
  credits?: CreatePluginCreditsOptions;
  metering?: CreatePluginMeteringOptions;
  billing?: CreatePluginBillingOptions;
  notifications?: CreatePluginNotificationsOptions;
  rag?: CreatePluginRagOptions;
  runs?: CreatePluginRunsOptions;
  connectors?: CreatePluginConnectorsOptions;
  apiKeys?: CreatePluginApiKeysOptions;
  rateLimit?: CreatePluginRateLimitOptions;
  resourceBindings?: CreatePluginResourceBindingsOptions;
  config?: CreatePluginConfigOptions;
  secrets?: CreatePluginSecretsOptions;
  services?: CreatePluginServicesOptions;
  webhooks?: CreatePluginWebhooksOptions;
}

function createResponseFactory(): PluginResponseFactory {
  return {
    json(data, init) {
      return Response.json(data, init);
    },
    redirect(url, status = 302) {
      return Response.redirect(url, status);
    },
    stream(body, init) {
      return new Response(body, init);
    },
  };
}

function createPluginRequest(request: Request, params: Record<string, string> = {}): PluginRequest {
  const url = new URL(request.url);
  return {
    method: request.method,
    url: request.url,
    headers: request.headers,
    params,
    query: url.searchParams,
    async json<TSchema extends z.ZodTypeAny>(schema: TSchema): Promise<z.infer<TSchema>> {
      return schema.parse(await request.json()) as z.infer<TSchema>;
    },
    text() {
      return request.text();
    },
    formData() {
      return request.formData();
    },
  };
}

export function createPluginRuntimeContext(options: CreatePluginContextOptions): PluginContext {
  const response = createResponseFactory();
  const requestId = options.requestId ?? randomUUID();
  const capabilityScope: PluginCapabilityScope = {
    contract: options.contract,
    user: options.user,
    request: options.request,
    requestId,
    system: options.system,
    apiKey: options.apiKey,
  };
  const storage = createPluginStorageRuntime({
    pluginId: options.contract.id,
    userId: options.user?.id,
    system: options.system,
    data: options.contract.data,
    enforceRead: (capability) =>
      enforceCapabilityPermission(capabilityScope, Permission.StorageRead, capability),
    enforceWrite: (capability) =>
      enforceCapabilityPermission(capabilityScope, Permission.StorageWrite, capability),
  });
  const assertHighCostAllowed = (action: 'ai' | 'connector' | 'files.upload' | 'runs.create') =>
    assertAnonymousHighCostAllowed(options.anonymousPolicyState, {
      action,
      pluginId: options.contract.id,
    });
  const files = createPluginFilesCapability(capabilityScope, options.capabilities?.files);
  const ai = createPluginAiCapability(
    capabilityScope,
    resolveHostPluginAiOptions(options.capabilities?.ai)
  );
  const runs = createPluginRunsCapability(capabilityScope, options.capabilities?.runs);
  const connectors = createPluginConnectorsCapability(
    capabilityScope,
    options.capabilities?.connectors
  );

  return {
    plugin: {
      id: options.contract.id,
      version: options.contract.version,
      kind: options.contract.kind,
    },
    user: options.user,
    auth: options.apiKey
      ? {
          apiKey: {
            id: options.apiKey.id,
            scope: options.apiKey.scope,
            permissions: options.apiKey.permissions,
          },
        }
      : undefined,
    request: createPluginRequest(options.request, options.routeParams),
    response,
    storage,
    workspace: createPluginWorkspaceCapability(capabilityScope, options.capabilities?.workspace),
    ui: {
      toast: {
        success: async () => undefined,
        error: async () => undefined,
        info: async () => undefined,
      },
    },
    events: {
      ...createPluginEventsCapability(capabilityScope, options.capabilities?.events),
    },
    jobs: {
      ...createPluginJobsCapability(capabilityScope, options.capabilities?.jobs),
    },
    files: {
      ...files,
      async createUpload(input) {
        assertHighCostAllowed('files.upload');
        return files.createUpload(input);
      },
    },
    artifacts: createPluginArtifactsCapability(capabilityScope, options.capabilities?.artifacts),
    ai: {
      async generateText(input) {
        assertHighCostAllowed('ai');
        return ai.generateText(input);
      },
      async *streamText(input) {
        assertHighCostAllowed('ai');
        yield* ai.streamText(input);
      },
      async embedText(input) {
        assertHighCostAllowed('ai');
        return ai.embedText(input);
      },
    },
    secrets: createPluginSecretsCapability(capabilityScope, options.capabilities?.secrets),
    config: createPluginConfigCapability(capabilityScope, options.capabilities?.config),
    resourceBindings: createPluginResourceBindingsCapability(
      capabilityScope,
      options.capabilities?.resourceBindings
    ),
    audit: createPluginAuditCapability(capabilityScope, options.capabilities?.audit),
    usage: createPluginUsageCapability(capabilityScope, options.capabilities?.usage),
    credits: createPluginCreditsCapability(capabilityScope, options.capabilities?.credits),
    metering: createPluginMeteringCapability(capabilityScope, options.capabilities?.metering),
    billing: createPluginBillingCapability(capabilityScope, options.capabilities?.billing),
    runs: {
      ...runs,
      async create(input) {
        assertHighCostAllowed('runs.create');
        return runs.create(input);
      },
    },
    connectors: {
      ...connectors,
      async call(name, request) {
        assertHighCostAllowed('connector');
        return connectors.call(name, request);
      },
    },
    apiKeys: createPluginApiKeysCapability(capabilityScope, options.capabilities?.apiKeys),
    rateLimit: createPluginRateLimitCapability(capabilityScope, options.capabilities?.rateLimit),
    notifications: createPluginNotificationsCapability(
      capabilityScope,
      options.capabilities?.notifications
    ),
    rag: createPluginRagCapability(capabilityScope, options.capabilities?.rag),
    webhooks: createPluginWebhooksCapability(capabilityScope, options.capabilities?.webhooks),
    http: createPluginHttpCapability(capabilityScope, options.capabilities?.http),
    services: createPluginServicesCapability(capabilityScope, options.capabilities?.services),
    json: response.json,
  };
}

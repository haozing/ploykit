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
  ModuleUser,
  ModuleWebhooksApi,
} from '@ploykit/module-sdk';
import type { ModuleRuntimeContract } from '../contract';
import type { ModuleRuntimeHost } from '../host/module-runtime-host';
import type { ModuleRuntimeAccessSession } from '../security';
import { createModuleRuntimeContext } from './create-module-context';

export interface ModuleBackgroundContextCapabilities {
  config?: ModuleConfigApi;
  secrets?: ModuleSecretsApi;
  services?: ModuleServicesApi;
  connectors?: ModuleConnectorsApi;
  resourceBindings?: ModuleResourceBindingsApi;
  http?: ModuleHttpApi | ((moduleId: string) => ModuleHttpApi);
  files?: ModuleFilesApi | ((moduleId: string) => ModuleFilesApi);
  artifacts?: ModuleArtifactsApi | ((moduleId: string) => ModuleArtifactsApi);
  notifications?: ModuleNotificationsApi | ((moduleId: string) => ModuleNotificationsApi);
  runs?: ModuleRunsApi | ((moduleId: string) => ModuleRunsApi);
  jobs?: ModuleJobsApi | ((moduleId: string) => ModuleJobsApi);
  events?: ModuleEventsApi | ((moduleId: string) => ModuleEventsApi);
  webhooks?: ModuleWebhooksApi | ((moduleId: string) => ModuleWebhooksApi);
  usage?: ModuleUsageApi | ((moduleId: string) => ModuleUsageApi);
  metering?: ModuleMeteringApi | ((moduleId: string) => ModuleMeteringApi);
  credits?: ModuleCreditsApi | ((moduleId: string) => ModuleCreditsApi);
  billing?: ModuleBillingApi | ((moduleId: string) => ModuleBillingApi);
  entitlements?: ModuleEntitlementsApi | ((moduleId: string) => ModuleEntitlementsApi);
  commerce?: ModuleCommerceApi | ((moduleId: string) => ModuleCommerceApi);
  redeemCodes?: ModuleRedeemCodesApi | ((moduleId: string) => ModuleRedeemCodesApi);
  ai?: ModuleAiApi | ((moduleId: string) => ModuleAiApi);
  rag?: ModuleRagApi | ((moduleId: string) => ModuleRagApi);
  apiKeys?: ModuleApiKeysApi | ((moduleId: string) => ModuleApiKeysApi);
  rateLimit?: ModuleRateLimitApi | ((moduleId: string) => ModuleRateLimitApi);
  risk?: ModuleRiskApi | ((moduleId: string) => ModuleRiskApi);
  cache?: ModuleCacheApi | ((moduleId: string) => ModuleCacheApi);
  audit?: ModuleAuditApi;
}

export interface CreateModuleBackgroundContextInput {
  host: ModuleRuntimeHost;
  contract: ModuleRuntimeContract;
  request: Request;
  params?: Record<string, string>;
  session?: ModuleRuntimeAccessSession;
  capabilities?: ModuleBackgroundContextCapabilities;
}

function resolveScoped<TCapability>(
  capability: TCapability | ((moduleId: string) => TCapability) | undefined,
  moduleId: string
): TCapability | undefined {
  if (!capability) {
    return undefined;
  }

  return typeof capability === 'function'
    ? (capability as (moduleId: string) => TCapability)(moduleId)
    : capability;
}

export function createModuleBackgroundContext(
  input: CreateModuleBackgroundContextInput
): ModuleContext {
  const params = input.params ?? {};
  const user = (input.session?.user ?? null) as ModuleUser | null;
  const data = input.host.createDataApi?.({
    contract: input.contract,
    request: input.request,
    user,
    params,
    session: input.session,
  });

  return createModuleRuntimeContext({
    contract: input.contract,
    request: input.request,
    user,
    params,
    session: input.session,
    data,
    config: input.capabilities?.config,
    secrets: input.capabilities?.secrets,
    services: input.capabilities?.services,
    connectors: input.capabilities?.connectors,
    resourceBindings: input.capabilities?.resourceBindings,
    http: resolveScoped(input.capabilities?.http, input.contract.id),
    files: resolveScoped(input.capabilities?.files, input.contract.id),
    artifacts: resolveScoped(input.capabilities?.artifacts, input.contract.id),
    notifications: resolveScoped(input.capabilities?.notifications, input.contract.id),
    runs: resolveScoped(input.capabilities?.runs, input.contract.id),
    jobs: resolveScoped(input.capabilities?.jobs, input.contract.id),
    events: resolveScoped(input.capabilities?.events, input.contract.id),
    webhooks: resolveScoped(input.capabilities?.webhooks, input.contract.id),
    usage: resolveScoped(input.capabilities?.usage, input.contract.id),
    metering: resolveScoped(input.capabilities?.metering, input.contract.id),
    credits: resolveScoped(input.capabilities?.credits, input.contract.id),
    billing: resolveScoped(input.capabilities?.billing, input.contract.id),
    entitlements: resolveScoped(input.capabilities?.entitlements, input.contract.id),
    commerce: resolveScoped(input.capabilities?.commerce, input.contract.id),
    redeemCodes: resolveScoped(input.capabilities?.redeemCodes, input.contract.id),
    ai: resolveScoped(input.capabilities?.ai, input.contract.id),
    rag: resolveScoped(input.capabilities?.rag, input.contract.id),
    apiKeys: resolveScoped(input.capabilities?.apiKeys, input.contract.id),
    rateLimit: resolveScoped(input.capabilities?.rateLimit, input.contract.id),
    risk: resolveScoped(input.capabilities?.risk, input.contract.id),
    cache: resolveScoped(input.capabilities?.cache, input.contract.id),
    audit: input.capabilities?.audit,
  });
}

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
  ModuleUser,
  ModuleWebhooksApi,
} from '@ploykit/module-sdk';
import type { ModuleRuntimeContract } from '../contract';
import type { ModuleRuntimeHost } from '../host/module-runtime-host';
import type { ModuleRuntimeAccessSession } from '../security';
import { createModuleRuntimeContext } from './create-module-context';

export interface ModuleBackgroundContextCapabilities {
  services?: ModuleServicesApi;
  files?: ModuleFilesApi | ((moduleId: string) => ModuleFilesApi);
  notifications?: ModuleNotificationsApi | ((moduleId: string) => ModuleNotificationsApi);
  runs?: ModuleRunsApi | ((moduleId: string) => ModuleRunsApi);
  jobs?: ModuleJobsApi | ((moduleId: string) => ModuleJobsApi);
  events?: ModuleEventsApi | ((moduleId: string) => ModuleEventsApi);
  webhooks?: ModuleWebhooksApi | ((moduleId: string) => ModuleWebhooksApi);
  ai?: ModuleAiApi | ((moduleId: string) => ModuleAiApi);
  rag?: ModuleRagApi | ((moduleId: string) => ModuleRagApi);
  audit?: ModuleAuditApi;
  commercial?: ModuleCommercialApi | ((moduleId: string) => ModuleCommercialApi);
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
    services: input.capabilities?.services,
    files: resolveScoped(input.capabilities?.files, input.contract.id),
    notifications: resolveScoped(input.capabilities?.notifications, input.contract.id),
    runs: resolveScoped(input.capabilities?.runs, input.contract.id),
    jobs: resolveScoped(input.capabilities?.jobs, input.contract.id),
    events: resolveScoped(input.capabilities?.events, input.contract.id),
    webhooks: resolveScoped(input.capabilities?.webhooks, input.contract.id),
    ai: resolveScoped(input.capabilities?.ai, input.contract.id),
    rag: resolveScoped(input.capabilities?.rag, input.contract.id),
    audit: input.capabilities?.audit,
    commercial: resolveScoped(input.capabilities?.commercial, input.contract.id),
  });
}

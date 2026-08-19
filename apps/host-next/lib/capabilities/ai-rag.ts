import type { ModuleRuntimeContract } from '@/lib/module-runtime/contract/types';
import type { ModuleHostSession } from '@/lib/module-runtime/host/session';
import type { RuntimeStore } from '@/lib/module-runtime/stores/runtime-store-types';
import type { ModuleAiApi } from '@ploykit/module-sdk';
import { createHostModuleAiApi } from '../ai-provider';
import { createHostModuleRagApi } from '../rag-provider';
import type { HostModuleAuditWriter } from './audit';
import type { HostCommercialForSession } from './commercial';

export function createHostModuleAiApiForSession(input: {
  contract: ModuleRuntimeContract;
  hostSession: ModuleHostSession;
  commercialForSession: HostCommercialForSession;
  audit: HostModuleAuditWriter;
}): ModuleAiApi {
  return createHostModuleAiApi({
    moduleId: input.contract.id,
    session: input.hostSession,
    commercialForModule(moduleId) {
      return input.commercialForSession(input.hostSession).forModule(moduleId);
    },
    audit: input.audit,
  });
}

export function createHostModuleRagApiForSession(input: {
  contract: ModuleRuntimeContract;
  hostSession: ModuleHostSession;
  runtimeStore: {
    store: RuntimeStore;
    durable: boolean;
  };
  ai: ModuleAiApi;
  audit: HostModuleAuditWriter;
}) {
  return createHostModuleRagApi({
    moduleId: input.contract.id,
    session: input.hostSession,
    ai: input.ai,
    store: input.runtimeStore.store,
    durable: input.runtimeStore.durable,
    audit: input.audit,
  });
}

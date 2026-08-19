import type { ModuleRuntimeContract } from '@/lib/module-runtime/contract/types';
import type { ModuleHostSession } from '@/lib/module-runtime/host/session';
import { createHostFileRuntimeFromParts, type HostFileStorageHandle } from '../files';
import type { HostRuntimeStoreHandle } from '../runtime-store';

export function createHostModuleFilesApi(input: {
  contract: ModuleRuntimeContract;
  hostSession: ModuleHostSession;
  runtimeStore: HostRuntimeStoreHandle;
  fileStorage: HostFileStorageHandle;
}) {
  return createHostFileRuntimeFromParts({
    store: input.runtimeStore.store,
    storage: input.fileStorage.storage,
    session: input.hostSession,
  }).forModule(input.contract.id);
}

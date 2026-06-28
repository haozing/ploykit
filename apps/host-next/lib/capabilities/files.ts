import { createInMemoryModuleArtifactRuntime } from '@/lib/module-capabilities/artifacts/artifact-runtime';
import type { ModuleRuntimeContract } from '@/lib/module-runtime/contract/types';
import type { ModuleHostSession } from '@/lib/module-runtime/host/session';
import type { ModuleArtifactsApi } from '@ploykit/module-sdk';
import { createHostFileRuntimeFromParts, type HostFileStorageHandle } from '../files';
import type { HostRuntimeStoreHandle } from '../runtime-store';

const artifactRuntime = createInMemoryModuleArtifactRuntime();

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

export function createHostModuleArtifactsApi(input: {
  contract: ModuleRuntimeContract;
}): ModuleArtifactsApi {
  return artifactRuntime.forModule(input.contract.id);
}

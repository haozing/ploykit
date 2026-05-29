import type { HostBillingProviderStatus } from './commercial-provider';
import type { HostEmailProviderStatus } from './email-provider';
import type { HostAiProviderStatus } from './ai-provider';
import type { HostAuthStatus, HostSecurityStatus } from './host-config';
import type { HostFileStorageStatus } from './files';
import type { HostRagProviderStatus } from './rag-provider';
import type { HostRuntimeStoreStatus } from './runtime-store';

export interface HostProductScopeStatus {
  mode: 'runtime-store';
  durable: boolean;
}

export interface HostCatalogStatus {
  mode: 'runtime-store';
  durable: boolean;
}

export interface HostProviderStatus {
  ai: HostAiProviderStatus;
  rag: HostRagProviderStatus;
  notifications: 'runtime-store';
  email: HostEmailProviderStatus;
}

export interface HostWorkerStatus {
  mode: 'runtime-store-loop';
  durableQueue: boolean;
  lease: 'process-heartbeat';
  heartbeat: true;
}

export interface HostRuntimeHealth {
  store: HostRuntimeStoreStatus;
  auth: HostAuthStatus;
  productScope: HostProductScopeStatus;
  catalog: HostCatalogStatus;
  files: HostFileStorageStatus;
  billing: HostBillingProviderStatus;
  providers: HostProviderStatus;
  worker: HostWorkerStatus;
  security: HostSecurityStatus;
}

export function createHostRuntimeHealth(input: {
  store: HostRuntimeStoreStatus;
  auth: HostAuthStatus;
  files: HostFileStorageStatus;
  billing: HostBillingProviderStatus;
  ai: HostAiProviderStatus;
  rag: HostRagProviderStatus;
  email: HostEmailProviderStatus;
  security: HostSecurityStatus;
}): HostRuntimeHealth {
  return {
    store: input.store,
    auth: input.auth,
    productScope: {
      mode: 'runtime-store',
      durable: input.store.durable,
    },
    catalog: {
      mode: 'runtime-store',
      durable: input.store.durable,
    },
    files: input.files,
    billing: input.billing,
    providers: {
      ai: input.ai,
      rag: input.rag,
      notifications: 'runtime-store',
      email: input.email,
    },
    worker: {
      mode: 'runtime-store-loop',
      durableQueue: input.store.durable,
      lease: 'process-heartbeat',
      heartbeat: true,
    },
    security: input.security,
  };
}

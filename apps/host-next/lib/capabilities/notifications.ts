import { createRuntimeStoreNotificationRuntime } from '@/lib/module-capabilities/notifications/notification-runtime';
import type { ModuleRuntimeContract } from '@/lib/module-runtime/contract/types';
import type { ModuleHostSession } from '@/lib/module-runtime/host/session';
import { defaultProductId } from '../default-scope';
import type { HostRuntimeStoreHandle } from '../runtime-store';

export function createHostModuleNotificationsApi(input: {
  contract: ModuleRuntimeContract;
  hostSession: ModuleHostSession;
  runtimeStore: HostRuntimeStoreHandle;
}) {
  return createRuntimeStoreNotificationRuntime({
    store: input.runtimeStore.store,
    productId: defaultProductId(input.hostSession.productId),
    workspaceId: input.hostSession.workspaceId ?? null,
  }).forModule(input.contract.id);
}

import { randomUUID } from 'node:crypto';
import { createInMemoryBillingRuntimeStore } from './memory-runtime-store-billing';
import { createInMemoryCommercialRuntimeStore } from './memory-runtime-store-commercial';
import { createInMemoryConfigRuntimeStore } from './memory-runtime-store-config';
import { createInMemoryExecutionRuntimeStore } from './memory-runtime-store-execution';
import { createInMemoryFinanceRuntimeStore } from './memory-runtime-store-finance';
import { createInMemoryFilesRuntimeStore } from './memory-runtime-store-files';
import { createInMemoryIdentityRuntimeStore } from './memory-runtime-store-identity';
import { createInMemoryNotificationsRuntimeStore } from './memory-runtime-store-notifications';
import { createInMemoryObservabilityRuntimeStore } from './memory-runtime-store-observability';
import { createInMemoryProductScopeRuntimeStore } from './memory-runtime-store-product-scope';
import { createInMemoryRagRuntimeStore } from './memory-runtime-store-rag';
import { createInMemoryRedeemRuntimeStore } from './memory-runtime-store-redeem';
import { createInMemoryRiskRuntimeStore } from './memory-runtime-store-risk';
import { createInMemorySubscriptionRuntimeStore } from './memory-runtime-store-subscriptions';
import type { RuntimeStore } from './runtime-store-types';

export function createInMemoryRuntimeStore(
  options: {
    now?: () => Date;
    createId?: (prefix: string) => string;
  } = {}
): RuntimeStore {
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? ((prefix) => `${prefix}_${randomUUID()}`);
  const billingStore = createInMemoryBillingRuntimeStore({ now, createId });
  const commercialStore = createInMemoryCommercialRuntimeStore({ now, createId });
  const configStore = createInMemoryConfigRuntimeStore({ now, createId });
  const executionStore = createInMemoryExecutionRuntimeStore({ now, createId });
  const financeStore = createInMemoryFinanceRuntimeStore({ now, createId });
  const filesStore = createInMemoryFilesRuntimeStore({ now, createId });
  const identityStore = createInMemoryIdentityRuntimeStore({ now, createId });
  const notificationsStore = createInMemoryNotificationsRuntimeStore({ now, createId });
  const observabilityStore = createInMemoryObservabilityRuntimeStore({ now, createId });
  const productScopeStore = createInMemoryProductScopeRuntimeStore({ now });
  const ragStore = createInMemoryRagRuntimeStore({ now });
  const redeemStore = createInMemoryRedeemRuntimeStore({ now, createId });
  const riskStore = createInMemoryRiskRuntimeStore({ now, createId });
  const subscriptionStore = createInMemorySubscriptionRuntimeStore({ now, createId });

  return {
    ...billingStore,
    ...commercialStore,
    ...configStore,
    ...executionStore,
    ...financeStore,
    ...filesStore,
    ...identityStore,
    ...notificationsStore,
    ...observabilityStore,
    ...productScopeStore,
    ...ragStore,
    ...redeemStore,
    ...riskStore,
    ...subscriptionStore,
  };
}

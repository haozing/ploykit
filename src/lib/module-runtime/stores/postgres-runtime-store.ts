import type { ModuleDataPostgresExecutor } from '../data';
import { applyRuntimeStoreMigration } from './runtime-store-migrations';
import { createPostgresAuditStore } from './postgres-runtime-store-audit';
import { createPostgresCatalogStore } from './postgres-runtime-store-catalog';
import { createPostgresConfigStore } from './postgres-runtime-store-config';
import { createPostgresCommercialBillingStore } from './postgres-runtime-store-commercial-billing';
import { createPostgresCommercialCreditStore } from './postgres-runtime-store-commercial-credits';
import { createPostgresCommercialEntitlementStore } from './postgres-runtime-store-commercial-entitlements';
import { createPostgresCommercialOrderStore } from './postgres-runtime-store-commercial-orders';
import { createPostgresCommercialRedeemStore } from './postgres-runtime-store-commercial-redeem';
import { createPostgresCommercialRevenueStore } from './postgres-runtime-store-commercial-revenue';
import { createPostgresCommercialSubscriptionStore } from './postgres-runtime-store-commercial-subscriptions';
import { createPostgresCommercialTaxStore } from './postgres-runtime-store-commercial-tax';
import { createPostgresFileStore } from './postgres-runtime-store-files';
import { createPostgresIdentityStore } from './postgres-runtime-store-identity';
import { createPostgresMeteringStore } from './postgres-runtime-store-metering';
import { createPostgresNotificationStore } from './postgres-runtime-store-notifications';
import { createPostgresOutboxStore } from './postgres-runtime-store-outbox';
import { createPostgresProductScopeStore } from './postgres-runtime-store-product-scope';
import { createPostgresProviderInvocationStore } from './postgres-runtime-store-provider-invocations';
import { createPostgresRagStore } from './postgres-runtime-store-rag';
import { createPostgresRiskStore } from './postgres-runtime-store-risk';
import { createPostgresRunStore } from './postgres-runtime-store-runs';
import { createPostgresWebhookStore } from './postgres-runtime-store-webhooks';
import { createPostgresWorkerStore } from './postgres-runtime-store-workers';
import type { RuntimeStore } from './runtime-store-types';
import { createDefaultId } from './postgres-runtime-store-utils';

export interface CreatePostgresRuntimeStoreOptions {
  database: ModuleDataPostgresExecutor;
  createId?: (prefix: string) => string;
}

export function createPostgresRuntimeStore(
  options: CreatePostgresRuntimeStoreOptions
): RuntimeStore {
  const database = options.database;
  const createId = options.createId ?? createDefaultId;
  const auditStore = createPostgresAuditStore({ database, createId });
  const catalogStore = createPostgresCatalogStore({ database });
  const configStore = createPostgresConfigStore({ database });
  const commercialBillingStore = createPostgresCommercialBillingStore({ database, createId });
  const commercialCreditStore = createPostgresCommercialCreditStore({ database, createId });
  const commercialEntitlementStore = createPostgresCommercialEntitlementStore({
    database,
    createId,
  });
  const commercialOrderStore = createPostgresCommercialOrderStore({ database, createId });
  const commercialRedeemStore = createPostgresCommercialRedeemStore({ database, createId });
  const commercialRevenueStore = createPostgresCommercialRevenueStore({ database, createId });
  const commercialSubscriptionStore = createPostgresCommercialSubscriptionStore({
    database,
    createId,
  });
  const commercialTaxStore = createPostgresCommercialTaxStore({ database, createId });
  const fileStore = createPostgresFileStore({ database, createId });
  const identityStore = createPostgresIdentityStore({ database, createId });
  const meteringStore = createPostgresMeteringStore({ database, createId });
  const notificationStore = createPostgresNotificationStore({ database, createId });
  const outboxStore = createPostgresOutboxStore({ database, createId });
  const productScopeStore = createPostgresProductScopeStore({ database });
  const providerInvocationStore = createPostgresProviderInvocationStore({ database, createId });
  const ragStore = createPostgresRagStore({ database });
  const riskStore = createPostgresRiskStore({ database, createId });
  const runStore = createPostgresRunStore({ database, createId });
  const webhookStore = createPostgresWebhookStore({ database, createId });
  const workerStore = createPostgresWorkerStore({ database, createId });

  return {
    ensureSchema() {
      return applyRuntimeStoreMigration(database);
    },
    ...auditStore,
    ...catalogStore,
    ...configStore,
    ...commercialBillingStore,
    ...commercialCreditStore,
    ...commercialEntitlementStore,
    ...commercialOrderStore,
    ...commercialRedeemStore,
    ...commercialRevenueStore,
    ...commercialSubscriptionStore,
    ...commercialTaxStore,
    ...fileStore,
    ...identityStore,
    ...meteringStore,
    ...notificationStore,
    ...outboxStore,
    ...productScopeStore,
    ...providerInvocationStore,
    ...ragStore,
    ...riskStore,
    ...runStore,
    ...webhookStore,
    ...workerStore,
  };
}

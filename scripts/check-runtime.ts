import {
  Pool } from 'pg';
import { loadRuntimeConfig } from '../src/lib/runtime-config';
import {
  checkModuleMapHealth,
  createPgModuleDataExecutor,
  createPostgresRuntimeStore,
  loadModuleRuntimeContracts,
  runRuntimeChecks,
  type RuntimeChecksStatus,
} from '../src/lib/module-runtime';
import {
  createMemoryModuleFileStorage,
} from '../src/lib/module-capabilities';
import { MODULE_MAP_ARTIFACT } from '../src/lib/module-map';
import { resolveHostRuntimeStoreConfig } from '../apps/host-next/lib/runtime-store';

const config = loadRuntimeConfig(process.env);
const storeConfig = resolveHostRuntimeStoreConfig({
  PLOYKIT_RUNTIME_STORE: process.env.PLOYKIT_RUNTIME_STORE,
  DATABASE_URL: process.env.DATABASE_URL,
  POSTGRES_URL: process.env.POSTGRES_URL,
});
let pool: Pool | undefined;

function readRuntimeStoreMode() {
  return storeConfig.mode;
}

function runtimeStatus(): RuntimeChecksStatus {
  const storeMode = readRuntimeStoreMode();
  const durable = storeMode === 'postgres' && Boolean(storeConfig.databaseUrl);
  return {
    store: {
      mode: storeMode,
      durable,
      databaseUrlConfigured: storeConfig.databaseUrlConfigured,
    },
    auth: {
      provider: process.env.PLOYKIT_AUTH_PROVIDER ?? null,
      secretConfigured: Boolean(
        process.env.PLOYKIT_AUTH_SECRET ?? process.env.PLOYKIT_MEDIA_SECRET
      ),
    },
    productScope: {
      mode: 'runtime-store',
      durable,
    },
    catalog: {
      mode: 'runtime-store',
      durable,
    },
    providers: {
      files: process.env.PLOYKIT_FILE_STORAGE ?? 'local',
      billing: process.env.PLOYKIT_BILLING_PROVIDER ?? 'local',
      email: process.env.PLOYKIT_EMAIL_PROVIDER ?? 'log',
      ai: process.env.PLOYKIT_AI_PROVIDER ?? 'static',
      rag: process.env.PLOYKIT_RAG_PROVIDER ?? 'memory-vector',
      notifications: 'runtime-store',
    },
    worker: {
      mode: 'runtime-store-loop',
      durableQueue: durable,
    },
    security: {
      csrf: 'host-main-path',
      origin: 'host-main-path',
      rateLimit: 'host-main-path',
      routeCatalog: 'configured',
      headers: 'host-main-path',
    },
  };
}

try {
  if (storeConfig.databaseUrl) {
    pool = new Pool({ connectionString: storeConfig.databaseUrl });
  }
  const database = pool ? createPgModuleDataExecutor(pool) : undefined;
  const store = database ? createPostgresRuntimeStore({ database }) : undefined;
  const moduleContracts = await loadModuleRuntimeContracts(MODULE_MAP_ARTIFACT);
  const moduleMapHealth = checkModuleMapHealth({
    artifact: MODULE_MAP_ARTIFACT,
    contracts: moduleContracts,
  });
  const result = await runRuntimeChecks({
    config,
    database,
    store,
    productId: process.env.PLOYKIT_PRODUCT_ID ?? 'default',
    storage: createMemoryModuleFileStorage(),
    moduleMapHealth,
    catalogFresh: true,
    webhookSecretsConfigured: process.env.PLOYKIT_WEBHOOK_SECRETS_CONFIGURED !== 'false',
    billingProviderConfigured: process.env.PLOYKIT_BILLING_PROVIDER_CONFIGURED !== 'false',
    status: runtimeStatus(),
  });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exitCode = result.ok ? 0 : 1;
} finally {
  await pool?.end();
}

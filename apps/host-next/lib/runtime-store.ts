import { createPgModuleDataExecutor, createPgModuleDataPool } from '@/lib/module-runtime/data/pg-executor';
import type { ModuleDataPostgresExecutor } from '@/lib/module-runtime/data/postgres';
import { createInMemoryRuntimeStore } from '@/lib/module-runtime/stores/memory-runtime-store';
import { createPostgresRuntimeStore } from '@/lib/module-runtime/stores/postgres-runtime-store';
import type { RuntimeStore } from '@/lib/module-runtime/stores/runtime-store-types';

export const DEFAULT_LOCAL_DATABASE_URL =
  'postgres://ploykit:ploykit@127.0.0.1:55432/ploykit';

export type HostRuntimeStoreMode = 'memory' | 'postgres';

export interface HostRuntimeStoreConfig {
  mode: HostRuntimeStoreMode;
  databaseUrl: string | null;
  databaseUrlConfigured: boolean;
}

export interface HostRuntimeStoreStatus {
  mode: HostRuntimeStoreMode;
  durable: boolean;
  databaseUrlConfigured: boolean;
  databaseLabel: string;
}

export interface HostRuntimeStoreHandle {
  store: RuntimeStore;
  mode: HostRuntimeStoreMode;
  durable: boolean;
  database?: ModuleDataPostgresExecutor;
  status: HostRuntimeStoreStatus;
}

type HostRuntimeStoreEnv = Partial<
  Record<
    | 'PLOYKIT_RUNTIME_STORE'
    | 'DATABASE_URL'
    | 'POSTGRES_URL'
    | 'NODE_ENV'
    | 'PLOYKIT_ALLOW_MEMORY_RUNTIME_STORE'
    | 'PLOYKIT_ALLOW_DEFAULT_DATABASE_URL',
    string | undefined
  >
>;

function normalizeMode(value: string | undefined): HostRuntimeStoreMode | null {
  if (!value) {
    return null;
  }

  if (value === 'memory' || value === 'postgres') {
    return value;
  }

  throw new Error(`PLOYKIT_RUNTIME_STORE_INVALID: expected memory or postgres, got ${value}`);
}

function redactDatabaseUrl(value: string | null): string {
  if (!value) {
    return 'not configured';
  }

  try {
    const url = new URL(value);
    if (url.password) {
      url.password = '***';
    }
    return url.toString();
  } catch {
    return value.includes('@') ? value.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@') : value;
  }
}

export function resolveHostRuntimeStoreConfig(
  env: HostRuntimeStoreEnv
): HostRuntimeStoreConfig {
  const explicitMode = normalizeMode(env.PLOYKIT_RUNTIME_STORE);
  const configuredDatabaseUrl = env.DATABASE_URL ?? env.POSTGRES_URL ?? null;

  if (explicitMode === 'memory') {
    return {
      mode: 'memory',
      databaseUrl: null,
      databaseUrlConfigured: Boolean(configuredDatabaseUrl),
    };
  }

  if (explicitMode === 'postgres') {
    return {
      mode: 'postgres',
      databaseUrl: configuredDatabaseUrl ?? DEFAULT_LOCAL_DATABASE_URL,
      databaseUrlConfigured: Boolean(configuredDatabaseUrl),
    };
  }

  if (configuredDatabaseUrl) {
    return {
      mode: 'postgres',
      databaseUrl: configuredDatabaseUrl,
      databaseUrlConfigured: true,
    };
  }

  return {
    mode: 'memory',
    databaseUrl: null,
    databaseUrlConfigured: false,
  };
}

let runtimeStorePromise: Promise<HostRuntimeStoreHandle> | null = null;

export function assertHostRuntimeStoreConfig(
  config: HostRuntimeStoreConfig,
  env: HostRuntimeStoreEnv = process.env
): void {
  if (env.NODE_ENV !== 'production') {
    return;
  }

  if (config.mode === 'memory' && env.PLOYKIT_ALLOW_MEMORY_RUNTIME_STORE !== 'true') {
    throw new Error(
      'PLOYKIT_RUNTIME_STORE_PRODUCTION_MEMORY_FORBIDDEN: set DATABASE_URL or PLOYKIT_RUNTIME_STORE=postgres for production.'
    );
  }

  if (
    config.mode === 'postgres' &&
    !config.databaseUrlConfigured &&
    env.PLOYKIT_ALLOW_DEFAULT_DATABASE_URL !== 'true'
  ) {
    throw new Error(
      'PLOYKIT_RUNTIME_STORE_PRODUCTION_DEFAULT_DATABASE_FORBIDDEN: set DATABASE_URL or POSTGRES_URL for production Postgres runtime store.'
    );
  }
}

async function createRuntimeStoreHandle(): Promise<HostRuntimeStoreHandle> {
  const env = {
    PLOYKIT_RUNTIME_STORE: process.env.PLOYKIT_RUNTIME_STORE,
    DATABASE_URL: process.env.DATABASE_URL,
    POSTGRES_URL: process.env.POSTGRES_URL,
    NODE_ENV: process.env.NODE_ENV,
    PLOYKIT_ALLOW_MEMORY_RUNTIME_STORE: process.env.PLOYKIT_ALLOW_MEMORY_RUNTIME_STORE,
    PLOYKIT_ALLOW_DEFAULT_DATABASE_URL: process.env.PLOYKIT_ALLOW_DEFAULT_DATABASE_URL,
  };
  const config = resolveHostRuntimeStoreConfig(env);
  assertHostRuntimeStoreConfig(config, env);

  if (config.mode === 'memory') {
    return {
      store: createInMemoryRuntimeStore(),
      mode: 'memory',
      durable: false,
      status: {
        mode: 'memory',
        durable: false,
        databaseUrlConfigured: config.databaseUrlConfigured,
        databaseLabel: 'memory store',
      },
    };
  }

  const pool = createPgModuleDataPool({
    connectionString: config.databaseUrl ?? DEFAULT_LOCAL_DATABASE_URL,
  });
  const database = createPgModuleDataExecutor(pool);
  const store = createPostgresRuntimeStore({ database });
  await store.ensureSchema?.();

  return {
    store,
    mode: 'postgres',
    durable: true,
    database,
    status: {
      mode: 'postgres',
      durable: true,
      databaseUrlConfigured: config.databaseUrlConfigured,
      databaseLabel: redactDatabaseUrl(config.databaseUrl),
    },
  };
}

export function getHostRuntimeStore(): Promise<HostRuntimeStoreHandle> {
  runtimeStorePromise ??= createRuntimeStoreHandle();
  return runtimeStorePromise;
}

export async function getHostRuntimeStoreStatus(): Promise<HostRuntimeStoreStatus> {
  return (await getHostRuntimeStore()).status;
}

export function resetHostRuntimeStoreForTests(): void {
  runtimeStorePromise = null;
}

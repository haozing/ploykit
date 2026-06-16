import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertHostRuntimeStoreConfig,
  DEFAULT_LOCAL_DATABASE_URL,
  resolveHostRuntimeStoreConfig,
} from '../apps/host-next/lib/runtime-store';

test('M3 host runtime store config defaults to memory without database configuration', () => {
  const config = resolveHostRuntimeStoreConfig({});

  assert.equal(config.mode, 'memory');
  assert.equal(config.databaseUrl, null);
  assert.equal(config.databaseUrlConfigured, false);
});

test('M3 host runtime store config supports explicit local Postgres mode', () => {
  const config = resolveHostRuntimeStoreConfig({
    PLOYKIT_RUNTIME_STORE: 'postgres',
  });

  assert.equal(config.mode, 'postgres');
  assert.equal(config.databaseUrl, DEFAULT_LOCAL_DATABASE_URL);
  assert.equal(config.databaseUrlConfigured, false);
});

test('M3 host runtime store config uses DATABASE_URL as Postgres trigger', () => {
  const config = resolveHostRuntimeStoreConfig({
    DATABASE_URL: 'postgres://user:pass@localhost:5432/app',
  });

  assert.equal(config.mode, 'postgres');
  assert.equal(config.databaseUrl, 'postgres://user:pass@localhost:5432/app');
  assert.equal(config.databaseUrlConfigured, true);
});

test('M3 host runtime store rejects non-durable production fallbacks', () => {
  assert.throws(
    () =>
      assertHostRuntimeStoreConfig(resolveHostRuntimeStoreConfig({}), {
        NODE_ENV: 'production',
      }),
    /PLOYKIT_RUNTIME_STORE_PRODUCTION_MEMORY_FORBIDDEN/
  );
  assert.throws(
    () =>
      assertHostRuntimeStoreConfig(
        resolveHostRuntimeStoreConfig({ PLOYKIT_RUNTIME_STORE: 'postgres' }),
        {
          NODE_ENV: 'production',
        }
      ),
    /PLOYKIT_RUNTIME_STORE_PRODUCTION_DEFAULT_DATABASE_FORBIDDEN/
  );
  assert.doesNotThrow(() =>
    assertHostRuntimeStoreConfig(
      resolveHostRuntimeStoreConfig({
        PLOYKIT_RUNTIME_STORE: 'postgres',
        DATABASE_URL: 'postgres://user:pass@localhost:5432/app',
      }),
      { NODE_ENV: 'production' }
    )
  );
});

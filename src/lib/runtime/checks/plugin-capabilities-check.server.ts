import { eq } from 'drizzle-orm';
import { env } from '@/lib/_core/env';
import { withSystemContext } from '@/lib/db/client.server';
import { pluginConfig, pluginSecrets } from '@/lib/db/schema/plugin-capabilities';
import {
  DbPluginConfigRepository,
  DbPluginSecretsRepository,
  getPluginSecretCryptoStatus,
  PLUGIN_SECRET_ENCODING,
} from '@/lib/plugin-runtime/capabilities';
import type { RuntimeCheck } from '../types';

function hasDatabaseConfiguration(): boolean {
  return Boolean(env.DATABASE_URL || env.NEON_DATABASE_URL || env.POSTGRES_HOST);
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function cleanupProbeData(pluginId: string): Promise<void> {
  await withSystemContext(async (database) => {
    await database.delete(pluginConfig).where(eq(pluginConfig.pluginId, pluginId));
    await database.delete(pluginSecrets).where(eq(pluginSecrets.pluginId, pluginId));
  });
}

export const pluginCapabilitiesCheck: RuntimeCheck = {
  name: 'plugin-capabilities',
  description: 'Validate ctx.config and ctx.secrets persistence runtime',

  async run() {
    if (!hasDatabaseConfiguration() && env.NODE_ENV !== 'production') {
      return {
        key: 'plugin-capabilities',
        status: 'skipped',
        severity: 'warning',
        message: 'Plugin capability validation skipped: no database connection is configured',
        fix: 'Set database connection variables, run migrations, then rerun runtime:check',
      };
    }

    const pluginId = 'runtime-capabilities-check';
    const userId = 'runtime-capabilities-user';
    const scope = { pluginId, userId };
    const config = new DbPluginConfigRepository();
    const secrets = new DbPluginSecretsRepository();

    try {
      await cleanupProbeData(pluginId);

      await config.set(scope, 'probe', { ok: true });
      const configValue = await config.get(scope, 'probe');
      await secrets.set(scope, 'api-key', 'secret-value');
      const secretValue = await secrets.get(scope, 'api-key');
      const storedSecret = await secrets.getStoredValue(scope, 'api-key');
      await config.delete(scope, 'probe');
      await secrets.delete(scope, 'api-key');
      await cleanupProbeData(pluginId);

      if (
        !configValue ||
        typeof configValue !== 'object' ||
        (configValue as Record<string, unknown>).ok !== true ||
        secretValue !== 'secret-value'
      ) {
        return {
          key: 'plugin-capabilities',
          status: 'failed',
          severity: 'error',
          message: 'Plugin config/secrets probe returned unexpected values',
          details: {
            configValue,
            secretFound: Boolean(secretValue),
          },
          fix: 'Check plugin_config/plugin_secrets migrations, encryption key configuration, and repository adapters',
        };
      }

      if (
        !storedSecret ||
        storedSecret.encoding !== PLUGIN_SECRET_ENCODING ||
        storedSecret.valueCiphertext.includes('secret-value')
      ) {
        return {
          key: 'plugin-capabilities',
          status: 'failed',
          severity: 'error',
          message: 'Plugin secret probe was not stored with encrypted secret storage',
          details: {
            secretEncoding: storedSecret?.encoding,
            leakedPlaintext: storedSecret?.valueCiphertext.includes('secret-value') ?? false,
          },
          fix: 'Verify ctx.secrets writes use encrypted storage and never persist plaintext secret values.',
        };
      }

      const secretCrypto = getPluginSecretCryptoStatus();
      return {
        key: 'plugin-capabilities',
        status: 'ok',
        severity: 'info',
        message: 'Plugin capability context verified with encrypted ctx.secrets storage',
        details: {
          tables: ['plugin_config', 'plugin_secrets'],
          config: 'database',
          secrets: 'encrypted',
          secretEncoding: secretCrypto.encoding,
          secretKeySource: secretCrypto.keySource,
          productionReady: secretCrypto.productionReady,
        },
      };
    } catch (error) {
      await cleanupProbeData(pluginId).catch(() => undefined);

      return {
        key: 'plugin-capabilities',
        status: 'failed',
        severity: env.NODE_ENV === 'production' ? 'error' : 'warning',
        message: `Plugin capability validation failed: ${toMessage(error)}`,
        fix: 'Run migrations and verify plugin_config/plugin_secrets RLS policies before enabling capability context',
      };
    }
  },
};

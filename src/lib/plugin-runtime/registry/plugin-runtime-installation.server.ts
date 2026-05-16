import { PluginError } from '@ploykit/plugin-sdk';
import { env } from '@/lib/_core/env';
import { runtimeScopeService } from '@/lib/plugin-runtime/scope';

export interface PluginRuntimeInstallationGateOptions {
  enforce?: boolean;
}

function hasDatabaseConfiguration(): boolean {
  return Boolean(env.DATABASE_URL || env.NEON_DATABASE_URL || env.POSTGRES_HOST);
}

export async function enforcePluginRuntimeEnabled(
  pluginId: string,
  options: PluginRuntimeInstallationGateOptions = {}
): Promise<void> {
  if (options.enforce === false || (options.enforce !== true && !hasDatabaseConfiguration())) {
    return;
  }

  const enabled = await runtimeScopeService.isRuntimePluginEnabled(pluginId);
  if (enabled) {
    return;
  }

  throw new PluginError({
    code: 'PLUGIN_DISABLED',
    message: `Plugin "${pluginId}" is not installed and enabled.`,
    statusCode: 403,
    details: {
      pluginId,
    },
    fix: 'Install and enable the plugin before routing requests through Plugin Runtime.',
  });
}

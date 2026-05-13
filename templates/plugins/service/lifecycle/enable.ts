import type { PluginContext } from '@ploykit/plugin-sdk';

export default async function enable(ctx: PluginContext): Promise<void> {
  const alreadyEnabled = await ctx.config.get<boolean>('lifecycle.enabled');
  if (alreadyEnabled) {
    return;
  }

  await ctx.audit.record('service.enabled', {
    pluginId: ctx.plugin.id,
  });
  await ctx.config.set?.('lifecycle.enabled', true);
}

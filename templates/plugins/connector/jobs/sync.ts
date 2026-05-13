import type { PluginContext } from '@ploykit/plugin-sdk';

export default async function sync(ctx: PluginContext): Promise<void> {
  await ctx.audit.record('connector.sync.completed', {
    pluginId: ctx.plugin.id,
  });
}

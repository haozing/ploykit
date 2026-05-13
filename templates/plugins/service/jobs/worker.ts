import type { PluginContext } from '@ploykit/plugin-sdk';

export default async function worker(ctx: PluginContext): Promise<void> {
  await ctx.events.emit('service.completed', {
    pluginId: ctx.plugin.id,
  });
}

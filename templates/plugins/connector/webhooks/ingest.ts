import type { PluginContext } from '@ploykit/plugin-sdk';

export default async function ingest(ctx: PluginContext): Promise<Response> {
  await ctx.webhooks.verify('hmac-sha256');
  await ctx.events.emit('connector.received', {
    pluginId: ctx.plugin.id,
  });

  return ctx.webhooks.respondAccepted();
}

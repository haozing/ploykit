import type { PluginContext } from '@ploykit/plugin-sdk';

export default async function requested(ctx: PluginContext): Promise<void> {
  await ctx.jobs.enqueue('service.worker');
}

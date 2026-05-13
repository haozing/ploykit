import type { PluginContext } from '@ploykit/plugin-sdk';

export default async function install(ctx: PluginContext): Promise<void> {
  const alreadyInstalled = await ctx.config.get<boolean>('lifecycle.installed');
  if (alreadyInstalled) {
    return;
  }

  await ctx.audit.record('crud.installed', {
    pluginId: ctx.plugin.id,
  });
  await ctx.config.set?.('lifecycle.installed', true);
}

import type { ModuleContext } from '@ploykit/module-sdk';

export default async function install(ctx: ModuleContext) {
  await ctx.audit.record('platform-smoke.installed', {
    moduleId: ctx.module.id,
  });
}

import type { ModuleContext } from '@ploykit/module-sdk';

export default async function install(ctx: ModuleContext) {
  await ctx.audit.record('hello.lifecycle.install', {
    moduleId: ctx.module.id,
  });

  return {
    ok: true,
  };
}

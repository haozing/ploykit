import type { ModuleContext } from '@ploykit/module-sdk';

export default async function readExecutorHealth(_input: unknown, ctx: ModuleContext) {
  return {
    ok: true,
    moduleId: ctx.module.id,
    version: ctx.module.version,
    capability: 'executor',
  };
}

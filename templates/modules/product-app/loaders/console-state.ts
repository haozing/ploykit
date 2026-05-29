import type { ModuleContext } from '@ploykit/module-sdk';

export default async function loadConsoleState(ctx: ModuleContext) {
  return {
    moduleId: ctx.module.id,
    shell: 'dashboard',
    userId: ctx.user?.id ?? null,
  };
}

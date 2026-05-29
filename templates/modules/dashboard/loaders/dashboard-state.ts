import type { ModuleContext } from '@ploykit/module-sdk';

export default async function loadDashboardState(ctx: ModuleContext) {
  return {
    moduleId: ctx.module.id,
    userId: ctx.user?.id ?? null,
  };
}

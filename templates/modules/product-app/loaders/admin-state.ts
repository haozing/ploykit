import type { ModuleContext } from '@ploykit/module-sdk';

export default async function loadAdminState(ctx: ModuleContext) {
  return {
    moduleId: ctx.module.id,
    shell: 'admin',
    adminUserId: ctx.user?.id ?? null,
  };
}

import type { ModuleContext } from '@ploykit/module-sdk';

export default async function loadAdminState(ctx: ModuleContext) {
  return {
    shell: 'admin',
    noteCount: (await ctx.data.table('notes').findMany({ limit: 100 })).length,
    checks: ['module-contract', 'data-v2', 'presentation'],
  };
}

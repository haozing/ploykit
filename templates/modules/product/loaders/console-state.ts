import type { ModuleContext } from '@ploykit/module-sdk';

export default async function loadConsoleState(ctx: ModuleContext) {
  return {
    shell: 'dashboard',
    notes: await ctx.data.table('notes').findMany({ limit: 20 }),
  };
}

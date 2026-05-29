import type { ModuleContext } from '@ploykit/module-sdk';

export default async function loadNotes(ctx: ModuleContext) {
  return {
    notes: await ctx.data.table('notes').findMany({ limit: 20 }),
  };
}

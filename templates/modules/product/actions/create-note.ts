import { action, type ModuleContext } from '@ploykit/module-sdk';

export default action(async (ctx: ModuleContext, input: { title: string; body?: string }) => {
  const note = await ctx.data.table('notes').insert({
    title: input.title,
    body: input.body ?? null,
    status: 'draft',
  });
  return { note };
});

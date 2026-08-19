import { action, type ModuleContext } from '@ploykit/module-sdk';

export default action(async function createNote(
  ctx: ModuleContext,
  input: { title?: string; body?: string } = {}
) {
  const note = await ctx.data.table('workspace_notes').insert({
    title: input.title ?? 'Untitled',
    body: input.body ?? null,
    status: 'draft',
  });
  return {
    ok: true,
    id: note.id,
    title: note.title,
  };
});

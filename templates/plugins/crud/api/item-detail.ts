import { defineApi, z } from '@ploykit/plugin-sdk';

const updateItemSchema = z.object({
  title: z.string().min(1).max(160).optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  metadata: z.record(z.unknown()).optional(),
});

function getItemId(ctx: { request: { url: string } }): string {
  const url = new URL(ctx.request.url);
  return url.searchParams.get('id') ?? 'item-1';
}

export default defineApi({
  async patch(ctx) {
    const id = getItemId(ctx);
    const input = await ctx.request.json(updateItemSchema);
    const item = await ctx.storage.collection('crud_template_items').update(id, input);

    await ctx.events.emit('crud.item.updated', { id });
    await ctx.audit.record('crud.item.updated', { id });

    return ctx.json({ item });
  },

  async delete(ctx) {
    const id = getItemId(ctx);
    await ctx.storage.collection('crud_template_items').delete(id);
    await ctx.audit.record('crud.item.deleted', { id });

    return ctx.json({ id, deleted: true });
  },
});

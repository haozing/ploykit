import { defineApi, z } from '@ploykit/plugin-sdk';

const createItemSchema = z.object({
  title: z.string().min(1).max(160),
  status: z.enum(['draft', 'active', 'archived']).default('draft'),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export default defineApi({
  async get(ctx) {
    const items = await ctx.storage.collection('crud_template_items').findMany({
      orderBy: { title: 'asc' },
      limit: 50,
    });

    return ctx.json({ items });
  },

  async post(ctx) {
    const input = await ctx.request.json(createItemSchema);
    const item = await ctx.storage.collection('crud_template_items').insert(input);

    await ctx.events.emit('crud.item.created', { id: item.id });
    await ctx.audit.record('crud.item.created', { id: item.id });
    await ctx.usage.increment('crud_template.items.created');
    await ctx.ui.toast.success('Item created');

    return ctx.json({ item }, { status: 201 });
  },
});

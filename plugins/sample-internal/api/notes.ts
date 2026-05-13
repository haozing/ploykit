import { defineApi, z } from '@ploykit/plugin-sdk';

const createNoteSchema = z.object({
  title: z.string().min(1).max(120),
  status: z.enum(['open', 'done']).default('open'),
  body: z.string().optional(),
});

export default defineApi({
  async get(ctx) {
    const notes = await ctx.storage.collection('sample_internal_notes').findMany({
      orderBy: { title: 'asc' },
      limit: 25,
    });

    return ctx.json({ notes });
  },

  async post(ctx) {
    const input = await ctx.request.json(createNoteSchema);
    const note = await ctx.storage.collection('sample_internal_notes').insert(input);

    await ctx.ui.toast.success('Note created');

    return ctx.json({ note }, { status: 201 });
  },
});

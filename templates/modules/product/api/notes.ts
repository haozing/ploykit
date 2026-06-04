import { defineApi } from '@ploykit/module-sdk';

export default defineApi({
  async get(ctx) {
    return ctx.json({
      notes: await ctx.data.table('notes').findMany({ limit: 50 }),
    });
  },
  async post(ctx) {
    const input = await ctx.request.json<{ title: string; body?: string }>();
    const note = await ctx.data.table('notes').insert({
      title: input.title,
      body: input.body ?? null,
      status: 'draft',
    });
    return ctx.json({ note }, { status: 201 });
  },
});

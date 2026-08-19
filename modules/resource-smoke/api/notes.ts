import { defineApi } from '@ploykit/module-sdk';

export default defineApi({
  async get(ctx) {
    const count = await ctx.data.table('workspace_notes').count();
    return ctx.json({ ok: true, id: 'count', title: String(count) });
  },
  async post(ctx) {
    const body = await ctx.request.json<{ title?: string; body?: string }>();
    const note = await ctx.data.table('workspace_notes').insert({
      title: body.title ?? 'Untitled',
      body: body.body ?? null,
      status: 'draft',
    });
    return ctx.json({ ok: true, id: note.id, title: note.title });
  },
});

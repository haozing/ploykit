import { defineApi } from '@ploykit/module-sdk';

export default defineApi({
  async get(ctx) {
    const orders = await ctx.data.table('orders').findMany({
      where: ctx.user?.id ? { user_id: ctx.user.id } : undefined,
      orderBy: { updated_at: 'desc' },
      limit: 50,
    });
    return ctx.json({ ok: true, orders });
  },
});

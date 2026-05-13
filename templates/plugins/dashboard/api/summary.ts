import { defineApi } from '@ploykit/plugin-sdk';

export default defineApi({
  async get(ctx) {
    const metrics = await ctx.storage.collection('dashboard_template_metrics').findMany({
      orderBy: { captured_at: 'desc' },
      limit: 20,
    });
    const total = metrics.reduce((sum, metric) => sum + Number(metric.value ?? 0), 0);

    return ctx.json({ metrics, total });
  },
});

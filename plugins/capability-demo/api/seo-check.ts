import { defineApi, z } from '@ploykit/plugin-sdk';

const seoCheckSchema = z.object({
  url: z.literal('https://example.com/').default('https://example.com/'),
});

export default defineApi({
  async post(ctx) {
    const input = await ctx.request.json(seoCheckSchema);
    const response = await ctx.http.fetch('https://example.com/', { method: 'GET' });
    await ctx.audit.record('capability-demo.seo-check.request', {
      url: input.url,
      status: response.status,
    });

    return ctx.json({
      ok: response.ok,
      status: response.status,
      url: input.url,
      checkedAt: new Date().toISOString(),
    });
  },
});

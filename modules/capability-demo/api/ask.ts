import { defineApi } from '@ploykit/module-sdk';

export default defineApi({
  async post(ctx) {
    const input = await ctx.request.json<{ question?: string }>();
    const result = await ctx.ai.generateText({
      prompt: input.question ?? 'Summarize the indexed demo content.',
    });
    await ctx.usage.record({ meter: 'capability_demo.ask' });
    return ctx.json({ ok: true, result });
  },
});

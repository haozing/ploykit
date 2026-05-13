import { defineApi, z } from '@ploykit/plugin-sdk';

const runToolSchema = z.object({
  input: z.string().min(1),
});

export default defineApi({
  async post(ctx) {
    const input = await ctx.request.json(runToolSchema);
    const result = input.input.trim();

    await ctx.audit.record('tool.run', { length: result.length });
    await ctx.usage.increment('tool_template.runs');
    await ctx.ui.toast.info('Tool run completed');

    return ctx.json({ result });
  },
});

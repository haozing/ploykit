import { defineApi } from '@ploykit/module-sdk';
import { runAiRagDemo } from '../lib/run-ai-rag';

export default defineApi({
  async post(ctx) {
    const input = await ctx.request.json<{ question?: string; source?: string }>();
    return ctx.json(await runAiRagDemo(ctx, input));
  },
});

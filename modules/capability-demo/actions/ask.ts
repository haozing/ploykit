import { action, type ModuleContext } from '@ploykit/module-sdk';

export default action(async function ask(ctx: ModuleContext, input: { question?: string } = {}) {
  const pack = await ctx.rag.contextPack({ query: input.question ?? 'demo', limit: 3 });
  return ctx.ai.generateText({
    prompt: `${pack.context}\n\nQuestion: ${input.question ?? 'What is in this demo?'}`,
  });
});

import type { ModuleContext } from '@ploykit/module-sdk';

export default async function reindex(ctx: ModuleContext, input: { content?: string } = {}) {
  const document = await ctx.rag.index({
    content: input.content ?? 'Capability demo content for local modules.',
    metadata: { source: 'job' },
  });
  await ctx.audit.record('capability-demo.indexed', { documentId: document.id });
  return { ok: true, documentId: document.id };
}

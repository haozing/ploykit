import type { ModuleContext } from '@ploykit/module-sdk';

export async function runAiRagDemo(
  ctx: ModuleContext,
  input: { question?: string; source?: string } = {}
) {
  const source =
    input.source ??
    'PloyKit modules can combine AI, RAG, files, billing guards and host operations.';
  const question = input.question ?? 'Summarize the indexed PloyKit capability.';
  const file = await ctx.files.createUpload({
    name: 'ai-rag-source.txt',
    purpose: 'source',
    contentType: 'text/plain',
  });
  const readyFile = await ctx.files.completeUpload(file.file.id, { content: source });
  const document = await ctx.rag.index({
    content: source,
    metadata: { fileId: readyFile.id, source: 'ai-rag-demo' },
  });
  const pack = await ctx.rag.contextPack({ query: question, limit: 3 });
  const result = await ctx.ai.generateText({
    prompt: `${pack.context}\n\nQuestion: ${question}`,
    metadata: { documentId: document.id, fileId: readyFile.id },
  });
  const subject = ctx.user
    ? ({ type: 'user' as const, id: ctx.user.id })
    : ({ type: 'workspace' as const, id: ctx.workspace.id ?? 'default' });
  await ctx.metering.charge({
    subject,
    meter: 'ai_rag_demo.ask',
    quantity: result.usage.inputTokens + result.usage.outputTokens,
    unit: 'token',
    idempotencyKey: `ai-rag-demo:${document.id}:${readyFile.id}`,
    metadata: { documentId: document.id, fileId: readyFile.id, model: result.model },
  });

  return {
    ok: true,
    answer: result.text,
    model: result.model,
    documentId: document.id,
    fileId: readyFile.id,
    documents: pack.documents.length,
  };
}

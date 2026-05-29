import type { ModuleContext } from '@ploykit/module-sdk';

export default async function sync(ctx: ModuleContext, _input: unknown, run: { id: string }) {
  const result = await ctx.connectors.invoke('default', 'sync', {});
  const upload = await ctx.files.createUpload({
    name: 'sync-result.json',
    purpose: 'result',
    contentType: 'application/json',
    runId: run.id,
  });
  await ctx.files.completeUpload(upload.file.id, {
    content: JSON.stringify(result),
  });
  return { fileId: upload.file.id };
}

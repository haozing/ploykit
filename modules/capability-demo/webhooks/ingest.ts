import type { ModuleContext } from '@ploykit/module-sdk';

export default async function ingest(
  ctx: ModuleContext,
  event: { json<T = unknown>(): Promise<T>; receipt: { id: string } }
) {
  const payload = await event.json<{ content?: string }>();
  const file = await ctx.files.createUpload({
    name: `webhook-${event.receipt.id}.txt`,
    purpose: 'source',
    contentType: 'text/plain',
  });
  await ctx.files.completeUpload(file.file.id, {
    content: payload.content ?? 'Webhook content',
  });
  return ctx.json({ ok: true, fileId: file.file.id });
}

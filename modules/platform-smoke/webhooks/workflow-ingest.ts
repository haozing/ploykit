import type { ModuleContext } from '@ploykit/module-sdk';

export default async function workflowIngest(
  ctx: ModuleContext,
  event: { json<T = unknown>(): Promise<T>; receipt: { id: string } }
) {
  const payload = await event.json<{ source?: string }>();
  await ctx.audit.record('platform-smoke.webhook.received', {
    receiptId: event.receipt.id,
    source: payload.source ?? 'unknown',
  });
  return ctx.json({ ok: true, receiptId: event.receipt.id });
}

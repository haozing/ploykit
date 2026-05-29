import type { ModuleContext } from '@ploykit/module-sdk';

export default async function workflowIngest(
  ctx: ModuleContext,
  event: { json<T = unknown>(): Promise<T>; receipt: { id: string } }
) {
  const payload = await event.json<{ source?: string }>();
  await ctx.audit.record('capability-demo.webhook.received', {
    receiptId: event.receipt.id,
    source: payload.source ?? 'unknown',
  });
  await ctx.usage.record({ meter: 'capability.workflow.webhook.received' });
  return ctx.json({ ok: true, receiptId: event.receipt.id });
}

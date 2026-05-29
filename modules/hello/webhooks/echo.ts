import type { ModuleContext } from '@ploykit/module-sdk';

export default async function echoWebhook(
  ctx: ModuleContext,
  event: { json<T = unknown>(): Promise<T>; receipt: { id: string } }
) {
  const payload = await event.json();
  return ctx.json({
    ok: true,
    moduleId: ctx.module.id,
    receiptId: event.receipt.id,
    payload,
  });
}

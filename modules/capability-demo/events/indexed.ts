import type { ModuleContext } from '@ploykit/module-sdk';

export default async function indexed(
  ctx: ModuleContext,
  event: { payload: { documentId: string } }
) {
  if (ctx.user) {
    await ctx.notifications.send({
      userId: ctx.user.id,
      title: 'Demo index updated',
      body: event.payload.documentId,
    });
  }
}

import type { ModuleContext } from '@ploykit/module-sdk';

export default async function onHelloGreeted(
  ctx: ModuleContext,
  event: { id: string; payload: { name?: string } }
) {
  await ctx.audit.record('hello.event.received', {
    eventId: event.id,
    name: event.payload.name ?? 'PloyKit',
  });

  return {
    ok: true,
  };
}

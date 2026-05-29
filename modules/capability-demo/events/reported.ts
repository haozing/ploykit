import type { ModuleContext } from '@ploykit/module-sdk';

export default async function reported(
  ctx: ModuleContext,
  event: { id: string; payload: { artifactId?: string } }
) {
  await ctx.audit.record('capability-demo.reported', {
    eventId: event.id,
    artifactId: event.payload.artifactId,
  });

  return { ok: true };
}

import type { PluginContext } from '@ploykit/plugin-sdk';

export default async function selftest(
  ctx: PluginContext,
  payload: unknown,
  metadata: { event: string; eventId: string; correlationId: string }
): Promise<void> {
  await ctx.audit.record('capability-demo.selftest.event', {
    payload,
    event: metadata.event,
    eventId: metadata.eventId,
    correlationId: metadata.correlationId,
  });
}

import type { ModuleContext } from '@ploykit/module-sdk';

export default async function reported(ctx: ModuleContext, event: { payload?: unknown }) {
  await ctx.audit.record('platform-smoke.event.received', {
    payload: event.payload ?? null,
  });
}

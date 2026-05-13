import type { PluginContext } from '@ploykit/plugin-sdk';

export default async function selftest(ctx: PluginContext, payload?: unknown): Promise<void> {
  await ctx.audit.record('capability-demo.selftest.job', {
    payload,
    source: 'capability-demo.jobs.selftest',
  });
}

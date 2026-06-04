import { action, type ModuleContext } from '@ploykit/module-sdk';

export default action(async (ctx: ModuleContext) => {
  const job = await ctx.jobs.run('generateReport', {
    requestedAt: new Date().toISOString(),
  });
  return { job };
});

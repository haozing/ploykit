import { action, type ModuleContext } from '@ploykit/module-sdk';

export default action(async function runPaidTool(ctx: ModuleContext) {
  await ctx.usage.record({ meter: 'paid_tool.run' });
  return { ok: true };
});

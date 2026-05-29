import { action, type ModuleContext } from '@ploykit/module-sdk';

export default action(async (ctx: ModuleContext) => ({
  result: await ctx.connectors.invoke('default', 'ping', {}),
}));

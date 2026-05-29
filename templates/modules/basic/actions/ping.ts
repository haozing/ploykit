import { action, type ModuleContext } from '@ploykit/module-sdk';

export default action(async (ctx: ModuleContext) => ({
  ok: true,
  moduleId: ctx.module.id,
}));

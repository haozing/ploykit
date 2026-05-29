import { action, type ModuleContext } from '@ploykit/module-sdk';

export default action(async function ping(ctx: ModuleContext) {
  return {
    ok: true,
    moduleId: ctx.module.id,
  };
});

import { action, type ModuleContext } from '@ploykit/module-sdk';

export default action(async function ping(ctx: ModuleContext) {
  return {
    ok: true,
    module_id: ctx.module.id,
    message: 'platform smoke action ready',
  };
});

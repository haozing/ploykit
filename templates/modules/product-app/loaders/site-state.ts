import type { ModuleContext } from '@ploykit/module-sdk';

export default async function loadSiteState(ctx: ModuleContext) {
  return {
    moduleId: ctx.module.id,
    shell: 'site',
  };
}

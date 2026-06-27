import { defineApi } from '@ploykit/module-sdk';

export default defineApi({
  get(ctx) {
    return ctx.json({
      ok: true,
      module_id: ctx.module.id,
      message: 'platform smoke api ready',
    });
  },
});

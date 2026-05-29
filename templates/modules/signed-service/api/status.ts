import { defineApi } from '@ploykit/module-sdk';

export default defineApi({
  get(ctx) {
    return ctx.json({
      ok: true,
      service: 'signedAdmin',
      operation: 'admin.request',
    });
  },
});

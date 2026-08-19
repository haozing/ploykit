import { defineApi } from '@ploykit/module-sdk';

export default defineApi({
  post(ctx) {
    return ctx.json({ ok: true });
  },
});

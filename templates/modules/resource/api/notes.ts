import { defineApi } from '@ploykit/module-sdk';

export default defineApi({
  get(ctx) {
    return ctx.json({ notes: [] });
  },
  post(ctx) {
    return ctx.json({ ok: true });
  },
});

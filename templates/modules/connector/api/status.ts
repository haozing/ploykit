import { defineApi } from '@ploykit/module-sdk';

export default defineApi({
  async get(ctx) {
    return ctx.json({
      connection: await ctx.connectors.get('default'),
    });
  },
});

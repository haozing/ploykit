import { defineApi } from '@ploykit/plugin-sdk';

export default defineApi({
  async get(ctx) {
    await ctx.usage.increment('service_template.health.checked');
    return ctx.json({ ok: true, pluginId: ctx.plugin.id });
  },
});

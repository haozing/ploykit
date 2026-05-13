import { defineApi, z } from '@ploykit/plugin-sdk';

const settingsSchema = z.object({
  endpoint: z.string().url().optional(),
  apiKey: z.string().min(1).optional(),
});

export default defineApi({
  async get(ctx) {
    const endpoint = await ctx.config.get<string>('endpoint');
    const apiKey = await ctx.secrets.get('apiKey');

    return ctx.json({
      endpoint,
      hasApiKey: Boolean(apiKey),
    });
  },

  async post(ctx) {
    const input = await ctx.request.json(settingsSchema);

    if (input.endpoint) {
      await ctx.config.set?.('endpoint', input.endpoint);
    }

    if (input.apiKey) {
      await ctx.secrets.set?.('apiKey', input.apiKey);
    }

    await ctx.audit.record('connector.settings.updated', {
      endpointChanged: Boolean(input.endpoint),
      apiKeyChanged: Boolean(input.apiKey),
    });

    return ctx.json({ saved: true });
  },
});

import { defineApi, z } from '@ploykit/plugin-sdk';

export const dynamic = 'force-dynamic';

const echoSchema = z
  .object({
    requestedScope: z
      .object({
        type: z.enum(['user', 'workspace']),
        id: z.string().min(1),
      })
      .optional(),
  })
  .partial()
  .default({});

export default defineApi({
  async post(ctx) {
    const input = await ctx.request.json(echoSchema);
    await ctx.rateLimit.check({
      bucket: 'capability-demo.api-key-echo.{apiKeyId}.{route}',
      limit: 60,
      window: '1m',
    });

    const committed = await ctx.metering.commit({
      meter: 'capability-demo.selftest.request',
      amount: 1,
      scope: input.requestedScope ?? ctx.auth?.apiKey?.scope,
      apiKeyId: ctx.auth?.apiKey?.id,
      metadata: {
        route: '/api-key-echo',
        permissionProbe: true,
      },
    });

    return ctx.json({
      ok: true,
      userId: ctx.user?.id,
      apiKey: ctx.auth?.apiKey ?? null,
      metering: {
        meter: committed.meter,
        usageId: committed.usageId,
        apiKeyId: ctx.auth?.apiKey?.id,
      },
    });
  },
});

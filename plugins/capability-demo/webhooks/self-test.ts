import type { PluginContext } from '@ploykit/plugin-sdk';

export default async function selfTestWebhook(ctx: PluginContext): Promise<Response> {
  const verification = await ctx.webhooks.verify('none');
  await ctx.audit.record('capability-demo.selftest.webhook', {
    verification,
    method: ctx.request.method,
  });

  return ctx.webhooks.respondAccepted();
}

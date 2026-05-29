import { action, type ModuleContext } from '@ploykit/module-sdk';

export default action(async (ctx: ModuleContext) => {
  const response = await ctx.services.invoke('signedAdmin', 'admin.request', {
    path: '/v1/runs',
    method: 'POST',
    headers: {
      'idempotency-key': ctx.request.id,
    },
    json: {
      workflowId: 'demo',
    },
  });

  await ctx.audit.record('__MODULE_ID__.service.requested', {
    service: 'signedAdmin',
    operation: 'admin.request',
  });

  return response;
});

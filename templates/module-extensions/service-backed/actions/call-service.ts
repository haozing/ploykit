import { action, type ModuleContext } from '@ploykit/module-sdk';
import { invokeServiceCore } from '../lib/service-client';

export default action(async (ctx: ModuleContext) => {
  const response = await invokeServiceCore(ctx, {
    path: '/v1/status',
    method: 'GET',
    headers: {
      'idempotency-key': ctx.request.id,
    },
  });

  await ctx.audit.record('__MODULE_ID__.service.requested', {
    service: 'serviceCore',
    operation: 'request',
    ok: response.ok,
    status: response.status,
  });

  return response;
});

import { defineApi } from '@ploykit/module-sdk';
import { invokeServiceCore } from '../lib/service-client';

export default defineApi({
  async get(ctx) {
    const response = await invokeServiceCore(ctx, {
      path: '/v1/status',
      method: 'GET',
    });
    return ctx.json({
      ok: response.ok,
      service: 'serviceCore',
      status: response.status,
      upstream: response.json ?? null,
    });
  },
});

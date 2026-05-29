import { defineApi } from '@ploykit/module-sdk';

export default defineApi({
  get(ctx) {
    return ctx.json({
      ok: true,
      moduleId: ctx.module.id,
      job: 'generate_report',
      webhook: '/api/module-webhooks/capability-demo/workflow/webhook',
      taskCenter: '/zh/dashboard/tasks',
    });
  },
});

import { action, type ModuleContext } from '@ploykit/module-sdk';

export default action(async function enqueueReport(
  ctx: ModuleContext,
  input: { title?: string } = {}
) {
  await ctx.usage.record({ meter: 'capability.workflow.enqueue_requested' });
  return {
    ok: true,
    queued: 'generate_report',
    title: input.title ?? 'Workflow report',
    enqueueApi:
      '/api/worker/enqueue?drain=1 with body {"moduleId":"capability-demo","name":"generate_report"}',
  };
});

export default function JobPage() {
  return {
    title: 'Capability Workflow',
    message:
      'This Capability module page declares a worker job, an event handler and an inbound webhook receipt path.',
    module: 'capability-demo',
    action: 'enqueueReport',
    webhook: '/api/module-webhooks/capability-demo/workflow/webhook',
    taskCenter: '/zh/dashboard/tasks',
  };
}

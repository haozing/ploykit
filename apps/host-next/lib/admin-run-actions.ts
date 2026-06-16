import { createAdminAction } from './admin-action';
import { cancelAdminRun, requeueAdminRun } from './admin-runs';

function readRequiredFormString(formData: FormData, name: string): string {
  const value = formData.get(name);
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`ADMIN_FORM_FIELD_REQUIRED: ${name}`);
  }
  return value;
}

export const requeueAdminRunAction = createAdminAction({
  id: 'runs.requeue',
  parse: (formData) => ({ runId: readRequiredFormString(formData, 'runId') }),
  run: async ({ session, input }) => requeueAdminRun(session, input.runId),
  revalidate: ({ input }) => ['/admin/runs', `/admin/runs/${input.runId}`, '/admin'],
  audit: { metadata: ({ input }) => ({ runId: input.runId }) },
});

export const cancelAdminRunAction = createAdminAction({
  id: 'runs.cancel',
  parse: (formData) => ({
    runId: readRequiredFormString(formData, 'runId'),
    reason: formData.get('reason')?.toString() || 'Canceled from Admin Runs',
  }),
  run: async ({ session, input }) => cancelAdminRun(session, input.runId, input.reason),
  revalidate: ({ input }) => ['/admin/runs', `/admin/runs/${input.runId}`, '/admin'],
  audit: { metadata: ({ input }) => ({ runId: input.runId, reason: input.reason }) },
});

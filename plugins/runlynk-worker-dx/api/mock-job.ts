import { defineApi } from '@ploykit/plugin-sdk';
import { createJob, createWorkerToken, getWorkerContract } from '../lib/core-client';
import { currentWorkspaceScope } from '../lib/workspace-project';

export default defineApi({
  async post(ctx) {
    const { projectId, taskTypeId } = ctx.request.params;
    const scope = await currentWorkspaceScope(ctx);
    const contract = await getWorkerContract(ctx, projectId, taskTypeId, scope);
    const token = await createWorkerToken(
      ctx,
      projectId,
      {
        name: `validator-${contract.task_key}`,
        allowed_task_keys: [contract.task_key],
        allowed_tags: contract.required_worker_tags,
        max_concurrent_jobs: 1,
      },
      scope
    );
    const job = await createJob(
      ctx,
      projectId,
      {
        task_key: contract.task_key,
        input: contract.mock_input,
      },
      scope
    );

    await ctx.audit.record('runlynk-worker-dx.validator.mock-job.create', {
      project_id: projectId,
      task_type_id: taskTypeId,
      task_key: contract.task_key,
      job_id: job.id,
      token_id: token.id,
    });
    await ctx.usage.increment('runlynk-worker-dx.validator.mock-job.create');

    return ctx.json(
      {
        job,
        worker_token: token.token,
        worker_token_id: token.id,
        contract,
      },
      { status: 201 }
    );
  },
});

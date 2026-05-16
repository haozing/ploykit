import { defineApi, z } from '@ploykit/plugin-sdk';
import { getValidatorStatus, getWorkerContract } from '../lib/core-client';
import { generateFixPrompt } from '../lib/generators';
import { currentWorkspaceScope } from '../lib/workspace-project';

const schema = z.object({
  task_type_id: z.string().min(1),
});

export default defineApi({
  async post(ctx) {
    const { projectId, jobId } = ctx.request.params;
    const input = await ctx.request.json(schema);
    const scope = await currentWorkspaceScope(ctx);
    const [contract, status] = await Promise.all([
      getWorkerContract(ctx, projectId, input.task_type_id, scope),
      getValidatorStatus(ctx, projectId, jobId, scope),
    ]);
    const prompt = generateFixPrompt(contract, status);
    await ctx.audit.record('runlynk-worker-dx.fix-prompt.generate', {
      project_id: projectId,
      task_type_id: input.task_type_id,
      job_id: jobId,
    });
    await ctx.usage.increment('runlynk-worker-dx.fix-prompt.generate');
    return ctx.json({ prompt });
  },
});

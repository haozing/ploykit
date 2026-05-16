import { defineApi } from '@ploykit/plugin-sdk';
import { getWorkerContract } from '../lib/core-client';
import { generateWorkerPrompt } from '../lib/generators';
import { currentWorkspaceScope } from '../lib/workspace-project';

export default defineApi({
  async post(ctx) {
    const { projectId, taskTypeId } = ctx.request.params;
    const contract = await getWorkerContract(
      ctx,
      projectId,
      taskTypeId,
      await currentWorkspaceScope(ctx)
    );
    const prompt = generateWorkerPrompt(contract);
    await ctx.audit.record('runlynk-worker-dx.prompt.generate', {
      project_id: projectId,
      task_type_id: taskTypeId,
      task_key: contract.task_key,
    });
    await ctx.usage.increment('runlynk-worker-dx.prompt.generate');
    return ctx.json({ prompt });
  },
});

import { defineApi, z } from '@ploykit/plugin-sdk';
import { getWorkerContract } from '../lib/core-client';
import { generateStarter } from '../lib/generators';
import { currentWorkspaceScope } from '../lib/workspace-project';

const schema = z.object({
  language: z.enum(['python', 'typescript', 'http']).default('python'),
});

export default defineApi({
  async post(ctx) {
    const { projectId, taskTypeId } = ctx.request.params;
    const input = await ctx.request.json(schema);
    const contract = await getWorkerContract(
      ctx,
      projectId,
      taskTypeId,
      await currentWorkspaceScope(ctx)
    );
    const starter = generateStarter(contract, input.language);
    await ctx.audit.record('runlynk-worker-dx.starter.generate', {
      project_id: projectId,
      task_type_id: taskTypeId,
      task_key: contract.task_key,
      language: input.language,
    });
    await ctx.usage.increment('runlynk-worker-dx.starter.generate');
    return ctx.json({ language: input.language, starter });
  },
});

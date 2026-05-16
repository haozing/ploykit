import { defineApi } from '@ploykit/plugin-sdk';
import { getWorkerContract } from '../lib/core-client';
import { currentWorkspaceScope } from '../lib/workspace-project';

export default defineApi({
  async get(ctx) {
    const { projectId, taskTypeId } = ctx.request.params;
    const contract = await getWorkerContract(
      ctx,
      projectId,
      taskTypeId,
      await currentWorkspaceScope(ctx)
    );
    await ctx.usage.increment('runlynk-worker-dx.contract.read');
    return ctx.json(contract);
  },
});

import { defineApi } from '@ploykit/plugin-sdk';
import { getValidatorStatus } from '../lib/core-client';
import { currentWorkspaceScope } from '../lib/workspace-project';

export default defineApi({
  async get(ctx) {
    const { projectId, jobId } = ctx.request.params;
    const status = await getValidatorStatus(
      ctx,
      projectId,
      jobId,
      await currentWorkspaceScope(ctx)
    );
    await ctx.usage.increment('runlynk-worker-dx.validator.read');
    return ctx.json(status);
  },
});

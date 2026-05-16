import { defineApi } from '@ploykit/plugin-sdk';
import { listTaskTypes } from '../lib/core-client';
import { currentWorkspaceScope } from '../lib/workspace-project';

export default defineApi({
  async get(ctx) {
    const projectId = ctx.request.params.projectId;
    const result = await listTaskTypes(ctx, projectId, await currentWorkspaceScope(ctx));
    await ctx.usage.increment('runlynk-producer-dx.task-types.list');
    return ctx.json(result);
  },
});

import { defineApi } from '@ploykit/plugin-sdk';
import { getProject } from '../lib/core-client';
import { ensureBoundProject } from '../lib/workspace-project';

export default defineApi({
  async get(ctx) {
    const binding = await ensureBoundProject(ctx);
    const project = await getProject(ctx, binding.projectId, binding.scope);
    await ctx.usage.increment('runlynk-worker-dx.projects.read');
    return ctx.json({ projects: [project] });
  },
});

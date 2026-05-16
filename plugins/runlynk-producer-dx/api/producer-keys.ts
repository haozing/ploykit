import { defineApi, z } from '@ploykit/plugin-sdk';
import { createProducerKey, listProducerKeys } from '../lib/core-client';
import { currentWorkspaceScope } from '../lib/workspace-project';

const createSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  rate_limit_per_minute: z.number().int().positive().max(100000).optional(),
});

const producerScopes = ['jobs:create', 'jobs:read', 'jobs:cancel', 'callbacks:read'] as const;

export default defineApi({
  async get(ctx) {
    const projectId = ctx.request.params.projectId;
    const result = await listProducerKeys(ctx, projectId, await currentWorkspaceScope(ctx));
    await ctx.usage.increment('runlynk-producer-dx.producer-keys.list');
    return ctx.json(result);
  },

  async post(ctx) {
    const projectId = ctx.request.params.projectId;
    const input = await ctx.request.json(createSchema);
    const key = await createProducerKey(
      ctx,
      projectId,
      {
        name: input.name ?? 'Producer DX Key',
        scopes: [...producerScopes],
        rate_limit_per_minute: input.rate_limit_per_minute ?? 60,
      },
      await currentWorkspaceScope(ctx)
    );
    await ctx.audit.record('runlynk-producer-dx.producer-key.create', {
      project_id: projectId,
      producer_key_id: key.id,
      scopes: key.scopes,
    });
    await ctx.usage.increment('runlynk-producer-dx.producer-key.create');
    return ctx.json({ producer_key: key }, { status: 201 });
  },
});

import { defineApi, z } from '@ploykit/plugin-sdk';
import { getWorkerContract, type RunLynkProducerKey } from '../lib/core-client';
import { generateProducerPrompt, generateProducerSnippet } from '../lib/generators';
import { currentWorkspaceScope } from '../lib/workspace-project';

const inputSchema = z.object({
  language: z.enum(['typescript', 'python', 'curl']).default('typescript'),
  base_url: z.string().url().optional(),
  producer_key: z
    .object({
      id: z.string(),
      project_id: z.string(),
      name: z.string(),
      key: z.string().optional(),
      scopes: z.array(z.string()).optional(),
      rate_limit_per_minute: z.number().optional(),
      status: z.string(),
    })
    .optional(),
});

export default defineApi({
  async post(ctx) {
    const { projectId, taskTypeId } = ctx.request.params;
    const input = await ctx.request.json(inputSchema);
    const contract = await getWorkerContract(
      ctx,
      projectId,
      taskTypeId,
      await currentWorkspaceScope(ctx)
    );
    const generatorInput = {
      projectId,
      baseUrl: input.base_url,
      contract,
      producerKey: input.producer_key as RunLynkProducerKey | undefined,
      language: input.language,
    };

    const snippet = generateProducerSnippet(generatorInput);
    const prompt = generateProducerPrompt(generatorInput);
    await ctx.audit.record('runlynk-producer-dx.integration.generate', {
      project_id: projectId,
      task_type_id: taskTypeId,
      task_key: contract.task_key,
      language: input.language,
    });
    await ctx.usage.increment('runlynk-producer-dx.integration.generate');
    return ctx.json({ contract, snippet, prompt });
  },
});

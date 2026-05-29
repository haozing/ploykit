import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createInMemoryRuntimeStore,
} from '../src/lib/module-runtime';
import {
  createModuleAiProviderRegistry,
  createProviderModuleAiRuntime,
  createRuntimeStoreCommercialRuntime,
  type ModuleAiProvider,
} from '../src/lib/module-capabilities';
import {
  createWebhookModuleAiProvider,
  createHostModuleAiApi,
  getHostAiProviderStatus,
  resolveHostAiProviderConfig,
} from '../apps/host-next/lib/ai-provider';

const provider: ModuleAiProvider = {
  id: 'test',
  async generateText(input) {
    if (input.prompt === 'fail') {
      throw new Error('provider failed');
    }
    return {
      text: `ok:${input.prompt}`,
      model: input.model,
      usage: { inputTokens: 2, outputTokens: 3 },
    };
  },
  async embedText(input) {
    return {
      embedding: [input.text.length, 1, 0],
      model: input.model,
      usage: { inputTokens: 1 },
    };
  },
};

test('P19 provider AI runtime rejects missing credits and commits successful cost', async () => {
  const store = createInMemoryRuntimeStore();
  const commercial = createRuntimeStoreCommercialRuntime({
    store,
    productId: 'product-a',
    workspaceId: 'workspace-a',
  });
  const registry = createModuleAiProviderRegistry({
    providers: [provider],
    policy: {
      text: { providerId: 'test', model: 'text-small' },
      embedding: { providerId: 'test', model: 'embed-small' },
    },
  });
  const ai = createProviderModuleAiRuntime({
    registry,
    usage: (moduleId) => commercial.forModule(moduleId).usage,
    metering: (moduleId) => commercial.forModule(moduleId).metering,
    credits: (moduleId) => commercial.forModule(moduleId).credits,
    userId: 'user-1',
  });
  const moduleAi = ai.forModule('ai-test');

  await assert.rejects(() => moduleAi.generateText({ prompt: 'hello', idempotencyKey: 'ai-1' }));
  await commercial.admin.grantCredits({
    session: { user: { id: 'admin-1', role: 'admin' } },
    userId: 'user-1',
    amount: 2,
  });
  const result = await moduleAi.generateText({ prompt: 'hello', idempotencyKey: 'ai-2' });

  assert.equal(result.text, 'ok:hello');
  assert.equal((await commercial.forModule('ai-test').credits.balance('user-1')).balance, 1);
  assert.equal((await store.listMetering({ status: 'committed' })).length, 1);
  assert.equal((await store.listUsage({ meter: 'ai.generateText' })).length, 1);
});

test('P19 provider failure releases reserved credits without committed metering', async () => {
  const store = createInMemoryRuntimeStore();
  const commercial = createRuntimeStoreCommercialRuntime({
    store,
    productId: 'product-a',
    workspaceId: 'workspace-a',
  });
  await commercial.admin.grantCredits({
    session: { user: { id: 'admin-1', role: 'admin' } },
    userId: 'user-1',
    amount: 1,
  });
  const ai = createProviderModuleAiRuntime({
    registry: createModuleAiProviderRegistry({
      providers: [provider],
      policy: {
        text: { providerId: 'test', model: 'text-small' },
        embedding: { providerId: 'test', model: 'embed-small' },
      },
    }),
    metering: (moduleId) => commercial.forModule(moduleId).metering,
    credits: (moduleId) => commercial.forModule(moduleId).credits,
    userId: 'user-1',
  });

  await assert.rejects(() => ai.forModule('ai-test').generateText({ prompt: 'fail' }));

  assert.equal((await commercial.forModule('ai-test').credits.balance('user-1')).balance, 1);
  assert.equal((await store.listMetering({ status: 'committed' })).length, 0);
  assert.equal((await store.listCreditReservations({ status: 'released' })).length, 1);
});

test('K7 host AI webhook provider signs requests and normalizes provider responses', async () => {
  const calls: { input: string | URL; init?: RequestInit }[] = [];
  const env = {
    PLOYKIT_AI_PROVIDER: 'webhook',
    PLOYKIT_AI_WEBHOOK_URL: 'https://ai.example.test/run',
    PLOYKIT_AI_WEBHOOK_SECRET: 'secret',
    PLOYKIT_AI_TEXT_MODEL: 'host-text',
    PLOYKIT_AI_EMBEDDING_MODEL: 'host-embedding',
  };
  const config = resolveHostAiProviderConfig(env);
  const provider = createWebhookModuleAiProvider(config, {
    env,
    fetch: async (input, init) => {
      calls.push({ input, init });
      const body = JSON.parse(String(init?.body)) as {
        operation: string;
        prompt?: string;
        text?: string;
        model: string;
      };
      if (body.operation === 'generateText') {
        return Response.json({
          text: `webhook:${body.prompt}`,
          model: body.model,
          usage: { inputTokens: 2, outputTokens: 4 },
        });
      }
      return Response.json({
        embedding: [String(body.text).length, 1, 0],
        model: body.model,
        usage: { inputTokens: 1 },
      });
    },
  });

  const text = await provider.generateText({ prompt: 'hello', model: config.textModel });
  const embedding = await provider.embedText({ text: 'hello', model: config.embeddingModel });
  const headers = new Headers(calls[0]?.init?.headers);
  const status = getHostAiProviderStatus(env);

  assert.equal(config.configured, true);
  assert.equal(status.mode, 'webhook');
  assert.equal(status.webhookConfigured, true);
  assert.equal(text.text, 'webhook:hello');
  assert.deepEqual(embedding.embedding, [5, 1, 0]);
  assert.equal(calls[0]?.input, 'https://ai.example.test/run');
  assert.ok(headers.get('x-ploykit-ai-signature'));
});

test('P8 host static AI provider uses cost guard and records invocation evidence', async () => {
  const store = createInMemoryRuntimeStore();
  const commercial = createRuntimeStoreCommercialRuntime({
    store,
    productId: 'product-a',
    workspaceId: 'workspace-a',
  });
  await commercial.admin.grantCredits({
    session: { user: { id: 'admin-1', role: 'admin' } },
    userId: 'user-1',
    amount: 3,
    unit: 'ai-credit',
  });
  const ai = createHostModuleAiApi({
    moduleId: 'ai-test',
    session: {
      user: { id: 'user-1', role: 'user' },
      userId: 'user-1',
      productId: 'product-a',
      workspaceId: 'workspace-a',
    },
    commercialForModule: (moduleId) => commercial.forModule(moduleId),
    recordProviderInvocation: async (record) => {
      await store.recordProviderInvocation(record);
    },
    env: {
      PLOYKIT_AI_PROVIDER: 'static',
      PLOYKIT_AI_GENERATE_TEXT_CREDITS: '1',
      PLOYKIT_AI_EMBED_TEXT_CREDITS: '1',
    },
  });

  const text = await ai.generateText({ prompt: 'hello static', idempotencyKey: 'host-ai-static-1' });
  const embedding = await ai.embedText({ text: 'hello static', idempotencyKey: 'host-ai-static-2' });
  const invocations = await store.listProviderInvocations({
    productId: 'product-a',
    providerId: 'host-ai-static',
  });

  assert.equal(text.text, 'demo-ai: hello static');
  assert.equal(embedding.embedding.length, 3);
  assert.equal((await commercial.forModule('ai-test').credits.balance('user-1', 'ai-credit')).balance, 1);
  assert.equal((await store.listUsage({ productId: 'product-a', moduleId: 'ai-test' })).length, 2);
  assert.equal(invocations.length, 2);
  assert.deepEqual(
    invocations.map((record) => record.operation).sort(),
    ['embedText', 'generateText']
  );
});

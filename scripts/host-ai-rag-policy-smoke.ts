import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  api,
  Permission,
  schema,
  stringField,
  validateModuleDefinition,
  type ModuleApiDefinitionContract,
  type ModuleDefinition,
} from '@ploykit/module-sdk';
import {
  createModuleAiProviderRegistry,
  createProviderModuleAiRuntime,
  createRuntimeStoreCommercialRuntime,
  type ModuleAiProvider,
} from '../src/lib/module-capabilities';
import { createInMemoryRuntimeStore } from '../src/lib/module-runtime';

const required = process.argv.includes('--required');
const checkedAt = new Date().toISOString();
const productId = `ai-rag-policy-${Date.now().toString(36)}`;
const workspaceId = 'ai-rag-policy-workspace';
const moduleId = 'ai-rag-policy-module';
const userId = 'ai-rag-policy-user';
const payloadSchema = schema({
  name: 'AiRagPolicySmokePayload',
  fields: {
    value: stringField(),
  },
});

type Check = {
  id: string;
  ok: boolean;
  durationMs: number;
  detail: Record<string, unknown>;
  error?: string;
};

const provider: ModuleAiProvider = {
  id: 'policy-provider',
  async generateText(input) {
    if (input.prompt === 'fail') {
      throw new Error('policy provider failure');
    }
    return {
      text: `policy:${input.prompt}`,
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

function publicAiApi(
  overrides: Partial<Omit<ModuleApiDefinitionContract, '$$type' | 'id' | 'path' | 'handler'>>
): ModuleApiDefinitionContract {
  return api({
    id: 'ai-rag-policy.public',
    path: '/ai/public',
    auth: 'public',
    handler: './api/public-ai',
    methods: ['POST'],
    input: payloadSchema,
    output: payloadSchema,
    ...overrides,
  });
}

function baseModuleDefinition(apis: readonly ModuleApiDefinitionContract[]): ModuleDefinition {
  return {
    id: 'ai-rag-policy',
    name: 'AI RAG Policy',
    version: '0.1.0',
    permissions: [Permission.AiGenerate, Permission.CreditsConsume],
    apis,
  };
}

function diagnosticCodes(definition: ModuleDefinition): string[] {
  return validateModuleDefinition(definition).map((diagnostic) => diagnostic.code);
}

async function runCheck(id: string, run: () => Promise<Record<string, unknown>>): Promise<Check> {
  const startedAt = Date.now();
  try {
    return {
      id,
      ok: true,
      durationMs: Date.now() - startedAt,
      detail: await run(),
    };
  } catch (error) {
    return {
      id,
      ok: false,
      durationMs: Date.now() - startedAt,
      detail: {},
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const store = createInMemoryRuntimeStore();
const commercial = createRuntimeStoreCommercialRuntime({
  store,
  productId,
  workspaceId,
});
const ai = createProviderModuleAiRuntime({
  registry: createModuleAiProviderRegistry({
    providers: [provider],
    policy: {
      text: { providerId: provider.id, model: 'policy-text' },
      embedding: { providerId: provider.id, model: 'policy-embedding' },
    },
  }),
  usage: (scopedModuleId) => commercial.forModule(scopedModuleId).usage,
  metering: (scopedModuleId) => commercial.forModule(scopedModuleId).metering,
  credits: (scopedModuleId) => commercial.forModule(scopedModuleId).credits,
  userId,
  costPolicy: {
    generateTextCredits: 1,
    embedTextCredits: 1,
    unit: 'ai-credit',
  },
});
const moduleAi = ai.forModule(moduleId);

const checks = [
  await runCheck('ai-budget-denies-missing-credits', async () => {
    await assert.rejects(
      () => moduleAi.generateText({ prompt: 'hello', idempotencyKey: 'missing-credits' }),
      /credits/i
    );
    const balance = await commercial.forModule(moduleId).credits.balance(userId, 'ai-credit');
    const metering = await store.listMetering({ productId, moduleId });
    return {
      balance: balance.balance,
      metering: metering.length,
    };
  }),
  await runCheck('ai-budget-commits-successful-cost', async () => {
    await commercial.admin.grantCredits({
      session: { user: { id: 'admin', role: 'admin' } },
      userId,
      amount: 2,
      unit: 'ai-credit',
    });
    const result = await moduleAi.generateText({
      prompt: 'hello',
      idempotencyKey: 'successful-cost',
    });
    const balance = await commercial.forModule(moduleId).credits.balance(userId, 'ai-credit');
    const metering = await store.listMetering({
      productId,
      moduleId,
      status: 'committed',
    });
    const usage = await store.listUsage({
      productId,
      moduleId,
      meter: 'ai.generateText',
    });
    assert.equal(result.text, 'policy:hello');
    assert.equal(balance.balance, 1);
    assert.equal(metering.length, 1);
    assert.equal(usage.length, 1);
    return {
      text: result.text,
      balance: balance.balance,
      committedMetering: metering.length,
      usage: usage.length,
    };
  }),
  await runCheck('ai-budget-releases-failed-provider-reservation', async () => {
    await assert.rejects(
      () => moduleAi.generateText({ prompt: 'fail', idempotencyKey: 'failed-provider' }),
      /policy provider failure/
    );
    const balance = await commercial.forModule(moduleId).credits.balance(userId, 'ai-credit');
    const reservations = await store.listCreditReservations({
      productId,
      workspaceId,
      userId,
      status: 'released',
    });
    const committedMetering = await store.listMetering({
      productId,
      moduleId,
      status: 'committed',
    });
    assert.equal(balance.balance, 1);
    assert.equal(reservations.length, 1);
    assert.equal(committedMetering.length, 1);
    return {
      balance: balance.balance,
      releasedReservations: reservations.length,
      committedMetering: committedMetering.length,
    };
  }),
  await runCheck('anonymous-public-api-requires-rate-limit-policy', async () => {
    const missingPolicyCodes = diagnosticCodes(
      baseModuleDefinition([publicAiApi({})])
    );
    const missingRateLimitCodes = diagnosticCodes(
      baseModuleDefinition([
        publicAiApi({
          anonymousPolicy: { allowHighCostActions: false },
        }),
      ])
    );
    assert.ok(missingPolicyCodes.includes('MODULE_PUBLIC_API_ANONYMOUS_POLICY_REQUIRED'));
    assert.ok(missingRateLimitCodes.includes('MODULE_PUBLIC_API_RATE_LIMIT_REQUIRED'));
    return {
      missingPolicyCodes,
      missingRateLimitCodes,
    };
  }),
  await runCheck('anonymous-public-api-forbids-high-cost-commercial-actions', async () => {
    const highCostCodes = diagnosticCodes(
      baseModuleDefinition([
        publicAiApi({
          commercial: { credits: { amount: 1, unit: 'ai-credit' } },
          anonymousPolicy: {
            rateLimit: { bucket: 'ip', limit: 10, window: '1m' },
            allowHighCostActions: true,
          },
        }),
      ])
    );
    const safeCodes = diagnosticCodes(
      baseModuleDefinition([
        publicAiApi({
          commercial: { credits: { amount: 1, unit: 'ai-credit' } },
          anonymousPolicy: {
            rateLimit: { bucket: 'ip', limit: 10, window: '1m' },
            allowHighCostActions: false,
          },
        }),
      ])
    );
    assert.ok(highCostCodes.includes('MODULE_PUBLIC_API_HIGH_COST_ANONYMOUS_FORBIDDEN'));
    assert.equal(safeCodes.includes('MODULE_PUBLIC_API_HIGH_COST_ANONYMOUS_FORBIDDEN'), false);
    assert.equal(safeCodes.includes('MODULE_PUBLIC_API_RATE_LIMIT_REQUIRED'), false);
    return {
      highCostCodes,
      safeCodes,
    };
  }),
];

const policyEvidence = {
  budgetDeniesMissingCredits: checks.find(
    (check) => check.id === 'ai-budget-denies-missing-credits'
  )?.ok,
  successfulCostCommitted: checks.find((check) => check.id === 'ai-budget-commits-successful-cost')
    ?.ok,
  failedProviderReservationReleased: checks.find(
    (check) => check.id === 'ai-budget-releases-failed-provider-reservation'
  )?.ok,
  anonymousRateLimitRequired: checks.find(
    (check) => check.id === 'anonymous-public-api-requires-rate-limit-policy'
  )?.ok,
  anonymousHighCostForbidden: checks.find(
    (check) => check.id === 'anonymous-public-api-forbids-high-cost-commercial-actions'
  )?.ok,
};
const outputDir = path.resolve(
  process.cwd(),
  '.runtime',
  'ai-rag-policy',
  checkedAt.replace(/[:.]/g, '-')
);
const latestPath = path.resolve(process.cwd(), '.runtime', 'ai-rag-policy', 'latest.json');
const reportPath = path.join(outputDir, 'ai-rag-policy-smoke.json');
const report = {
  ok: checks.every((check) => check.ok),
  required,
  mode: 'local-ai-rag-policy',
  profile: 'local-ai-rag-policy',
  checkedAt,
  domainEvidence: {
    aiRagPolicy: policyEvidence,
  },
  checks,
  artifacts: {
    report: reportPath,
    latest: latestPath,
  },
};

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(path.dirname(latestPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
fs.copyFileSync(reportPath, latestPath);

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.ok ? 0 : 1;

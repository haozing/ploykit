import { createHmac } from 'node:crypto';
import { createProviderModuleAiRuntime } from '@/lib/module-capabilities/ai/provider-ai-runtime';
import {
  createModuleAiProviderRegistry,
  type ModuleAiProvider,
} from '@/lib/module-capabilities/ai/providers/provider-registry';
import type {
  ModuleAiApi,
  ModuleCreditsApi,
  ModuleMeteringApi,
  ModuleUsageApi,
} from '@ploykit/module-sdk';
import type { ModuleHostSession } from '@/lib/module-runtime/host/session';
import type { RecordRuntimeStoreProviderInvocationInput } from '@/lib/module-runtime/stores';
import { defaultProductId } from './default-scope';
import { getHostRuntimeStore } from './runtime-store';

export type HostAiProviderMode = 'static' | 'local-test' | 'webhook';

export interface HostAiProviderConfig {
  mode: HostAiProviderMode;
  configured: boolean;
  textModel: string;
  embeddingModel: string;
  webhookUrl?: string;
  webhookSecretConfigured: boolean;
  generateTextCredits: number;
  embedTextCredits: number;
  creditUnit: string;
}

export interface HostAiProviderStatus {
  mode: HostAiProviderMode;
  configured: boolean;
  textModel: string;
  embeddingModel: string;
  webhookConfigured: boolean;
  webhookSecretConfigured: boolean;
  costPolicy: {
    generateTextCredits: number;
    embedTextCredits: number;
    unit: string;
  };
}

type HostAiEnv = Partial<
  Record<
    | 'PLOYKIT_AI_PROVIDER'
    | 'PLOYKIT_AI_TEXT_MODEL'
    | 'PLOYKIT_AI_EMBEDDING_MODEL'
    | 'PLOYKIT_AI_WEBHOOK_URL'
    | 'PLOYKIT_AI_WEBHOOK_SECRET'
    | 'PLOYKIT_AI_GENERATE_TEXT_CREDITS'
    | 'PLOYKIT_AI_EMBED_TEXT_CREDITS'
    | 'PLOYKIT_AI_CREDIT_UNIT',
    string | undefined
  >
>;

type AiFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

interface HostAiWebhookPayload {
  operation: 'generateText' | 'embedText';
  model: string;
  prompt?: string;
  text?: string;
  metadata?: Record<string, unknown>;
}

interface HostAiUsagePayload {
  inputTokens?: unknown;
  outputTokens?: unknown;
  totalTokens?: unknown;
}

function readCredits(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function countTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

function embed(value: string): number[] {
  const hash = [...value].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return [value.length, hash % 997, (hash % 37) / 37];
}

function createLocalModuleAiProvider(config: HostAiProviderConfig): ModuleAiProvider {
  return {
    id: config.mode === 'local-test' ? 'host-ai-local-test' : 'host-ai-static',
    async generateText(input) {
      const text = `${config.mode === 'local-test' ? 'local-ai: ' : 'demo-ai: '}${input.prompt}`;
      return {
        text,
        model: input.model ?? config.textModel,
        usage: {
          inputTokens: countTokens(input.prompt),
          outputTokens: countTokens(text),
        },
      };
    },
    async embedText(input) {
      return {
        embedding: embed(input.text),
        model: input.model ?? config.embeddingModel,
        usage: {
          inputTokens: countTokens(input.text),
        },
      };
    },
  };
}

function normalizeMode(value: string | undefined): HostAiProviderMode {
  if (!value) {
    return 'static';
  }
  if (value === 'static' || value === 'local-test' || value === 'webhook') {
    return value;
  }
  throw new Error(
    `PLOYKIT_AI_PROVIDER_INVALID: expected static, local-test or webhook, got ${value}`
  );
}

function numberFromPayload(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function usageFromPayload(
  value: HostAiUsagePayload | undefined,
  fallbackInputTokens: number,
  fallbackOutputTokens = 0
) {
  return {
    inputTokens: numberFromPayload(value?.inputTokens, fallbackInputTokens),
    outputTokens: numberFromPayload(value?.outputTokens, fallbackOutputTokens),
  };
}

function approximateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

function signBody(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

function embeddingFromPayload(value: unknown): number[] {
  if (!Array.isArray(value)) {
    throw new Error('HOST_AI_WEBHOOK_EMBEDDING_INVALID');
  }
  const embedding = value.map((item) => Number(item)).filter((item) => Number.isFinite(item));
  if (embedding.length === 0) {
    throw new Error('HOST_AI_WEBHOOK_EMBEDDING_INVALID');
  }
  return embedding;
}

async function readWebhookJson(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.json().catch(() => null);
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

export function resolveHostAiProviderConfig(env: HostAiEnv): HostAiProviderConfig {
  const mode = normalizeMode(env.PLOYKIT_AI_PROVIDER);
  const webhookUrl = env.PLOYKIT_AI_WEBHOOK_URL?.trim();
  return {
    mode,
    configured: mode === 'static' || mode === 'local-test' || Boolean(webhookUrl),
    textModel: env.PLOYKIT_AI_TEXT_MODEL?.trim() || 'static-text',
    embeddingModel: env.PLOYKIT_AI_EMBEDDING_MODEL?.trim() || 'static-embedding',
    webhookUrl: webhookUrl || undefined,
    webhookSecretConfigured: Boolean(env.PLOYKIT_AI_WEBHOOK_SECRET?.trim()),
    generateTextCredits: readCredits(env.PLOYKIT_AI_GENERATE_TEXT_CREDITS, 1),
    embedTextCredits: readCredits(env.PLOYKIT_AI_EMBED_TEXT_CREDITS, 1),
    creditUnit: env.PLOYKIT_AI_CREDIT_UNIT?.trim() || 'ai-credit',
  };
}

export function getHostAiProviderStatus(
  env: HostAiEnv = process.env as HostAiEnv
): HostAiProviderStatus {
  const config = resolveHostAiProviderConfig(env);
  return {
    mode: config.mode,
    configured: config.configured,
    textModel: config.textModel,
    embeddingModel: config.embeddingModel,
    webhookConfigured: Boolean(config.webhookUrl),
    webhookSecretConfigured: config.webhookSecretConfigured,
    costPolicy: {
      generateTextCredits: config.generateTextCredits,
      embedTextCredits: config.embedTextCredits,
      unit: config.creditUnit,
    },
  };
}

export function createWebhookModuleAiProvider(
  config: HostAiProviderConfig,
  options: { fetch?: AiFetch; env?: HostAiEnv } = {}
): ModuleAiProvider {
  const fetchImpl = options.fetch ?? fetch;
  const env = options.env ?? (process.env as HostAiEnv);

  async function callWebhook(payload: HostAiWebhookPayload): Promise<Record<string, unknown>> {
    if (!config.webhookUrl) {
      throw new Error('HOST_AI_WEBHOOK_URL_MISSING');
    }
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    const secret = env.PLOYKIT_AI_WEBHOOK_SECRET?.trim();
    if (secret) {
      headers['x-ploykit-ai-signature'] = signBody(body, secret);
    }
    const response = await fetchImpl(config.webhookUrl, {
      method: 'POST',
      headers,
      body,
    });
    const json = await readWebhookJson(response);
    if (!response.ok) {
      const error = json.error;
      const message =
        error && typeof error === 'object' && 'message' in error
          ? String((error as { message?: unknown }).message)
          : `HOST_AI_WEBHOOK_STATUS_${response.status}`;
      throw new Error(message);
    }
    return json;
  }

  return {
    id: 'host-ai-webhook',
    async generateText(input) {
      const prompt = input.prompt;
      const model = input.model ?? config.textModel;
      const json = await callWebhook({
        operation: 'generateText',
        model,
        prompt,
        metadata: input.metadata,
      });
      const text = typeof json.text === 'string' ? json.text : '';
      if (!text) {
        throw new Error('HOST_AI_WEBHOOK_TEXT_INVALID');
      }
      const usage = usageFromPayload(
        json.usage as HostAiUsagePayload | undefined,
        approximateTokens(prompt),
        approximateTokens(text)
      );
      return {
        text,
        model: typeof json.model === 'string' ? json.model : model,
        usage,
      };
    },
    async embedText(input) {
      const text = input.text;
      const model = input.model ?? config.embeddingModel;
      const json = await callWebhook({
        operation: 'embedText',
        model,
        text,
        metadata: input.metadata,
      });
      return {
        embedding: embeddingFromPayload(json.embedding),
        model: typeof json.model === 'string' ? json.model : model,
        usage: usageFromPayload(
          json.usage as HostAiUsagePayload | undefined,
          approximateTokens(text)
        ),
      };
    },
  };
}

export function createHostModuleAiApi(input: {
  moduleId: string;
  session: ModuleHostSession;
  commercialForModule(moduleId: string): {
    usage: ModuleUsageApi;
    metering: ModuleMeteringApi;
    credits: ModuleCreditsApi;
  };
  audit?: (record: {
    moduleId: string;
    type: string;
    metadata?: Record<string, unknown>;
  }) => Promise<void> | void;
  recordProviderInvocation?: (
    record: RecordRuntimeStoreProviderInvocationInput
  ) => Promise<void> | void;
  env?: HostAiEnv;
  fetch?: AiFetch;
}): ModuleAiApi {
  const config = resolveHostAiProviderConfig(input.env ?? (process.env as HostAiEnv));
  if (!config.configured) {
    throw new Error('HOST_AI_PROVIDER_NOT_CONFIGURED');
  }

  const provider =
    config.mode === 'webhook'
      ? createWebhookModuleAiProvider(config, { fetch: input.fetch, env: input.env })
      : createLocalModuleAiProvider(config);
  const providerId = provider.id;
  const registry = createModuleAiProviderRegistry({
    providers: [provider],
    policy: {
      text: { providerId, model: config.textModel },
      embedding: { providerId, model: config.embeddingModel },
    },
  });
  const userId = aiBillingSubjectId(input.session);
  async function recordProviderInvocation(record: RecordRuntimeStoreProviderInvocationInput) {
    if (input.recordProviderInvocation) {
      await input.recordProviderInvocation(record);
      return;
    }
    await (await getHostRuntimeStore()).store.recordProviderInvocation(record);
  }
  const runtime = createProviderModuleAiRuntime({
    registry,
    usage: (moduleId) => input.commercialForModule(moduleId).usage,
    metering: (moduleId) => input.commercialForModule(moduleId).metering,
    credits: (moduleId) => input.commercialForModule(moduleId).credits,
    userId,
    costPolicy: {
      generateTextCredits: config.generateTextCredits,
      embedTextCredits: config.embedTextCredits,
      unit: config.creditUnit,
    },
    audit: async (record) => {
      await input.audit?.(record);
      const operation =
        record.type === 'ai.generateText.failed'
          ? 'generateText'
          : record.type === 'ai.embedText.failed'
            ? 'embedText'
            : record.type;
      await recordProviderInvocation({
        productId: defaultProductId(input.session.productId),
        workspaceId: input.session.workspaceId ?? null,
        moduleId: record.moduleId,
        providerId: String(record.metadata?.providerId ?? providerId),
        kind: 'ai',
        operation,
        status: 'failed',
        model: typeof record.metadata?.model === 'string' ? record.metadata.model : undefined,
        error: String(record.metadata?.message ?? 'AI invocation failed.'),
        metadata: record.metadata,
      });
    },
    evidence: async (record) => {
      const credits = Number(record.cost.credits);
      if (Number.isFinite(credits) && credits > 1) {
        await input.audit?.({
          moduleId: record.moduleId,
          type: 'host.ai.high_cost_invocation',
          metadata: {
            providerId: record.providerId,
            operation: record.operation,
            model: record.model,
            credits,
            unit: record.cost.unit,
            latencyMs: record.latencyMs,
            idempotencyKey: record.idempotencyKey,
          },
        });
      }
      await recordProviderInvocation({
        productId: defaultProductId(input.session.productId),
        workspaceId: input.session.workspaceId ?? null,
        moduleId: record.moduleId,
        providerId: record.providerId,
        kind: 'ai',
        operation: record.operation,
        status: 'succeeded',
        model: record.model,
        usage: record.usage,
        cost: record.cost,
        latencyMs: record.latencyMs,
        correlationId: record.idempotencyKey,
        metadata: record.metadata,
      });
    },
  });
  return runtime.forModule(input.moduleId);
}

function aiBillingSubjectId(session: ModuleHostSession): string {
  const userId = session.userId ?? session.user?.id;
  if (userId) {
    return userId;
  }
  if (session.subject) {
    return session.subject.type === 'user'
      ? session.subject.id
      : `${session.subject.type}:${session.subject.id}`;
  }
  if (session.apiKeyId) {
    return `apiKey:${session.apiKeyId}`;
  }
  if (session.workspaceId) {
    return `workspace:${session.workspaceId}`;
  }
  throw new Error('HOST_AI_BILLING_SUBJECT_REQUIRED');
}

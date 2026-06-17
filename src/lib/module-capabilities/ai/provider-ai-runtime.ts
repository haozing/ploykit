import type {
  ModuleAiApi,
  ModuleCreditsApi,
  ModuleMeteringApi,
  ModuleUsageApi,
} from '@ploykit/module-sdk';
import { runWithAiCostGuard } from './cost-guard';
import type { ModuleAiProviderRegistry } from './providers';

export interface ProviderModuleAiRuntime {
  forModule(moduleId: string): ModuleAiApi;
}

export interface CreateProviderModuleAiRuntimeOptions {
  registry: ModuleAiProviderRegistry;
  usage?: (moduleId: string) => ModuleUsageApi;
  metering: (moduleId: string) => ModuleMeteringApi;
  credits: (moduleId: string) => ModuleCreditsApi;
  userId: string | ((moduleId: string) => string);
  costPolicy?: {
    generateTextCredits?: number;
    embedTextCredits?: number;
    unit?: string;
  };
  audit?: (record: {
    moduleId: string;
    type: string;
    metadata?: Record<string, unknown>;
  }) => Promise<void> | void;
  evidence?: (record: {
    moduleId: string;
    providerId: string;
    operation: 'generateText' | 'embedText';
    model: string;
    usage: Record<string, unknown>;
    cost: Record<string, unknown>;
    latencyMs: number;
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
  }) => Promise<void> | void;
}

function userIdFor(
  value: CreateProviderModuleAiRuntimeOptions['userId'],
  moduleId: string
): string {
  return typeof value === 'function' ? value(moduleId) : value;
}

function classifyAiError(error: unknown): { code: string; category: string; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  const code = message.match(/^([A-Z][A-Z0-9_]+)/)?.[1] ?? 'AI_PROVIDER_ERROR';
  const normalized = `${code} ${message}`.toLowerCase();
  if (
    normalized.includes('quota') ||
    normalized.includes('rate_limit') ||
    normalized.includes('rate limit') ||
    normalized.includes('429')
  ) {
    return { code, category: 'quota', message };
  }
  if (
    normalized.includes('policy') ||
    normalized.includes('safety') ||
    normalized.includes('moderation') ||
    normalized.includes('blocked')
  ) {
    return { code, category: 'policy', message };
  }
  if (
    normalized.includes('timeout') ||
    normalized.includes('network') ||
    normalized.includes('econn') ||
    normalized.includes('fetch')
  ) {
    return { code, category: 'transport', message };
  }
  return { code, category: 'provider', message };
}

export function createProviderModuleAiRuntime(
  options: CreateProviderModuleAiRuntimeOptions
): ProviderModuleAiRuntime {
  function scoped(moduleId: string): ModuleAiApi {
    const metering = options.metering(moduleId);
    const credits = options.credits(moduleId);
    const userId = userIdFor(options.userId, moduleId);

    return {
      async generateText(input) {
        const resolved = options.registry.resolveText(input.model);
        const startedAt = Date.now();
        return runWithAiCostGuard({
          userId,
          metering,
          credits,
          policy: {
            meter: 'ai.generateText',
            credits: options.costPolicy?.generateTextCredits ?? 1,
            unit: options.costPolicy?.unit ?? 'credit',
          },
          idempotencyKey: input.idempotencyKey,
          usage: (result) => ({
            quantity: result.usage.inputTokens + result.usage.outputTokens,
            unit: 'token',
            metadata: { providerId: resolved.provider.id, model: result.model },
          }),
          run: async () => {
            try {
              const result = await resolved.provider.generateText({
                prompt: input.prompt,
                model: resolved.model,
                metadata: input.metadata,
              });
              await options.evidence?.({
                moduleId,
                providerId: resolved.provider.id,
                operation: 'generateText',
                model: result.model,
                usage: result.usage as unknown as Record<string, unknown>,
                cost: {
                  meter: 'ai.generateText',
                  credits: options.costPolicy?.generateTextCredits ?? 1,
                  unit: options.costPolicy?.unit ?? 'credit',
                },
                latencyMs: Date.now() - startedAt,
                idempotencyKey: input.idempotencyKey,
                metadata: input.metadata,
              });
              return result;
            } catch (error) {
              const classified = classifyAiError(error);
              await options.audit?.({
                moduleId,
                type: 'ai.generateText.failed',
                metadata: {
                  providerId: resolved.provider.id,
                  model: resolved.model,
                  message: classified.message,
                  errorCode: classified.code,
                  errorCategory: classified.category,
                },
              });
              throw error;
            }
          },
        });
      },
      async *streamText(input) {
        const result = await this.generateText(input);
        for (const chunk of result.text.match(/.{1,16}/g) ?? ['']) {
          yield chunk;
        }
      },
      async embedText(input) {
        const resolved = options.registry.resolveEmbedding(input.model);
        const startedAt = Date.now();
        return runWithAiCostGuard({
          userId,
          metering,
          credits,
          policy: {
            meter: 'ai.embedText',
            credits: options.costPolicy?.embedTextCredits ?? 1,
            unit: options.costPolicy?.unit ?? 'credit',
          },
          idempotencyKey: input.idempotencyKey,
          usage: (result) => ({
            quantity: result.usage.inputTokens,
            unit: 'token',
            metadata: { providerId: resolved.provider.id, model: result.model },
          }),
          run: async () => {
            try {
              const result = await resolved.provider.embedText({
                text: input.text,
                model: resolved.model,
                metadata: input.metadata,
              });
              await options.evidence?.({
                moduleId,
                providerId: resolved.provider.id,
                operation: 'embedText',
                model: result.model,
                usage: result.usage as unknown as Record<string, unknown>,
                cost: {
                  meter: 'ai.embedText',
                  credits: options.costPolicy?.embedTextCredits ?? 1,
                  unit: options.costPolicy?.unit ?? 'credit',
                },
                latencyMs: Date.now() - startedAt,
                idempotencyKey: input.idempotencyKey,
                metadata: input.metadata,
              });
              return result;
            } catch (error) {
              const classified = classifyAiError(error);
              await options.audit?.({
                moduleId,
                type: 'ai.embedText.failed',
                metadata: {
                  providerId: resolved.provider.id,
                  model: resolved.model,
                  message: classified.message,
                  errorCode: classified.code,
                  errorCategory: classified.category,
                },
              });
              throw error;
            }
          },
        });
      },
    };
  }

  return { forModule: scoped };
}

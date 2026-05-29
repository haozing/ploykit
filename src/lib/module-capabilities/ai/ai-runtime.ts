import type { ModuleAiApi, ModuleUsageApi } from '@ploykit/module-sdk';

export interface ModuleAiRuntime extends ModuleAiApi {
  forModule(moduleId: string): ModuleAiApi;
}

export interface CreateStaticModuleAiRuntimeOptions {
  usage?: ModuleUsageApi | ((moduleId: string) => ModuleUsageApi);
  defaultTextModel?: string;
  defaultEmbeddingModel?: string;
  responsePrefix?: string;
}

function countTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

function embed(value: string): number[] {
  const hash = [...value].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return [value.length, hash % 997, (hash % 37) / 37];
}

function usageFor(
  usage: ModuleUsageApi | ((moduleId: string) => ModuleUsageApi) | undefined,
  moduleId: string
): ModuleUsageApi | undefined {
  if (!usage) {
    return undefined;
  }
  return typeof usage === 'function' ? usage(moduleId) : usage;
}

export function createStaticModuleAiRuntime(
  options: CreateStaticModuleAiRuntimeOptions = {}
): ModuleAiRuntime {
  function scoped(moduleId: string): ModuleAiApi {
    const usage = usageFor(options.usage, moduleId);
    const api: ModuleAiApi = {
      async generateText(input) {
        const model = input.model ?? options.defaultTextModel ?? 'static-text';
        const text = `${options.responsePrefix ?? ''}${input.prompt}`;
        const result = {
          text,
          model,
          usage: {
            inputTokens: countTokens(input.prompt),
            outputTokens: countTokens(text),
          },
        };
        await usage?.record({
          meter: 'ai.generateText',
          quantity: result.usage.inputTokens + result.usage.outputTokens,
          unit: 'token',
          idempotencyKey: input.idempotencyKey,
          metadata: { model, ...(input.metadata ?? {}) },
        });
        return result;
      },
      async *streamText(input) {
        const result = await api.generateText(input);
        for (const chunk of result.text.match(/.{1,16}/g) ?? ['']) {
          yield chunk;
        }
      },
      async embedText(input) {
        const model = input.model ?? options.defaultEmbeddingModel ?? 'static-embedding';
        const result = {
          embedding: embed(input.text),
          model,
          usage: {
            inputTokens: countTokens(input.text),
          },
        };
        await usage?.record({
          meter: 'ai.embedText',
          quantity: result.usage.inputTokens,
          unit: 'token',
          idempotencyKey: input.idempotencyKey,
          metadata: { model, ...(input.metadata ?? {}) },
        });
        return result;
      },
    };
    return api;
  }

  const runtime = scoped('__host__') as ModuleAiRuntime;
  runtime.forModule = scoped;
  return runtime;
}

import type { ModuleAiEmbeddingResult, ModuleAiTextResult } from '@ploykit/module-sdk';

export interface ModuleAiProvider {
  id: string;
  generateText(input: {
    prompt: string;
    model: string;
    metadata?: Record<string, unknown>;
  }): Promise<ModuleAiTextResult>;
  streamText?(input: {
    prompt: string;
    model: string;
    metadata?: Record<string, unknown>;
  }): AsyncIterable<string>;
  embedText(input: {
    text: string;
    model: string;
    metadata?: Record<string, unknown>;
  }): Promise<ModuleAiEmbeddingResult>;
}

export interface AiModelPolicy {
  text: { providerId: string; model: string };
  embedding: { providerId: string; model: string };
}

export interface ModuleAiProviderRegistry {
  resolveText(model?: string): { provider: ModuleAiProvider; model: string };
  resolveEmbedding(model?: string): { provider: ModuleAiProvider; model: string };
  listProviders(): string[];
}

export function createModuleAiProviderRegistry(input: {
  providers: readonly ModuleAiProvider[];
  policy: AiModelPolicy;
  modelOverrides?: Record<string, { providerId: string; model: string }>;
}): ModuleAiProviderRegistry {
  const providers = new Map(input.providers.map((provider) => [provider.id, provider]));

  function resolve(ref: { providerId: string; model: string }): {
    provider: ModuleAiProvider;
    model: string;
  } {
    const provider = providers.get(ref.providerId);
    if (!provider) {
      throw new Error(`MODULE_AI_PROVIDER_NOT_FOUND: ${ref.providerId}`);
    }
    return { provider, model: ref.model };
  }

  return {
    resolveText(model) {
      return resolve(
        model ? (input.modelOverrides?.[model] ?? { providerId: '', model }) : input.policy.text
      );
    },
    resolveEmbedding(model) {
      return resolve(
        model
          ? (input.modelOverrides?.[model] ?? { providerId: '', model })
          : input.policy.embedding
      );
    },
    listProviders() {
      return [...providers.keys()];
    },
  };
}

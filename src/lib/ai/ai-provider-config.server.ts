import { env } from '@/lib/_core/env';
import type { CreatePluginAiOptions } from '@/lib/plugin-runtime/capabilities';
import { createPiAiPluginHost } from './pi-ai-host.server';

function splitAllowlist(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function resolveHostPluginAiOptions(
  options?: CreatePluginAiOptions
): CreatePluginAiOptions | undefined {
  if (env.AI_PROVIDER !== 'pi-ai') {
    return options;
  }

  const piAiHost = createPiAiPluginHost({
    defaultGenerateModel: env.AI_DEFAULT_GENERATE_MODEL,
    allowedModels: splitAllowlist(env.AI_MODEL_ALLOWLIST),
    timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
    maxRetries: env.AI_MAX_RETRIES,
  });

  return {
    ...options,
    defaultGenerateModel: options?.defaultGenerateModel ?? env.AI_DEFAULT_GENERATE_MODEL,
    defaultEmbedModel: options?.defaultEmbedModel ?? env.AI_DEFAULT_EMBED_MODEL,
    host: {
      ...piAiHost,
      ...options?.host,
    },
  };
}

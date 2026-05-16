import type {
  Api,
  AssistantMessage,
  Context,
  Message,
  Model,
  SimpleStreamOptions,
  Usage,
} from '@earendil-works/pi-ai';
import {
  PluginError,
  type PluginAiGenerateTextResult,
  type PluginAiMessage,
  type PluginAiStreamTextEvent,
} from '@ploykit/plugin-sdk';
import type {
  PluginAiGenerateHostInput,
  PluginAiHost,
  PluginAiHostScope,
} from '@/lib/plugin-runtime/capabilities';

export interface PiAiPluginHostOptions {
  defaultGenerateModel: string;
  allowedModels?: readonly string[];
  timeoutMs?: number;
  maxRetries?: number;
}

interface PiAiModelRef {
  provider: string;
  modelId: string;
  ref: string;
}

const HOST_DEFAULT_GENERATE_MODEL = 'host.default.generate';
type PiAiModule = typeof import('@earendil-works/pi-ai');

let piAiModulePromise: Promise<PiAiModule> | null = null;

function loadPiAi(): Promise<PiAiModule> {
  piAiModulePromise ??= import('@earendil-works/pi-ai');
  return piAiModulePromise;
}

function createAiProviderError(
  code: string,
  message: string,
  details?: Record<string, unknown>
): PluginError {
  return new PluginError({
    code,
    message,
    statusCode: code === 'PLUGIN_AI_MODEL_NOT_ALLOWED' ? 403 : 503,
    details,
  });
}

function parseModelRef(value: string, fallback: string): PiAiModelRef {
  const raw = value === HOST_DEFAULT_GENERATE_MODEL ? fallback : value;
  const separatorIndex = raw.indexOf(':');
  if (separatorIndex <= 0 || separatorIndex === raw.length - 1) {
    throw createAiProviderError(
      'PLUGIN_AI_MODEL_INVALID',
      'AI model must use the provider:modelId format for the pi-ai host provider.',
      { model: raw }
    );
  }

  return {
    provider: raw.slice(0, separatorIndex),
    modelId: raw.slice(separatorIndex + 1),
    ref: raw,
  };
}

async function resolveModel(modelRef: PiAiModelRef): Promise<Model<Api>> {
  const piAi = await loadPiAi();
  const loadModel = piAi.getModel as unknown as (
    provider: string,
    modelId: string
  ) => Model<Api> | undefined;
  const model = loadModel(modelRef.provider, modelRef.modelId);
  if (!model) {
    throw createAiProviderError('PLUGIN_AI_MODEL_NOT_FOUND', 'AI model is not known to pi-ai.', {
      model: modelRef.ref,
      provider: modelRef.provider,
      modelId: modelRef.modelId,
    });
  }

  return model;
}

function assertModelAllowed(modelRef: PiAiModelRef, allowedModels: ReadonlySet<string>): void {
  if (allowedModels.size === 0) {
    return;
  }

  if (!allowedModels.has(modelRef.ref) && !allowedModels.has(modelRef.modelId)) {
    throw createAiProviderError(
      'PLUGIN_AI_MODEL_NOT_ALLOWED',
      'AI model is not enabled by the host allowlist.',
      { model: modelRef.ref }
    );
  }
}

function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

function assistantFromPluginMessage(message: PluginAiMessage, model: Model<Api>): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: message.content }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: emptyUsage(),
    stopReason: 'stop',
    timestamp: Date.now(),
  };
}

function toPiContext(input: PluginAiGenerateHostInput, model: Model<Api>): Context {
  const systemPrompts: string[] = [];
  const messages: Message[] = [];

  for (const message of input.messages) {
    if (message.role === 'system') {
      systemPrompts.push(message.content);
      continue;
    }

    if (message.role === 'assistant') {
      messages.push(assistantFromPluginMessage(message, model));
      continue;
    }

    const content =
      message.role === 'tool'
        ? `[tool:${message.name ?? 'tool'}]\n${message.content}`
        : message.content;
    messages.push({
      role: 'user',
      content,
      timestamp: Date.now(),
    });
  }

  if (input.prompt) {
    messages.push({
      role: 'user',
      content: input.prompt,
      timestamp: Date.now(),
    });
  }

  if (messages.length === 0) {
    messages.push({
      role: 'user',
      content: '',
      timestamp: Date.now(),
    });
  }

  return {
    systemPrompt: systemPrompts.length > 0 ? systemPrompts.join('\n\n') : undefined,
    messages,
  };
}

function readText(message: AssistantMessage): string {
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

function toPluginUsage(usage: Usage): PluginAiGenerateTextResult['usage'] {
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    totalTokens: usage.totalTokens,
    unit: 'tokens',
  };
}

function toPluginResult(message: AssistantMessage): PluginAiGenerateTextResult {
  return {
    text: readText(message),
    model: message.responseModel ?? message.model,
    provider: String(message.provider),
    finishReason: message.stopReason,
    usage: toPluginUsage(message.usage),
    metadata: {
      api: message.api,
      responseId: message.responseId,
      diagnostics: message.diagnostics,
      cost: message.usage.cost,
    },
  };
}

function toStreamOptions(
  scope: PluginAiHostScope,
  input: PluginAiGenerateHostInput,
  options: PiAiPluginHostOptions
): SimpleStreamOptions {
  return {
    temperature: input.temperature,
    maxTokens: input.maxOutputTokens,
    timeoutMs: options.timeoutMs,
    maxRetries: options.maxRetries,
    metadata: {
      pluginId: scope.pluginId,
      userId: scope.userId,
      userRole: scope.userRole,
      requestId: scope.requestId,
      system: scope.system,
      ...input.metadata,
    },
  };
}

function wrapProviderError(error: unknown, model: string): PluginError {
  if (error instanceof PluginError) {
    return error;
  }

  return createAiProviderError('PLUGIN_AI_PROVIDER_ERROR', 'The host AI provider failed.', {
    model,
    error: error instanceof Error ? error.message : String(error),
  });
}

export function createPiAiPluginHost(options: PiAiPluginHostOptions): Partial<PluginAiHost> {
  const allowedModels = new Set(options.allowedModels?.filter(Boolean) ?? []);

  async function resolveRequestModelAsync(input: PluginAiGenerateHostInput): Promise<{
    modelRef: PiAiModelRef;
    model: Model<Api>;
  }> {
    const modelRef = parseModelRef(input.model, options.defaultGenerateModel);
    assertModelAllowed(modelRef, allowedModels);
    return { modelRef, model: await resolveModel(modelRef) };
  }

  return {
    async generateText(scope, input) {
      const piAi = await loadPiAi();
      const { modelRef, model } = await resolveRequestModelAsync(input);
      try {
        const message = await piAi.completeSimple(
          model,
          toPiContext(input, model),
          toStreamOptions(scope, input, options)
        );
        if (message.stopReason === 'error' || message.stopReason === 'aborted') {
          throw createAiProviderError(
            'PLUGIN_AI_PROVIDER_ERROR',
            message.errorMessage ?? 'The host AI provider failed.',
            { model: modelRef.ref, stopReason: message.stopReason }
          );
        }
        return toPluginResult(message);
      } catch (error) {
        throw wrapProviderError(error, modelRef.ref);
      }
    },

    async *streamText(scope, input): AsyncIterable<PluginAiStreamTextEvent> {
      const piAi = await loadPiAi();
      const { modelRef, model } = await resolveRequestModelAsync(input);
      try {
        for await (const event of piAi.streamSimple(
          model,
          toPiContext(input, model),
          toStreamOptions(scope, input, options)
        )) {
          if (event.type === 'text_delta') {
            yield { type: 'text-delta', text: event.delta };
          } else if (event.type === 'done') {
            yield { type: 'done', result: toPluginResult(event.message) };
          } else if (event.type === 'error') {
            yield {
              type: 'error',
              error: event.error.errorMessage ?? 'The host AI provider failed.',
            };
          }
        }
      } catch (error) {
        throw wrapProviderError(error, modelRef.ref);
      }
    },
  };
}

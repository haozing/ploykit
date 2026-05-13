import { randomUUID } from 'crypto';
import {
  Permission,
  PluginError,
  type PermissionValue,
  type PluginAi,
  type PluginAiEmbedTextInput,
  type PluginAiEmbedTextResult,
  type PluginAiGenerateTextInput,
  type PluginAiGenerateTextResult,
  type PluginAiMessage,
  type PluginAiStreamTextEvent,
  type PluginCreditConsumeResult,
} from '@ploykit/plugin-sdk';
import { getUsageLedger, type UsageLedger } from '@/lib/usage/usage-ledger.server';
import {
  assertJsonSerializable,
  assertPluginNamespaced,
  enforceCapabilityPermission,
  requireUser,
  type PluginCapabilityScope,
} from './guards.server';
import { recordCapabilityAudit } from './audit-helper.server';
import type { AuditPort } from '@/lib/audit/audit-port.server';
import {
  createDefaultPluginCreditsHost,
  type PluginCreditsHost,
} from './credits-capability.server';

const DEFAULT_GENERATE_MODEL = 'host.default.generate';
const DEFAULT_EMBED_MODEL = 'host.default.embed';
const DEFAULT_GENERATE_METER_SUFFIX = 'ai.generate';
const DEFAULT_EMBED_METER_SUFFIX = 'ai.embed';
const DEFAULT_CREDIT_AMOUNT = 1;
const MAX_PROMPT_CHARS = 200_000;
const MAX_EMBED_TEXT_CHARS = 200_000;
const MAX_EMBED_ITEMS = 256;

export interface PluginAiHostScope {
  pluginId: string;
  userId?: string;
  userRole?: 'admin' | 'user';
  requestId: string;
  system: boolean;
}

export interface PluginAiGenerateHostInput
  extends Omit<PluginAiGenerateTextInput, 'meter' | 'creditAmount' | 'idempotencyKey'> {
  model: string;
  messages: PluginAiMessage[];
}

export interface PluginAiEmbedHostInput
  extends Omit<PluginAiEmbedTextInput, 'meter' | 'creditAmount' | 'idempotencyKey'> {
  model: string;
  input: string[];
}

export interface PluginAiHost {
  generateText(
    scope: PluginAiHostScope,
    input: PluginAiGenerateHostInput
  ): Promise<PluginAiGenerateTextResult>;
  streamText?(
    scope: PluginAiHostScope,
    input: PluginAiGenerateHostInput
  ): AsyncIterable<PluginAiStreamTextEvent>;
  embedText(
    scope: PluginAiHostScope,
    input: PluginAiEmbedHostInput
  ): Promise<PluginAiEmbedTextResult>;
}

export interface CreatePluginAiOptions {
  host?: Partial<PluginAiHost>;
  creditsHost?: Partial<PluginCreditsHost>;
  usageLedger?: UsageLedger;
  auditPort?: AuditPort;
  defaultGenerateModel?: string;
  defaultEmbedModel?: string;
  defaultCreditAmount?: number;
}

function createInputError(label: string, details?: Record<string, unknown>): PluginError {
  return new PluginError({
    code: 'PLUGIN_AI_INPUT_INVALID',
    message: `${label} is invalid.`,
    statusCode: 400,
    details,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readOptionalString(value: unknown, label: string, maxLength: number): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw createInputError(label, { label });
  }

  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }

  if (normalized.length > maxLength) {
    throw createInputError(label, { label, maxLength });
  }

  return normalized;
}

function normalizeTemperature(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 2) {
    throw createInputError('AI temperature', { temperature: value });
  }

  return value;
}

function normalizeMaxOutputTokens(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value <= 0
  ) {
    throw createInputError('AI maxOutputTokens', { maxOutputTokens: value });
  }

  return value;
}

function normalizeCreditAmount(value: unknown, defaultAmount: number): number {
  if (value === undefined || value === null) {
    return defaultAmount;
  }

  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw createInputError('AI creditAmount', { creditAmount: value });
  }

  return value;
}

function assertMetadata(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw createInputError(label, { label });
  }

  assertJsonSerializable(value, label);
}

function normalizeMessages(input: PluginAiGenerateTextInput): PluginAiMessage[] {
  const messages = input.messages ?? [];
  if (!Array.isArray(messages)) {
    throw createInputError('AI messages');
  }

  const normalizedMessages = messages.map((message, index) => {
    if (!isRecord(message)) {
      throw createInputError(`AI message ${index}`);
    }

    const role = message.role;
    if (role !== 'system' && role !== 'user' && role !== 'assistant' && role !== 'tool') {
      throw createInputError(`AI message ${index} role`, { role });
    }

    const content = readOptionalString(
      message.content,
      `AI message ${index} content`,
      MAX_PROMPT_CHARS
    );
    if (!content) {
      throw createInputError(`AI message ${index} content`);
    }

    const name = readOptionalString(message.name, `AI message ${index} name`, 80);
    return { role, content, name };
  });

  const prompt = readOptionalString(input.prompt, 'AI prompt', MAX_PROMPT_CHARS);
  if (prompt) {
    normalizedMessages.push({ role: 'user', content: prompt, name: undefined });
  }

  if (normalizedMessages.length === 0) {
    throw createInputError('AI prompt/messages');
  }

  const totalCharacters = normalizedMessages.reduce(
    (total, message) => total + message.content.length,
    0
  );
  if (totalCharacters > MAX_PROMPT_CHARS) {
    throw createInputError('AI prompt/messages length', {
      maxCharacters: MAX_PROMPT_CHARS,
      characters: totalCharacters,
    });
  }

  return normalizedMessages;
}

function normalizeEmbedInput(value: PluginAiEmbedTextInput['input']): string[] {
  const values = Array.isArray(value) ? value : [value];
  if (values.length === 0 || values.length > MAX_EMBED_ITEMS) {
    throw createInputError('AI embedding input count', {
      maxItems: MAX_EMBED_ITEMS,
      count: values.length,
    });
  }

  const normalized = values.map((item, index) => {
    const text = readOptionalString(item, `AI embedding input ${index}`, MAX_EMBED_TEXT_CHARS);
    if (!text) {
      throw createInputError(`AI embedding input ${index}`);
    }
    return text;
  });

  const totalCharacters = normalized.reduce((total, item) => total + item.length, 0);
  if (totalCharacters > MAX_EMBED_TEXT_CHARS) {
    throw createInputError('AI embedding input length', {
      maxCharacters: MAX_EMBED_TEXT_CHARS,
      characters: totalCharacters,
    });
  }

  return normalized;
}

function createHostScope(scope: PluginCapabilityScope): PluginAiHostScope {
  return {
    pluginId: scope.contract.id,
    userId: scope.user?.id,
    userRole: scope.user?.role,
    requestId: scope.requestId,
    system: Boolean(scope.system),
  };
}

function createUnconfiguredHost(): PluginAiHost {
  const error = () =>
    new PluginError({
      code: 'PLUGIN_AI_PROVIDER_UNCONFIGURED',
      message: 'No host AI provider is configured for plugin AI capability.',
      statusCode: 503,
      fix: 'Configure a host AI provider and inject it into createPluginRuntimeContext capabilities.ai.host.',
    });

  return {
    async generateText() {
      throw error();
    },
    async *streamText() {
      throw error();
    },
    async embedText() {
      throw error();
    },
  };
}

function resolveHost(host: Partial<PluginAiHost> | undefined): PluginAiHost {
  const fallbackHost = createUnconfiguredHost();
  return {
    generateText: host?.generateText ?? fallbackHost.generateText,
    streamText: host?.streamText,
    embedText: host?.embedText ?? fallbackHost.embedText,
  };
}

function resolveCreditsHost(host: Partial<PluginCreditsHost> | undefined): PluginCreditsHost {
  return {
    ...createDefaultPluginCreditsHost(),
    ...host,
  };
}

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

async function recordUsage(
  scope: PluginCapabilityScope,
  usageLedger: UsageLedger,
  operation: 'generateText' | 'streamText' | 'embedText',
  model: string,
  amount: number,
  metadata: Record<string, unknown> | undefined,
  idempotencyKey: string
): Promise<void> {
  const user = requireUser(scope, `ctx.ai.${operation}`);
  await usageLedger.record({
    id: randomUUID(),
    idempotencyKey: `${idempotencyKey}:usage`,
    userId: user.id,
    category: 'api_quota',
    amount,
    unit: 'ai-call',
    metadata: {
      pluginId: scope.contract.id,
      requestId: scope.requestId,
      operation,
      model,
      ...metadata,
    },
    timestamp: new Date(),
  });
}

async function consumeCredits(
  scope: PluginCapabilityScope,
  creditsHost: PluginCreditsHost,
  operation: 'generateText' | 'streamText' | 'embedText',
  meter: string,
  amount: number,
  idempotencyKey: string,
  metadata: Record<string, unknown> | undefined
): Promise<PluginCreditConsumeResult | null> {
  if (amount === 0) {
    return null;
  }

  const user = requireUser(scope, `ctx.ai.${operation}`);
  return creditsHost.consume(
    {
      pluginId: scope.contract.id,
      userId: user.id,
      userRole: user.role,
      requestId: scope.requestId,
      system: Boolean(scope.system),
    },
    {
      meter,
      amount,
      userId: user.id,
      idempotencyKey: `${idempotencyKey}:credits`,
      metadata: {
        operation,
        ...metadata,
      },
    }
  );
}

function mergeUsageCredits<T extends PluginAiGenerateTextResult | PluginAiEmbedTextResult>(
  result: T,
  credits: PluginCreditConsumeResult | null
): T {
  if (!credits) {
    return result;
  }

  return {
    ...result,
    usage: {
      ...result.usage,
      creditsConsumed: credits.amount,
    },
  };
}

export function createPluginAiCapability(
  scope: PluginCapabilityScope,
  options: CreatePluginAiOptions = {}
): PluginAi {
  const host = resolveHost(options.host);
  const creditsHost = resolveCreditsHost(options.creditsHost);
  const usageLedger = options.usageLedger ?? getUsageLedger();
  const defaultGenerateModel = options.defaultGenerateModel ?? DEFAULT_GENERATE_MODEL;
  const defaultEmbedModel = options.defaultEmbedModel ?? DEFAULT_EMBED_MODEL;
  const defaultCreditAmount = options.defaultCreditAmount ?? DEFAULT_CREDIT_AMOUNT;

  function assertHostConfigured(operation: 'generateText' | 'streamText' | 'embedText'): void {
    const isConfigured =
      operation === 'generateText'
        ? typeof options.host?.generateText === 'function'
        : operation === 'streamText'
          ? typeof options.host?.streamText === 'function' ||
            typeof options.host?.generateText === 'function'
          : typeof options.host?.embedText === 'function';

    if (!isConfigured) {
      throw new PluginError({
        code: 'PLUGIN_AI_PROVIDER_UNCONFIGURED',
        message: `No host AI provider is configured for ctx.ai.${operation}.`,
        statusCode: 503,
        fix: 'Configure a host AI provider and inject it into createPluginRuntimeContext capabilities.ai.host.',
        details: {
          pluginId: scope.contract.id,
          operation,
        },
      });
    }
  }

  function prepareCall(
    operation: 'generateText' | 'streamText' | 'embedText',
    permission: PermissionValue,
    input: {
      model: string;
      meter?: string;
      creditAmount?: number;
      idempotencyKey?: string;
      metadata?: Record<string, unknown>;
    }
  ) {
    enforceCapabilityPermission(scope, permission, `ctx.ai.${operation}`);
    const metadata = input.metadata;
    if (metadata !== undefined) {
      assertMetadata(metadata, 'AI metadata');
    }

    const meter =
      readOptionalString(input.meter, 'AI meter', 120) ??
      `${scope.contract.id}.${operation === 'embedText' ? DEFAULT_EMBED_METER_SUFFIX : DEFAULT_GENERATE_METER_SUFFIX}`;
    assertPluginNamespaced(scope, meter, 'AI meter');

    const idempotencyKey =
      readOptionalString(input.idempotencyKey, 'AI idempotency key', 160) ??
      `${scope.requestId}:ai:${operation}:${randomUUID()}`;
    const creditAmount = normalizeCreditAmount(input.creditAmount, defaultCreditAmount);

    assertHostConfigured(operation);
    return { metadata, meter, creditAmount, idempotencyKey };
  }

  async function completeCall(
    operation: 'generateText' | 'streamText' | 'embedText',
    model: string,
    prepared: {
      metadata?: Record<string, unknown>;
      meter: string;
      creditAmount: number;
      idempotencyKey: string;
    }
  ) {
    await recordUsage(
      scope,
      usageLedger,
      operation,
      model,
      1,
      prepared.metadata,
      prepared.idempotencyKey
    );
    return consumeCredits(
      scope,
      creditsHost,
      operation,
      prepared.meter,
      prepared.creditAmount,
      prepared.idempotencyKey,
      prepared.metadata
    );
  }

  function normalizeGenerateInput(input: PluginAiGenerateTextInput): PluginAiGenerateHostInput {
    if (!isRecord(input)) {
      throw createInputError('AI generate input');
    }

    return {
      prompt: readOptionalString(input.prompt, 'AI prompt', MAX_PROMPT_CHARS),
      messages: normalizeMessages(input),
      model: readOptionalString(input.model, 'AI model', 120) ?? defaultGenerateModel,
      temperature: normalizeTemperature(input.temperature),
      maxOutputTokens: normalizeMaxOutputTokens(input.maxOutputTokens),
      metadata: isRecord(input.metadata) ? input.metadata : undefined,
    };
  }

  function normalizeEmbedHostInput(input: PluginAiEmbedTextInput): PluginAiEmbedHostInput {
    if (!isRecord(input)) {
      throw createInputError('AI embed input');
    }

    return {
      input: normalizeEmbedInput(input.input),
      model: readOptionalString(input.model, 'AI embedding model', 120) ?? defaultEmbedModel,
      metadata: isRecord(input.metadata) ? input.metadata : undefined,
    };
  }

  return {
    async generateText(input) {
      const normalized = normalizeGenerateInput(input);
      const prepared = prepareCall('generateText', Permission.AiGenerate, {
        model: normalized.model,
        meter: input.meter,
        creditAmount: input.creditAmount,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata,
      });

      const result = await host.generateText(createHostScope(scope), normalized);
      const credits = await completeCall('generateText', normalized.model, prepared);
      const finalResult = mergeUsageCredits(result, credits);
      await recordCapabilityAudit(
        scope,
        `${scope.contract.id}.ai.generateText`,
        {
          model: finalResult.model,
          provider: finalResult.provider,
          inputTokens:
            finalResult.usage?.inputTokens ??
            estimateTokens(normalized.messages.map((message) => message.content).join('\n')),
          outputTokens: finalResult.usage?.outputTokens,
          creditsConsumed: finalResult.usage?.creditsConsumed,
        },
        options.auditPort
      );
      return finalResult;
    },

    async *streamText(input) {
      const normalized = normalizeGenerateInput(input);
      const prepared = prepareCall('streamText', Permission.AiGenerate, {
        model: normalized.model,
        meter: input.meter,
        creditAmount: input.creditAmount,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata,
      });

      let finalResult: PluginAiGenerateTextResult | undefined;
      for await (const event of host.streamText?.(createHostScope(scope), normalized) ??
        (async function* () {
          const result = await host.generateText(createHostScope(scope), normalized);
          yield { type: 'text-delta' as const, text: result.text };
          yield { type: 'done' as const, result };
        })()) {
        if (event.type === 'done' && event.result) {
          const credits = await completeCall('streamText', normalized.model, prepared);
          finalResult = mergeUsageCredits(event.result, credits);
          yield { ...event, result: finalResult };
        } else {
          yield event;
        }
      }

      if (finalResult) {
        await recordCapabilityAudit(
          scope,
          `${scope.contract.id}.ai.streamText`,
          {
            model: finalResult.model,
            provider: finalResult.provider,
            creditsConsumed: finalResult.usage?.creditsConsumed,
          },
          options.auditPort
        );
      }
    },

    async embedText(input) {
      const normalized = normalizeEmbedHostInput(input);
      const prepared = prepareCall('embedText', Permission.AiEmbed, {
        model: normalized.model,
        meter: input.meter,
        creditAmount: input.creditAmount,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata,
      });

      const result = await host.embedText(createHostScope(scope), normalized);
      const credits = await completeCall('embedText', normalized.model, prepared);
      const finalResult = mergeUsageCredits(result, credits);
      await recordCapabilityAudit(
        scope,
        `${scope.contract.id}.ai.embedText`,
        {
          model: finalResult.model,
          provider: finalResult.provider,
          embeddingCount: finalResult.embeddings.length,
          creditsConsumed: finalResult.usage?.creditsConsumed,
        },
        options.auditPort
      );
      return finalResult;
    },
  };
}

import { describe, expect, it, vi } from 'vitest';
import { definePlugin, Permission, type PermissionValue } from '@ploykit/plugin-sdk';
import { normalizePluginRuntimeContract } from '../../contract';
import { createPluginRuntimeContext } from '../../context';
import type { AuditEvent, AuditPort } from '@/lib/audit/audit-port.server';
import type { UsageLedger, UsageRecord } from '@/lib/usage/usage-ledger.server';
import type { PluginAiHost, PluginCreditsHost } from '..';

function createContract(
  permissions: PermissionValue[] = [Permission.AiGenerate, Permission.AiEmbed]
) {
  return normalizePluginRuntimeContract(
    definePlugin({
      id: 'ai-test',
      name: 'AI Test',
      version: '1.0.0',
      permissions,
    })
  );
}

function createContext(options: {
  permissions?: PermissionValue[];
  host?: Partial<PluginAiHost>;
  creditsHost?: Partial<PluginCreditsHost>;
  usageRecords?: UsageRecord[];
  auditEvents?: AuditEvent[];
}) {
  const usageRecords = options.usageRecords ?? [];
  const auditEvents = options.auditEvents ?? [];
  const usageLedger: UsageLedger = {
    async record(record) {
      usageRecords.push(record);
    },
    async query() {
      return usageRecords;
    },
    async getQuotaUsage() {
      return usageRecords.reduce((sum, record) => sum + record.amount, 0);
    },
  };
  const auditPort: AuditPort = {
    async log(event) {
      auditEvents.push(event);
    },
    async query() {
      return auditEvents;
    },
  };

  return createPluginRuntimeContext({
    contract: createContract(options.permissions),
    request: new Request('https://test.local/api/plugins/ai-test/ai'),
    requestId: 'request-1',
    user: { id: 'user-1', role: 'user' },
    capabilities: {
      ai: {
        host: options.host,
        creditsHost: options.creditsHost,
        usageLedger,
        auditPort,
      },
    },
  });
}

describe('ai capability', () => {
  it('generates text through the host and records usage, credits, and audit', async () => {
    const usageRecords: UsageRecord[] = [];
    const auditEvents: AuditEvent[] = [];
    const generateText = vi.fn<PluginAiHost['generateText']>(async (_scope, input) => ({
      text: `Hello ${input.messages.at(-1)?.content}`,
      model: input.model,
      provider: 'test-provider',
      finishReason: 'stop',
      usage: {
        inputTokens: 4,
        outputTokens: 2,
        totalTokens: 6,
      },
    }));
    const consume = vi.fn<PluginCreditsHost['consume']>(async (_scope, input) => ({
      consumed: true,
      amount: input.amount,
      balanceBefore: 10,
      balanceAfter: 10 - input.amount,
      meter: input.meter,
      metric: input.metric,
      scope: input.accountScope,
      userId:
        input.userId ?? (input.accountScope.type === 'user' ? input.accountScope.id : undefined),
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata,
    }));
    const context = createContext({
      host: { generateText },
      creditsHost: { consume },
      usageRecords,
      auditEvents,
    });

    await expect(
      context.ai.generateText({
        prompt: 'world',
        model: 'gpt-test',
        meter: 'ai-test.generate',
        creditAmount: 2,
        idempotencyKey: 'ai-call-1',
        metadata: { workflow: 'outline' },
      })
    ).resolves.toEqual({
      text: 'Hello world',
      model: 'gpt-test',
      provider: 'test-provider',
      finishReason: 'stop',
      usage: {
        inputTokens: 4,
        outputTokens: 2,
        totalTokens: 6,
        creditsConsumed: 2,
      },
    });
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({ pluginId: 'ai-test', userId: 'user-1' }),
      expect.objectContaining({
        model: 'gpt-test',
        messages: [{ role: 'user', content: 'world', name: undefined }],
      })
    );
    expect(consume).toHaveBeenCalledWith(
      expect.objectContaining({ pluginId: 'ai-test', userId: 'user-1' }),
      expect.objectContaining({
        meter: 'ai-test.generate',
        amount: 2,
        userId: 'user-1',
        idempotencyKey: 'ai-call-1:credits',
      })
    );
    expect(usageRecords[0]).toMatchObject({
      idempotencyKey: 'ai-call-1:usage',
      userId: 'user-1',
      category: 'api_quota',
      amount: 1,
      unit: 'ai-call',
      metadata: {
        pluginId: 'ai-test',
        operation: 'generateText',
        model: 'gpt-test',
        workflow: 'outline',
      },
    });
    expect(auditEvents[0]).toMatchObject({
      action: 'ai-test.ai.generateText',
      details: {
        pluginId: 'ai-test',
        model: 'gpt-test',
        provider: 'test-provider',
        creditsConsumed: 2,
      },
    });
  });

  it('streams text and uses generateText fallback when no streaming host is provided', async () => {
    const context = createContext({
      host: {
        async generateText(_scope, input) {
          return {
            text: `Generated ${input.messages.at(-1)?.content}`,
            model: input.model,
            provider: 'fallback',
          };
        },
      },
      creditsHost: {
        async consume(_scope, input) {
          return {
            consumed: true,
            amount: input.amount,
            balanceBefore: 3,
            balanceAfter: 2,
            meter: input.meter,
            metric: input.metric,
            scope: input.accountScope,
            userId:
              input.userId ??
              (input.accountScope.type === 'user' ? input.accountScope.id : undefined),
            idempotencyKey: input.idempotencyKey,
          };
        },
      },
    });

    const events = [];
    for await (const event of context.ai.streamText({ prompt: 'story' })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'text-delta', text: 'Generated story' },
      {
        type: 'done',
        result: {
          text: 'Generated story',
          model: 'host.default.generate',
          provider: 'fallback',
          usage: { creditsConsumed: 1 },
        },
      },
    ]);
  });

  it('embeds text through the host', async () => {
    const embedText = vi.fn<PluginAiHost['embedText']>(async (_scope, input) => ({
      embeddings: input.input.map((_value, index) => ({ index, embedding: [index, 1] })),
      model: input.model,
      provider: 'test-provider',
    }));
    const context = createContext({
      host: { embedText },
      creditsHost: {
        async consume(_scope, input) {
          return {
            consumed: true,
            amount: input.amount,
            balanceBefore: 9,
            balanceAfter: 8,
            meter: input.meter,
            metric: input.metric,
            scope: input.accountScope,
            userId:
              input.userId ??
              (input.accountScope.type === 'user' ? input.accountScope.id : undefined),
            idempotencyKey: input.idempotencyKey,
          };
        },
      },
    });

    await expect(
      context.ai.embedText({
        input: ['alpha', 'beta'],
        model: 'embed-test',
        meter: 'ai-test.embed',
      })
    ).resolves.toEqual({
      embeddings: [
        { index: 0, embedding: [0, 1] },
        { index: 1, embedding: [1, 1] },
      ],
      model: 'embed-test',
      provider: 'test-provider',
      usage: { creditsConsumed: 1 },
    });
  });

  it('enforces permissions independently', async () => {
    const generateOnly = createContext({
      permissions: [Permission.AiGenerate],
      host: {
        async generateText(_scope, input) {
          return { text: 'ok', model: input.model };
        },
      },
    });
    await expect(generateOnly.ai.generateText({ prompt: 'ok', creditAmount: 0 })).resolves.toEqual({
      text: 'ok',
      model: 'host.default.generate',
    });
    await expect(generateOnly.ai.embedText({ input: 'denied' })).rejects.toMatchObject({
      code: 'PLUGIN_CAPABILITY_PERMISSION_MISSING',
      details: { permission: Permission.AiEmbed },
    });

    const embedOnly = createContext({
      permissions: [Permission.AiEmbed],
      host: {
        async embedText(_scope, input) {
          return {
            embeddings: input.input.map((_value, index) => ({ index, embedding: [1] })),
            model: input.model,
          };
        },
      },
    });
    await expect(embedOnly.ai.generateText({ prompt: 'denied' })).rejects.toMatchObject({
      code: 'PLUGIN_CAPABILITY_PERMISSION_MISSING',
      details: { permission: Permission.AiGenerate },
    });
  });

  it('does not charge usage or credits when no provider is configured', async () => {
    const usageRecords: UsageRecord[] = [];
    const consume = vi.fn<PluginCreditsHost['consume']>();
    const context = createContext({
      usageRecords,
      creditsHost: { consume },
    });

    await expect(context.ai.generateText({ prompt: 'hello' })).rejects.toMatchObject({
      code: 'PLUGIN_AI_PROVIDER_UNCONFIGURED',
      statusCode: 503,
    });
    expect(usageRecords).toEqual([]);
    expect(consume).not.toHaveBeenCalled();
  });

  it('rejects empty prompts and non-namespaced meters', async () => {
    const context = createContext({
      host: {
        async generateText(_scope, input) {
          return { text: 'ok', model: input.model };
        },
      },
    });

    await expect(context.ai.generateText({ prompt: '   ' })).rejects.toMatchObject({
      code: 'PLUGIN_AI_INPUT_INVALID',
    });
    await expect(
      context.ai.generateText({ prompt: 'ok', meter: 'other.generate' })
    ).rejects.toMatchObject({
      code: 'PLUGIN_CAPABILITY_NAMESPACE_INVALID',
    });
  });
});

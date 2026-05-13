import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Permission,
  type PluginDefinition,
  type PermissionValue,
  type PluginContext,
} from '@ploykit/plugin-sdk';
import { normalizePluginRuntimeContract } from '../../contract';
import type { PluginRuntimeMapEntry } from '../../loader';
import { pluginRuntimeRegistry } from '../../registry';
import type { PluginWebhookReceiptWriter } from '../../capabilities';
import { handlePluginWebhookRuntime } from '../webhook-adapter.server';

vi.mock('@/lib/plugins/plugin-query.server', () => ({
  pluginQueryService: {
    isEnabled: vi.fn(),
  },
}));

import { pluginQueryService } from '@/lib/plugins/plugin-query.server';

type WebhookReceiptParams = Parameters<PluginWebhookReceiptWriter>[0];

function createEntry(options: {
  permissions?: readonly PermissionValue[];
  webhookModules?: PluginRuntimeMapEntry['webhookModules'];
}): PluginRuntimeMapEntry {
  const definition: PluginDefinition = {
    id: 'runtime-webhook',
    name: 'Runtime Webhook',
    version: '1.0.0',
    permissions: options.permissions ?? [Permission.WebhookReceive],
    webhooks: {
      ingest: {
        path: '/ingest',
        handler: './webhooks/ingest',
        methods: ['POST'],
        signature: 'none',
      },
    },
  };
  const contract = normalizePluginRuntimeContract(definition);

  return {
    runtimeContract: contract,
    webhookModules: options.webhookModules,
  };
}

function createRequest(body: unknown = { id: 'evt_1' }): Request {
  return new Request('https://test.local/api/plugins/runtime-webhook/webhooks/ingest', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describe('plugin webhook runtime', () => {
  beforeEach(() => {
    pluginRuntimeRegistry.clear();
    vi.clearAllMocks();
  });

  it('dispatches a declared webhook handler and writes a receipt through ctx.webhooks.verify', async () => {
    const receipts: WebhookReceiptParams[] = [];
    const updateReceipt = vi.fn().mockResolvedValue(undefined);
    const writeReceipt: PluginWebhookReceiptWriter = async (params) => {
      receipts.push(params);
      return {
        id: 'receipt-1',
        status: params.status,
        createdAt: new Date('2026-05-08T00:00:00Z'),
      };
    };
    const entry = createEntry({
      webhookModules: {
        'webhooks/ingest': async () => ({
          default: async (ctx: PluginContext) => {
            const verification = (await ctx.webhooks.verify('none')) as {
              verified: boolean;
              receiptId: string;
            };

            return ctx.json(
              {
                pluginId: ctx.plugin.id,
                verified: verification.verified,
                receiptId: verification.receiptId,
              },
              { status: 202 }
            );
          },
        }),
      },
    });

    const response = await handlePluginWebhookRuntime(
      createRequest(),
      'runtime-webhook',
      ['ingest'],
      {
        entry,
        webhooks: {
          writeReceipt,
        },
        updateReceipt,
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(202);
    expect(payload).toEqual({
      pluginId: 'runtime-webhook',
      verified: true,
      receiptId: 'receipt-1',
    });
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      provider: 'custom',
      eventId: 'evt_1',
      eventType: 'runtime-webhook.webhook',
      status: 'received',
      payload: {
        pluginRuntime: {
          pluginId: 'runtime-webhook',
          webhook: 'ingest',
          localPath: '/ingest',
          method: 'POST',
          handler: './webhooks/ingest',
          verified: true,
        },
      },
    });
    expect(updateReceipt).toHaveBeenCalledWith(
      'receipt-1',
      'processed',
      expect.objectContaining({
        internalEvents: ['runtime-webhook.webhook.ingest'],
      })
    );
  });

  it('marks a verified receipt failed when the webhook handler throws', async () => {
    const updateReceipt = vi.fn().mockResolvedValue(undefined);
    const entry = createEntry({
      webhookModules: {
        'webhooks/ingest': async () => ({
          default: async (ctx: PluginContext) => {
            await ctx.webhooks.verify('none');
            throw new Error('handler exploded');
          },
        }),
      },
    });

    const response = await handlePluginWebhookRuntime(
      createRequest(),
      'runtime-webhook',
      ['ingest'],
      {
        entry,
        webhooks: {
          writeReceipt: async (params) => ({
            id: 'receipt-2',
            status: params.status,
            createdAt: new Date('2026-05-08T00:00:00Z'),
          }),
        },
        updateReceipt,
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.code).toBe('PLUGIN_WEBHOOK_RUNTIME_ERROR');
    expect(updateReceipt).toHaveBeenCalledWith(
      'receipt-2',
      'failed',
      expect.objectContaining({
        error: 'handler exploded',
      })
    );
  });

  it('creates a fallback processed receipt when a handler does not call verify', async () => {
    const receipts: WebhookReceiptParams[] = [];
    const entry = createEntry({
      webhookModules: {
        'webhooks/ingest': async () => ({
          default: async (ctx: PluginContext) => ctx.webhooks.respondAccepted(),
        }),
      },
    });

    const response = await handlePluginWebhookRuntime(
      createRequest(),
      'runtime-webhook',
      ['ingest'],
      {
        entry,
        webhooks: {
          writeReceipt: async (params) => {
            receipts.push(params);
            return {
              id: 'receipt-fallback',
              status: params.status,
              createdAt: new Date('2026-05-08T00:00:00Z'),
            };
          },
        },
        updateReceipt: vi.fn().mockResolvedValue(undefined),
      }
    );

    expect(response.status).toBe(202);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      eventId: 'evt_1',
      status: 'processed',
      payload: {
        pluginRuntime: {
          pluginId: 'runtime-webhook',
          webhook: 'ingest',
        },
      },
    });
  });

  it('rejects webhook routes when the plugin lacks Permission.WebhookReceive', async () => {
    const entry = createEntry({
      permissions: [],
      webhookModules: {
        'webhooks/ingest': async () => ({ default: async () => new Response(null) }),
      },
    });

    const response = await handlePluginWebhookRuntime(
      createRequest(),
      'runtime-webhook',
      ['ingest'],
      { entry }
    );
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toMatchObject({
      success: false,
      code: 'PLUGIN_PERMISSION_MISSING',
      error: {
        details: {
          missing: [Permission.WebhookReceive],
        },
      },
    });
  });

  it('blocks webhook runtime before loading handlers or receipts when the plugin is disabled', async () => {
    vi.mocked(pluginQueryService.isEnabled).mockResolvedValue(false);
    const receipts: WebhookReceiptParams[] = [];
    const updateReceipt = vi.fn().mockResolvedValue(undefined);
    const entry = createEntry({
      webhookModules: {
        'webhooks/ingest': async () => ({
          default: async () => new Response(null, { status: 202 }),
        }),
      },
    });
    const webhookModuleLoader = vi.spyOn(entry.webhookModules!, 'webhooks/ingest');

    const response = await handlePluginWebhookRuntime(
      createRequest(),
      'runtime-webhook',
      ['ingest'],
      {
        entry,
        enforceInstallation: true,
        webhooks: {
          writeReceipt: async (params) => {
            receipts.push(params);
            return {
              id: 'receipt-blocked',
              status: params.status,
              createdAt: new Date('2026-05-08T00:00:00Z'),
            };
          },
        },
        updateReceipt,
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toMatchObject({
      success: false,
      code: 'PLUGIN_DISABLED',
      error: {
        details: {
          pluginId: 'runtime-webhook',
        },
      },
    });
    expect(webhookModuleLoader).not.toHaveBeenCalled();
    expect(receipts).toEqual([]);
    expect(updateReceipt).not.toHaveBeenCalled();
  });

  it('returns a structured error when the declared webhook handler is missing', async () => {
    const response = await handlePluginWebhookRuntime(
      createRequest(),
      'runtime-webhook',
      ['ingest'],
      { entry: createEntry({}) }
    );
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toMatchObject({
      success: false,
      code: 'PLUGIN_WEBHOOK_HANDLER_NOT_FOUND',
      error: {
        details: {
          pluginId: 'runtime-webhook',
          webhook: 'ingest',
          handler: './webhooks/ingest',
        },
      },
    });
  });
});

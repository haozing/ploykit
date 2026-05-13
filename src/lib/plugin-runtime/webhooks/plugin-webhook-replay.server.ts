import type { WebhookProcessResult } from '@/lib/webhooks/types';
import { handlePluginWebhookRuntime, type PluginWebhookReceiptMetadata } from '../adapters';
import { pluginRuntimeRegistry } from '../registry';

export interface PluginWebhookReplayReceipt {
  id: string;
  eventType: string;
  payload: unknown;
  headers: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeHeaders(headers: unknown): Record<string, string> {
  if (!isRecord(headers)) {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      normalized[key] = value;
    }
  }

  return normalized;
}

function normalizeLocalPath(path: string): string {
  const normalized = `/${path.trim()}`.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
  return normalized === '' ? '/' : normalized;
}

function splitLocalPath(path: string): string[] {
  const normalized = normalizeLocalPath(path);
  return normalized === '/' ? [] : normalized.split('/').filter(Boolean);
}

function methodAllowsBody(method: string): boolean {
  const normalized = method.toUpperCase();
  return normalized !== 'GET' && normalized !== 'HEAD';
}

function getRawPayload(payload: unknown): string {
  if (!isRecord(payload)) {
    return '';
  }

  return typeof payload.raw === 'string' ? payload.raw : '';
}

async function getResponseError(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (text) {
      return `Plugin webhook handler returned HTTP ${response.status}: ${text.slice(0, 500)}`;
    }
  } catch {
    // Best-effort diagnostics only.
  }

  return `Plugin webhook handler returned HTTP ${response.status}.`;
}

export function getPluginWebhookReceiptMetadata(
  payload: unknown
): PluginWebhookReceiptMetadata | null {
  if (!isRecord(payload) || !isRecord(payload.pluginRuntime)) {
    return null;
  }

  const metadata = payload.pluginRuntime;
  if (
    typeof metadata.pluginId !== 'string' ||
    typeof metadata.webhook !== 'string' ||
    typeof metadata.localPath !== 'string' ||
    typeof metadata.method !== 'string' ||
    typeof metadata.handler !== 'string'
  ) {
    return null;
  }

  return {
    pluginId: metadata.pluginId,
    webhook: metadata.webhook,
    localPath: normalizeLocalPath(metadata.localPath),
    method: metadata.method.toUpperCase(),
    handler: metadata.handler,
    verified: metadata.verified === true,
  };
}

export function isPluginWebhookReceipt(receipt: PluginWebhookReplayReceipt): boolean {
  return Boolean(getPluginWebhookReceiptMetadata(receipt.payload));
}

export async function processPluginWebhookReceipt(
  receipt: PluginWebhookReplayReceipt
): Promise<WebhookProcessResult> {
  const startTime = Date.now();
  const metadata = getPluginWebhookReceiptMetadata(receipt.payload);

  if (!metadata) {
    return {
      success: false,
      events: [],
      error: 'Webhook receipt does not contain plugin runtime metadata.',
      processingTime: Date.now() - startTime,
    };
  }

  let verificationStatus: string | undefined;
  let verificationError: string | undefined;
  const rawPayload = getRawPayload(receipt.payload);
  const entry = pluginRuntimeRegistry.getEntry(metadata.pluginId);
  const request = new Request(
    `https://plugin-runtime.local/api/plugins/${metadata.pluginId}/webhooks${metadata.localPath}`,
    {
      method: metadata.method,
      headers: normalizeHeaders(receipt.headers),
      body: methodAllowsBody(metadata.method) ? rawPayload : undefined,
    }
  );

  const response = await handlePluginWebhookRuntime(
    request,
    metadata.pluginId,
    splitLocalPath(metadata.localPath),
    {
      recordProcessing: false,
      entry: entry ?? undefined,
      webhooks: {
        writeReceipt: async (params) => {
          if (metadata.verified) {
            verificationStatus = 'received';

            return {
              id: receipt.id,
              status: 'received',
              createdAt: new Date(),
            };
          }

          verificationStatus = params.status;
          verificationError = params.error;

          return {
            id: receipt.id,
            status: params.status,
            createdAt: new Date(),
          };
        },
      },
    }
  );
  const processingTime = Date.now() - startTime;

  if (verificationStatus === 'failed') {
    return {
      success: false,
      events: [],
      error: verificationError ?? 'Plugin webhook signature verification failed.',
      processingTime,
    };
  }

  if (!response.ok) {
    return {
      success: false,
      events: [],
      error: await getResponseError(response),
      processingTime,
    };
  }

  return {
    success: true,
    events: [`${metadata.pluginId}.webhook.${metadata.webhook}`],
    processingTime,
  };
}

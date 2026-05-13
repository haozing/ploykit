import {
  Permission,
  PluginError,
  type PermissionValue,
  type PluginContext,
  type PluginHttpMethod,
  type PluginWebhookDefinition,
} from '@ploykit/plugin-sdk';
import {
  createWebhookLog,
  updateWebhookLog,
  type LogWebhookParams,
} from '@/lib/webhooks/webhook-logger';
import type { WebhookStatus } from '@/lib/webhooks/types';
import { matchRuntimePath, normalizeRuntimeMethod, normalizeRuntimePath } from '../contract';
import {
  getPluginRuntimeMapEntry,
  resolvePluginWebhookModule,
  type PluginRuntimeMapEntry,
} from '../loader';
import { pluginRuntimeRegistry } from '../registry';
import { createPluginRuntimeContext, enforcePluginPermissions } from '../context';
import { enforcePluginRuntimeEnabled } from '../registry';
import type { CreatePluginWebhooksOptions, PluginWebhookReceiptWriter } from '../capabilities';

type PluginWebhookHandler = (context: PluginContext) => Response | void | Promise<Response | void>;

export interface PluginWebhookRuntimeOptions {
  entry?: PluginRuntimeMapEntry;
  requiredPermissions?: readonly PermissionValue[];
  enforceInstallation?: boolean;
  webhooks?: CreatePluginWebhooksOptions;
  recordProcessing?: boolean;
  updateReceipt?: PluginWebhookReceiptUpdater;
}

export interface PluginWebhookRuntimeMatch {
  name: string;
  webhook: PluginWebhookDefinition;
  localPath: string;
}

export interface PluginWebhookReceiptMetadata {
  pluginId: string;
  webhook: string;
  localPath: string;
  method: string;
  handler: string;
  verified?: boolean;
}

export interface PluginWebhookReceiptUpdater {
  (
    webhookLogId: string,
    status: Exclude<WebhookStatus, 'received'>,
    updates?: {
      internalEvents?: string[];
      error?: string;
      processingTime?: number;
      retryCount?: number;
    }
  ): Promise<void>;
}

const DEFAULT_WEBHOOK_METHODS: readonly PluginHttpMethod[] = ['POST'];

function jsonError(error: unknown): Response {
  if (error instanceof PluginError) {
    return Response.json(error.toJSON(), { status: error.statusCode });
  }

  const message = error instanceof Error ? error.message : String(error);
  return Response.json(
    {
      success: false,
      code: 'PLUGIN_WEBHOOK_RUNTIME_ERROR',
      error: {
        name: error instanceof Error ? error.name : 'Error',
        message,
        statusCode: 500,
      },
    },
    { status: 500 }
  );
}

function bodyCanBeReplayed(method: string): boolean {
  const normalizedMethod = method.toUpperCase();
  return normalizedMethod !== 'GET' && normalizedMethod !== 'HEAD';
}

function toRecordPayload(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return { ...(payload as Record<string, unknown>) };
  }

  return { value: payload };
}

function enrichReceiptPayload(
  payload: unknown,
  metadata: PluginWebhookReceiptMetadata,
  options: { verified?: boolean } = {}
): Record<string, unknown> {
  return {
    ...toRecordPayload(payload),
    pluginRuntime: {
      ...metadata,
      ...(typeof options.verified === 'boolean' ? { verified: options.verified } : {}),
    },
  };
}

function readEventId(payload: string): string | undefined {
  try {
    const parsed = JSON.parse(payload) as { id?: unknown };
    return typeof parsed.id === 'string' ? parsed.id : undefined;
  } catch {
    return undefined;
  }
}

async function createFallbackReceipt(
  request: Request,
  metadata: PluginWebhookReceiptMetadata,
  status: WebhookStatus,
  error?: string,
  writer: PluginWebhookReceiptWriter = createWebhookLog
): Promise<{ id: string; status: string; createdAt: Date }> {
  const payload = bodyCanBeReplayed(request.method) ? await request.clone().text() : '';

  return writer({
    provider: 'custom',
    eventId: readEventId(payload),
    eventType: `${metadata.pluginId}.webhook`,
    payload: enrichReceiptPayload(payload ? { raw: payload } : {}, metadata),
    signature:
      request.headers.get('x-ploykit-signature') ??
      request.headers.get('x-hub-signature-256') ??
      request.headers.get('stripe-signature') ??
      undefined,
    headers: Object.fromEntries(request.headers.entries()),
    status,
    error,
  });
}

function createReceiptWriter(
  baseWriter: PluginWebhookReceiptWriter | undefined,
  metadata: PluginWebhookReceiptMetadata,
  onReceipt: (receipt: {
    id: string;
    status: WebhookStatus;
    error?: string;
    createdAt: Date;
  }) => void
): PluginWebhookReceiptWriter {
  const writer = baseWriter ?? createWebhookLog;

  return async (params: LogWebhookParams) => {
    const receipt = await writer({
      ...params,
      payload: enrichReceiptPayload(params.payload, metadata, {
        verified: params.status === 'received',
      }),
    });

    onReceipt({
      id: receipt.id,
      status: params.status,
      error: params.error,
      createdAt: receipt.createdAt,
    });

    return receipt;
  };
}

function getResponseError(response: Response): string {
  return `Plugin webhook handler returned HTTP ${response.status}.`;
}

function webhookAllowsMethod(webhook: PluginWebhookDefinition, method: string): boolean {
  const normalizedMethod = normalizeRuntimeMethod(method);
  const methods = webhook.methods?.length ? webhook.methods : DEFAULT_WEBHOOK_METHODS;

  return methods.includes(normalizedMethod);
}

function findPluginWebhook(
  webhooks: Readonly<Record<string, PluginWebhookDefinition>>,
  localPath: string,
  method: string
): PluginWebhookRuntimeMatch | null {
  for (const [name, webhook] of Object.entries(webhooks)) {
    if (webhookAllowsMethod(webhook, method) && matchRuntimePath(webhook.path, localPath)) {
      return {
        name,
        webhook,
        localPath,
      };
    }
  }

  return null;
}

function extractWebhookHandler(module: unknown, webhookName: string): PluginWebhookHandler {
  if (typeof module === 'function') {
    return module as PluginWebhookHandler;
  }

  if (module && typeof module === 'object') {
    const mod = module as Record<string, unknown>;
    const candidate = mod.default ?? mod.handler ?? mod[webhookName];

    if (typeof candidate === 'function') {
      return candidate as PluginWebhookHandler;
    }
  }

  throw new PluginError({
    code: 'PLUGIN_WEBHOOK_HANDLER_INVALID',
    message: `Plugin webhook "${webhookName}" does not export a handler function.`,
    statusCode: 500,
    fix: 'Export a default handler function from the declared webhook handler module.',
  });
}

export async function matchPluginWebhookRuntimeRoute(
  pluginId: string,
  slug: readonly string[],
  method: string,
  options: PluginWebhookRuntimeOptions = {}
): Promise<PluginWebhookRuntimeMatch> {
  const entry = options.entry ?? getPluginRuntimeMapEntry(pluginId);
  const contract = await pluginRuntimeRegistry.getOrLoad(pluginId, entry);
  const localPath = normalizeRuntimePath(slug.join('/'));
  const match = findPluginWebhook(contract.webhooks, localPath, method);

  if (!match) {
    throw new PluginError({
      code: 'PLUGIN_WEBHOOK_ROUTE_NOT_FOUND',
      message: `No plugin webhook route matches ${method.toUpperCase()} ${localPath}.`,
      statusCode: 404,
      details: {
        pluginId,
        localPath,
      },
    });
  }

  return match;
}

export async function handlePluginWebhookRuntime(
  request: Request,
  pluginId: string,
  slug: readonly string[],
  options: PluginWebhookRuntimeOptions = {}
): Promise<Response> {
  try {
    const startedAt = Date.now();
    const entry = options.entry ?? getPluginRuntimeMapEntry(pluginId);
    await enforcePluginRuntimeEnabled(pluginId, {
      enforce: options.enforceInstallation ?? !options.entry,
    });
    const contract = await pluginRuntimeRegistry.getOrLoad(pluginId, entry);
    const { name, webhook, localPath } = await matchPluginWebhookRuntimeRoute(
      pluginId,
      slug,
      request.method,
      {
        ...options,
        entry: entry ?? undefined,
      }
    );

    enforcePluginPermissions(contract, [
      Permission.WebhookReceive,
      ...(options.requiredPermissions ?? []),
    ]);

    const moduleLoader = entry ? resolvePluginWebhookModule(entry, webhook.handler) : null;
    if (!moduleLoader) {
      throw new PluginError({
        code: 'PLUGIN_WEBHOOK_HANDLER_NOT_FOUND',
        message: `Webhook handler "${webhook.handler}" was not found for plugin "${pluginId}".`,
        statusCode: 500,
        fix: 'Run npm run plugins:scan and ensure the handler path exists inside the plugin.',
        details: {
          pluginId,
          webhook: name,
          handler: webhook.handler,
        },
      });
    }

    const handler = extractWebhookHandler(await moduleLoader(), name);
    const receiptRequest = request.clone();
    const metadata: PluginWebhookReceiptMetadata = {
      pluginId,
      webhook: name,
      localPath,
      method: request.method.toUpperCase(),
      handler: webhook.handler,
    };
    let receipt:
      | {
          id: string;
          status: WebhookStatus;
          error?: string;
        }
      | undefined;
    const updateReceipt = options.updateReceipt ?? updateWebhookLog;
    const recordProcessing = options.recordProcessing !== false;
    const context = createPluginRuntimeContext({
      contract,
      request,
      user: null,
      system: true,
      capabilities: {
        webhooks: {
          ...options.webhooks,
          writeReceipt: createReceiptWriter(
            options.webhooks?.writeReceipt,
            metadata,
            (createdReceipt) => {
              receipt = {
                id: createdReceipt.id,
                status: createdReceipt.status,
                error: createdReceipt.error,
              };
            }
          ),
        },
      },
    });

    try {
      const response = (await handler(context)) ?? context.webhooks.respondAccepted();
      const processingTime = Date.now() - startedAt;

      if (!receipt && recordProcessing) {
        const fallbackReceipt = await createFallbackReceipt(
          receiptRequest,
          metadata,
          'processed',
          undefined,
          options.webhooks?.writeReceipt
        );
        receipt = {
          id: fallbackReceipt.id,
          status: 'processed',
        };
      }

      if (receipt && recordProcessing) {
        if (response.ok && receipt.status === 'received') {
          await updateReceipt(receipt.id, 'processed', {
            internalEvents: [`${pluginId}.webhook.${name}`],
            processingTime,
          });
        } else if (!response.ok) {
          await updateReceipt(receipt.id, 'failed', {
            error: getResponseError(response),
            processingTime,
          });
        }
      }

      return response;
    } catch (handlerError) {
      const processingTime = Date.now() - startedAt;
      const errorMessage =
        handlerError instanceof Error ? handlerError.message : String(handlerError);

      if (!receipt && recordProcessing) {
        const fallbackReceipt = await createFallbackReceipt(
          receiptRequest,
          metadata,
          'failed',
          errorMessage,
          options.webhooks?.writeReceipt
        );
        receipt = {
          id: fallbackReceipt.id,
          status: 'failed',
          error: errorMessage,
        };
      } else if (receipt && recordProcessing) {
        await updateReceipt(receipt.id, 'failed', {
          error: errorMessage,
          processingTime,
        });
      }

      throw handlerError;
    }
  } catch (error) {
    return jsonError(error);
  }
}

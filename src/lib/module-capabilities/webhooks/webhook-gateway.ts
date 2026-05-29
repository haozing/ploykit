import type { ModuleContext, ModuleWebhookDefinition } from '@ploykit/module-sdk';
import { readModuleDefaultExport } from '../../module-runtime/adapters';
import {
  createModuleBackgroundContext,
  type ModuleBackgroundContextCapabilities,
} from '../../module-runtime/context';
import type { ModuleRuntimeContract } from '../../module-runtime/contract';
import type { ModuleRuntimeHost } from '../../module-runtime/host/module-runtime-host';
import { compileModuleRoutePath, matchModuleRoutePath } from '../../module-runtime/routes';
import type { ModuleRuntimeAccessSession } from '../../module-runtime/security';
import {
  createInMemoryModuleWebhookReceiptStore,
  type ModuleWebhookReceipt,
  type ModuleWebhookReceiptStore,
} from './webhook-receipts';
import {
  githubWebhookSignatureProvider,
  hmacSha256WebhookSignatureProvider,
  stripeWebhookSignatureProvider,
  type WebhookSignatureProvider,
} from './signature-providers';

export interface ModuleWebhookEvent<TBody = unknown> {
  request: Request;
  params: Record<string, string>;
  receipt: ModuleWebhookReceipt;
  bodyText: string;
  json<T = TBody>(): Promise<T>;
}

export type ModuleWebhookHandler<TBody = unknown> = (
  ctx: ModuleContext,
  event: ModuleWebhookEvent<TBody>
) => Response | unknown | Promise<Response | unknown>;

export type ModuleWebhookSecretResolver = (input: {
  moduleId: string;
  webhookName: string;
}) => string | Promise<string>;

export interface DispatchModuleWebhookInput {
  request: Request;
  moduleId?: string;
  pathname?: string;
  session?: ModuleRuntimeAccessSession;
}

export interface CreateModuleWebhookGatewayOptions {
  receipts?: ModuleWebhookReceiptStore;
  secretResolver?: ModuleWebhookSecretResolver;
  session?: ModuleRuntimeAccessSession;
  capabilities?: ModuleBackgroundContextCapabilities;
}

export interface ModuleWebhookGateway {
  receipts: ModuleWebhookReceiptStore;
  dispatch(input: DispatchModuleWebhookInput): Promise<Response>;
}

interface MatchedWebhook {
  contract: ModuleRuntimeContract;
  name: string;
  definition: ModuleWebhookDefinition;
  params: Record<string, string>;
}

const WEBHOOK_SIGNATURE_PROVIDERS: Record<string, WebhookSignatureProvider> = {
  'hmac-sha256': hmacSha256WebhookSignatureProvider,
  github: githubWebhookSignatureProvider,
  stripe: stripeWebhookSignatureProvider,
};

function normalizeModulePath(value: string): string {
  return value.replace(/^\.\//, '');
}

function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

function asWebhookHandler(value: unknown): ModuleWebhookHandler | null {
  const exported = readModuleDefaultExport(value);
  if (typeof exported === 'function') {
    return exported as ModuleWebhookHandler;
  }
  if (exported && typeof exported === 'object' && 'handle' in exported) {
    const handle = (exported as { handle?: unknown }).handle;
    return typeof handle === 'function' ? (handle as ModuleWebhookHandler) : null;
  }
  return null;
}

function allowedMethods(definition: ModuleWebhookDefinition): readonly string[] {
  return definition.methods ?? ['POST'];
}

function readPathname(request: Request, pathname?: string): string {
  return pathname ?? new URL(request.url).pathname;
}

function findWebhook(
  host: ModuleRuntimeHost,
  pathname: string,
  moduleId?: string
): MatchedWebhook | null {
  for (const contract of host.contracts) {
    if (moduleId && contract.id !== moduleId) {
      continue;
    }

    for (const [name, definition] of Object.entries(contract.webhooks)) {
      const match = matchModuleRoutePath(compileModuleRoutePath(definition.path), pathname);
      if (match) {
        return {
          contract,
          name,
          definition,
          params: match.params,
        };
      }
    }
  }
  return null;
}

function extractSignature(request: Request, provider?: string): string | undefined {
  const generic =
    request.headers.get('x-ploykit-signature') ?? request.headers.get('x-signature') ?? undefined;
  const github = request.headers.get('x-hub-signature-256') ?? undefined;
  if (provider === 'github') {
    return github ?? generic;
  }
  if (provider === 'stripe') {
    return request.headers.get('stripe-signature') ?? generic;
  }
  return generic ?? github;
}

async function verifySignature(input: {
  request: Request;
  bodyText: string;
  matched: MatchedWebhook;
  secretResolver?: ModuleWebhookSecretResolver;
}): Promise<{ ok: true } | { ok: false; status: number; code: string; message: string }> {
  const signature = input.matched.definition.signature ?? 'none';
  if (signature === 'none') {
    return { ok: true };
  }

  const provider = WEBHOOK_SIGNATURE_PROVIDERS[signature];
  if (!provider) {
    return {
      ok: false,
      status: 400,
      code: 'MODULE_WEBHOOK_SIGNATURE_UNSUPPORTED',
      message: `Webhook signature "${signature}" is not supported.`,
    };
  }

  const provided = extractSignature(input.request, signature);
  if (!provided) {
    return {
      ok: false,
      status: 401,
      code: 'MODULE_WEBHOOK_SIGNATURE_REQUIRED',
      message: 'Webhook signature is required.',
    };
  }

  const secret = await input.secretResolver?.({
    moduleId: input.matched.contract.id,
    webhookName: input.matched.name,
  });
  if (!secret) {
    return {
      ok: false,
      status: 500,
      code: 'MODULE_WEBHOOK_SECRET_MISSING',
      message: 'Webhook secret is not configured.',
    };
  }

  if (!provider.verify({ bodyText: input.bodyText, signature: provided, secret })) {
    return {
      ok: false,
      status: 401,
      code: 'MODULE_WEBHOOK_SIGNATURE_INVALID',
      message: 'Webhook signature is invalid.',
    };
  }

  return { ok: true };
}

function cloneRequestWithBody(request: Request, bodyText: string): Request {
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: ['GET', 'HEAD'].includes(request.method.toUpperCase()) ? undefined : bodyText,
  });
}

export function createModuleWebhookGateway(
  host: ModuleRuntimeHost,
  options: CreateModuleWebhookGatewayOptions = {}
): ModuleWebhookGateway {
  const receipts = options.receipts ?? createInMemoryModuleWebhookReceiptStore();

  return {
    receipts,
    async dispatch(input) {
      const pathname = readPathname(input.request, input.pathname);
      const matched = findWebhook(host, pathname, input.moduleId);
      if (!matched) {
        return json({ ok: false, code: 'MODULE_WEBHOOK_NOT_FOUND' }, { status: 404 });
      }

      if (!allowedMethods(matched.definition).includes(input.request.method as never)) {
        return json(
          {
            ok: false,
            code: 'MODULE_WEBHOOK_METHOD_NOT_ALLOWED',
          },
          {
            status: 405,
            headers: {
              allow: allowedMethods(matched.definition).join(', '),
            },
          }
        );
      }

      const idempotencyKey =
        input.request.headers.get('idempotency-key') ??
        input.request.headers.get('x-ploykit-idempotency-key') ??
        undefined;
      const existingReceipt = idempotencyKey
        ? receipts.findByIdempotencyKey(matched.contract.id, matched.name, idempotencyKey)
        : null;
      if (existingReceipt?.status === 'processed' || existingReceipt?.status === 'duplicate') {
        receipts.markDuplicate(existingReceipt.id);
        return json({ ok: true, duplicate: true, receiptId: existingReceipt.id });
      }

      const signature = extractSignature(input.request, matched.definition.signature);
      const receipt = receipts.create({
        moduleId: matched.contract.id,
        webhookName: matched.name,
        path: matched.definition.path,
        method: input.request.method,
        idempotencyKey,
        signature,
      });
      const bodyText = await input.request.text();
      const signatureResult = await verifySignature({
        request: input.request,
        bodyText,
        matched,
        secretResolver: options.secretResolver,
      });
      if (!signatureResult.ok) {
        receipts.markRejected(receipt.id, signatureResult.message);
        return json(
          {
            ok: false,
            code: signatureResult.code,
            message: signatureResult.message,
            receiptId: receipt.id,
          },
          { status: signatureResult.status }
        );
      }

      try {
        receipts.markProcessing(receipt.id);
        const entry = host.getMapEntry(matched.contract.id);
        const loader = entry?.webhooks?.[normalizeModulePath(matched.definition.handler)];
        if (!loader) {
          throw new Error(`MODULE_WEBHOOK_HANDLER_MISSING: ${matched.definition.handler}`);
        }
        const handler = asWebhookHandler(await loader());
        if (!handler) {
          throw new Error(`MODULE_WEBHOOK_HANDLER_INVALID: ${matched.definition.handler}`);
        }

        const handlerRequest = cloneRequestWithBody(input.request, bodyText);
        const ctx = createModuleBackgroundContext({
          host,
          contract: matched.contract,
          request: handlerRequest,
          params: matched.params,
          session: input.session ?? options.session,
          capabilities: options.capabilities,
        });
        const event: ModuleWebhookEvent = {
          request: handlerRequest,
          params: matched.params,
          receipt,
          bodyText,
          async json() {
            return JSON.parse(bodyText);
          },
        };
        const response = await handler(ctx, event);
        receipts.markProcessed(receipt.id);
        return response instanceof Response
          ? response
          : json(response ?? { ok: true, receiptId: receipt.id });
      } catch (error) {
        receipts.markFailed(receipt.id, error instanceof Error ? error : String(error));
        return json(
          {
            ok: false,
            code: 'MODULE_WEBHOOK_HANDLER_FAILED',
            message: error instanceof Error ? error.message : String(error),
            receiptId: receipt.id,
          },
          { status: 500 }
        );
      }
    },
  };
}

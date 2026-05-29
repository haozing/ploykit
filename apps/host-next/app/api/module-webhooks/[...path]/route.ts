import type { ModuleRuntimeHost } from '@/lib/module-runtime/host/module-runtime-host';
import {
  compileModuleRoutePath,
  matchModuleRoutePath,
} from '@/lib/module-runtime/routes/route-pattern';
import { createRuntimeStoreWebhookGateway } from '@/lib/module-capabilities/webhooks/runtime-store-webhook-gateway';
import { getHostRuntime } from '@host/lib/create-host';
import {
  DEFAULT_HOST_PRODUCT_ID,
  DEFAULT_HOST_WORKSPACE_ID,
} from '@host/lib/default-scope';
import { modulePathFromSegments } from '@host/lib/paths';
import { checkHostRouteSecurity } from '@host/lib/security';

interface ModuleWebhookRouteContext {
  params: Promise<{
    path?: string[];
  }>;
}

function findWebhook(host: ModuleRuntimeHost, pathname: string) {
  for (const contract of host.contracts) {
    for (const [webhookName, webhook] of Object.entries(contract.webhooks)) {
      const match = matchModuleRoutePath(compileModuleRoutePath(webhook.path), pathname);
      if (match) {
        return { contract, webhookName, webhook };
      }
    }
  }
  return null;
}

function readIdempotencyKey(request: Request, signature: string | undefined): string | undefined {
  const generic =
    request.headers.get('idempotency-key') ??
    request.headers.get('x-ploykit-idempotency-key') ??
    undefined;
  if (signature === 'github') {
    return generic ?? request.headers.get('x-github-delivery') ?? undefined;
  }
  return generic;
}

function readSignature(request: Request, signature: string | undefined): string | undefined {
  const generic =
    request.headers.get('x-ploykit-signature') ?? request.headers.get('x-signature') ?? undefined;
  const github = request.headers.get('x-hub-signature-256') ?? undefined;
  if (signature === 'github') {
    return github ?? generic;
  }
  if (signature === 'stripe') {
    return request.headers.get('stripe-signature') ?? generic;
  }
  return generic ?? github;
}

function runtimeStoreSignatureProvider(signature: string | undefined): string {
  return signature ?? 'none';
}

function envNamePart(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function readModuleWebhookSecret(input: { moduleId: string; webhookName: string }): string | null {
  const moduleKey = envNamePart(input.moduleId);
  const webhookKey = envNamePart(input.webhookName);
  const candidates = [
    `PLOYKIT_MODULE_WEBHOOK_SECRET_${moduleKey}_${webhookKey}`,
    `PLOYKIT_MODULE_WEBHOOK_SECRET_${moduleKey}`,
    'PLOYKIT_MODULE_WEBHOOK_SECRET',
  ];
  for (const key of candidates) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return null;
}

function moduleWebhookMaxBodyBytes(): number {
  const configured = Number(process.env.PLOYKIT_MODULE_WEBHOOK_MAX_BODY_BYTES);
  return Number.isFinite(configured) && configured > 0 ? configured : 1024 * 1024;
}

function webhookBodyByteLength(bodyText: string): number {
  return new TextEncoder().encode(bodyText).byteLength;
}

function webhookContentTypeAllowed(request: Request): boolean {
  const header = request.headers.get('content-type');
  if (!header) {
    return true;
  }
  const contentType = header.split(';')[0]?.trim().toLowerCase();
  return Boolean(
    contentType &&
      [
        'application/json',
        'application/octet-stream',
        'application/x-www-form-urlencoded',
        'application/xml',
        'text/plain',
        'text/xml',
      ].includes(contentType)
  );
}

function checkWebhookEnvelope(request: Request): Response | null {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  const maxBodyBytes = moduleWebhookMaxBodyBytes();
  if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
    return Response.json(
      { ok: false, code: 'MODULE_WEBHOOK_BODY_TOO_LARGE', maxBodyBytes },
      { status: 413 }
    );
  }
  if (!webhookContentTypeAllowed(request)) {
    return Response.json(
      { ok: false, code: 'MODULE_WEBHOOK_CONTENT_TYPE_UNSUPPORTED' },
      { status: 415 }
    );
  }
  return null;
}

export async function POST(request: Request, context: ModuleWebhookRouteContext) {
  const securityResponse = await checkHostRouteSecurity(request, 'module.webhook');
  if (securityResponse) {
    return securityResponse;
  }

  const hostRuntime = await getHostRuntime();
  const { path } = await context.params;
  const pathname = modulePathFromSegments(path);
  const matched = findWebhook(hostRuntime.moduleHost.runtime, pathname);
  if (!matched) {
    return Response.json(
      { ok: false, code: 'MODULE_WEBHOOK_ROUTE_NOT_FOUND' },
      { status: 404 }
    );
  }

  if (!(matched.webhook.methods ?? ['POST']).includes('POST')) {
    return Response.json(
      { ok: false, code: 'MODULE_WEBHOOK_METHOD_NOT_ALLOWED' },
      { status: 405 }
    );
  }

  const envelopeResponse = checkWebhookEnvelope(request);
  if (envelopeResponse) {
    return envelopeResponse;
  }

  const bodyText = await request.text();
  const maxBodyBytes = moduleWebhookMaxBodyBytes();
  if (webhookBodyByteLength(bodyText) > maxBodyBytes) {
    return Response.json(
      { ok: false, code: 'MODULE_WEBHOOK_BODY_TOO_LARGE', maxBodyBytes },
      { status: 413 }
    );
  }
  const gateway = createRuntimeStoreWebhookGateway({
    store: hostRuntime.runtimeStore.store,
    productId: DEFAULT_HOST_PRODUCT_ID,
    workspaceId: DEFAULT_HOST_WORKSPACE_ID,
    secretResolver: readModuleWebhookSecret,
  });
  const result = await gateway.receive({
    moduleId: matched.contract.id,
    webhookName: matched.webhookName,
    path: matched.webhook.path,
    method: 'POST',
    bodyText,
    idempotencyKey: readIdempotencyKey(request, matched.webhook.signature),
    signature: readSignature(request, matched.webhook.signature),
    headers: Object.fromEntries(request.headers.entries()),
    signatureProvider: runtimeStoreSignatureProvider(matched.webhook.signature),
  });

  if (result.receipt.status === 'rejected') {
    return Response.json(
      {
        ok: false,
        code: 'MODULE_WEBHOOK_SIGNATURE_REJECTED',
        receipt: result.receipt,
      },
      { status: 401 }
    );
  }

  return Response.json({
    ok: true,
    duplicate: result.duplicate,
    receipt: result.receipt,
  });
}

import { createHmac, timingSafeEqual } from 'crypto';
import { Permission, type PluginWebhooks } from '@ploykit/plugin-sdk';
import { env } from '@/lib/_core/env';
import { createWebhookLog, type LogWebhookParams } from '@/lib/webhooks/webhook-logger';
import type { WebhookProvider } from '@/lib/webhooks/types';
import { enforceCapabilityPermission, type PluginCapabilityScope } from './guards.server';

export interface PluginWebhookReceiptWriter {
  (params: LogWebhookParams): Promise<{ id: string; status: string; createdAt: Date }>;
}

export interface CreatePluginWebhooksOptions {
  writeReceipt?: PluginWebhookReceiptWriter;
  secret?: string;
  signatureHeader?: string;
}

function getHeader(headers: Headers, name: string): string | null {
  return headers.get(name) ?? headers.get(name.toLowerCase());
}

function verifyHmacSignature(payload: string, signature: string, secret: string): boolean {
  const digest = createHmac('sha256', secret).update(payload).digest('hex');
  const normalizedSignature = signature.replace(/^sha256=/, '');

  const left = Buffer.from(digest, 'hex');
  const right = Buffer.from(normalizedSignature, 'hex');

  return left.length === right.length && timingSafeEqual(left, right);
}

function parseStripeSignature(signature: string): { timestamp: string; signatures: string[] } {
  const parts = new Map<string, string[]>();

  for (const segment of signature.split(',')) {
    const [key, value] = segment.split('=', 2);
    if (!key || !value) {
      continue;
    }

    parts.set(key, [...(parts.get(key) ?? []), value]);
  }

  return {
    timestamp: parts.get('t')?.[0] ?? '',
    signatures: parts.get('v1') ?? [],
  };
}

function verifyStripeSignature(payload: string, signature: string, secret: string): boolean {
  const parsed = parseStripeSignature(signature);
  if (!parsed.timestamp || parsed.signatures.length === 0) {
    return false;
  }

  const signedPayload = `${parsed.timestamp}.${payload}`;
  const expected = createHmac('sha256', secret).update(signedPayload).digest('hex');

  return parsed.signatures.some((candidate) => {
    const left = Buffer.from(expected, 'hex');
    const right = Buffer.from(candidate, 'hex');
    return left.length === right.length && timingSafeEqual(left, right);
  });
}

function getPolicyProvider(policy: string): WebhookProvider {
  if (policy === 'stripe') {
    return 'stripe';
  }

  if (policy === 'github') {
    return 'github';
  }

  return 'custom';
}

function getPolicySignatureHeader(policy: string, configuredHeader?: string): string {
  if (configuredHeader) {
    return configuredHeader;
  }

  if (policy === 'stripe') {
    return 'stripe-signature';
  }

  if (policy === 'github') {
    return 'x-hub-signature-256';
  }

  return 'x-ploykit-signature';
}

function getPolicySecret(policy: string, configuredSecret?: string): string | undefined {
  if (configuredSecret) {
    return configuredSecret;
  }

  if (policy === 'stripe') {
    return env.STRIPE_WEBHOOK_SECRET;
  }

  return undefined;
}

function getEventId(policy: string, headers: Headers, payload: string): string | undefined {
  if (policy === 'github') {
    return getHeader(headers, 'x-github-delivery') ?? undefined;
  }

  try {
    const parsed = JSON.parse(payload) as { id?: unknown };
    return typeof parsed.id === 'string' ? parsed.id : undefined;
  } catch {
    return undefined;
  }
}

export function createPluginWebhooksCapability(
  scope: PluginCapabilityScope,
  options: CreatePluginWebhooksOptions = {}
): PluginWebhooks {
  const writeReceipt = options.writeReceipt ?? createWebhookLog;

  return {
    async verify(policy = 'none'): Promise<unknown> {
      enforceCapabilityPermission(scope, Permission.WebhookReceive, 'ctx.webhooks.verify');

      const payload = await scope.request.clone().text();
      const signature = getHeader(
        scope.request.headers,
        getPolicySignatureHeader(policy, options.signatureHeader)
      );
      const provider = getPolicyProvider(policy);
      const secret = getPolicySecret(policy, options.secret);
      let verified = false;
      let reason: string | undefined;

      if (policy === 'none') {
        verified = true;
      } else if (!signature || !secret) {
        reason = `Webhook policy "${policy}" requires a signature header and secret.`;
      } else if (policy === 'hmac-sha256' || policy === 'github') {
        verified = verifyHmacSignature(payload, signature, secret);
      } else if (policy === 'stripe') {
        verified = verifyStripeSignature(payload, signature, secret);
      } else {
        reason = `Webhook policy "${policy}" is not supported by Plugin Runtime.`;
      }

      const receipt = await writeReceipt({
        provider,
        eventId: getEventId(policy, scope.request.headers, payload),
        eventType: `${scope.contract.id}.webhook`,
        payload: payload ? { raw: payload } : {},
        signature: signature ?? undefined,
        headers: Object.fromEntries(scope.request.headers.entries()),
        status: verified ? 'received' : 'failed',
        error: verified ? undefined : (reason ?? 'Webhook signature verification failed.'),
      });

      return {
        verified,
        policy,
        provider,
        receiptId: receipt.id,
        reason: verified ? undefined : (reason ?? 'Webhook signature verification failed.'),
      };
    },

    respondAccepted(): Response {
      enforceCapabilityPermission(scope, Permission.WebhookReceive, 'ctx.webhooks.respondAccepted');

      return Response.json(
        {
          success: true,
          accepted: true,
        },
        { status: 202 }
      );
    },
  };
}

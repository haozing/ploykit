import { createHmac, timingSafeEqual } from 'node:crypto';

export interface WebhookSignatureVerificationInput {
  bodyText: string;
  signature?: string;
  secret: string;
}

export interface WebhookSignatureProvider {
  name: string;
  verify(input: WebhookSignatureVerificationInput): boolean;
}

function normalizeSha256(signature: string | undefined): string | null {
  if (!signature) {
    return null;
  }
  return signature.startsWith('sha256=') ? signature.slice('sha256='.length) : signature;
}

function safeCompareHex(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function verifySha256Hmac(input: WebhookSignatureVerificationInput, payload: string): boolean {
  const provided = normalizeSha256(input.signature);
  if (!provided) {
    return false;
  }
  const expected = createHmac('sha256', input.secret).update(payload).digest('hex');
  return safeCompareHex(provided, expected);
}

function parseStripeSignature(
  signature: string | undefined
): { timestamp: string; signatures: string[] } | null {
  if (!signature) {
    return null;
  }
  const parts = signature.split(',').map((part) => {
    const [key, ...rest] = part.split('=');
    return [key?.trim(), rest.join('=').trim()] as const;
  });
  const timestamp = parts.find(([key]) => key === 't')?.[1];
  const signatures = parts
    .filter(([key, value]) => key === 'v1' && Boolean(value))
    .map(([, value]) => value);
  return timestamp && signatures.length > 0 ? { timestamp, signatures } : null;
}

export const hmacSha256WebhookSignatureProvider: WebhookSignatureProvider = {
  name: 'hmac-sha256',
  verify(input) {
    return verifySha256Hmac(input, input.bodyText);
  },
};

export const githubWebhookSignatureProvider: WebhookSignatureProvider = {
  name: 'github',
  verify(input) {
    return verifySha256Hmac(input, input.bodyText);
  },
};

export const stripeWebhookSignatureProvider: WebhookSignatureProvider = {
  name: 'stripe',
  verify(input) {
    const parsed = parseStripeSignature(input.signature);
    if (!parsed) {
      return false;
    }
    const timestamp = Number(parsed.timestamp);
    if (!Number.isFinite(timestamp)) {
      return false;
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSeconds - timestamp) > 300) {
      return false;
    }
    const expected = createHmac('sha256', input.secret)
      .update(`${parsed.timestamp}.${input.bodyText}`)
      .digest('hex');
    return parsed.signatures.some((signature) => safeCompareHex(signature, expected));
  },
};

export const noneWebhookSignatureProvider: WebhookSignatureProvider = {
  name: 'none',
  verify() {
    return true;
  },
};

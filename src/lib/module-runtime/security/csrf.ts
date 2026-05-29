import { createHmac, timingSafeEqual } from 'node:crypto';

export interface CsrfGuardOptions {
  secret: string;
  allowedOrigins: readonly string[];
}

export interface CsrfCheckInput {
  method: string;
  origin?: string | null;
  token?: string | null;
  sessionId?: string | null;
}

export function createCsrfToken(secret: string, sessionId: string): string {
  const signature = createHmac('sha256', secret).update(sessionId).digest('hex');
  return `${sessionId}.${signature}`;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function createCsrfGuard(options: CsrfGuardOptions): {
  verify(input: CsrfCheckInput): { ok: true } | { ok: false; code: string; message: string };
} {
  const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
  return {
    verify(input) {
      const method = input.method.toUpperCase();
      if (safeMethods.has(method)) {
        return { ok: true };
      }
      if (input.origin && !options.allowedOrigins.includes(input.origin)) {
        return { ok: false, code: 'CSRF_ORIGIN_DENIED', message: 'Request origin is not allowed.' };
      }
      if (!input.token || !input.sessionId) {
        return { ok: false, code: 'CSRF_TOKEN_REQUIRED', message: 'CSRF token is required.' };
      }
      return safeEqual(input.token, createCsrfToken(options.secret, input.sessionId))
        ? { ok: true }
        : { ok: false, code: 'CSRF_TOKEN_INVALID', message: 'CSRF token is invalid.' };
    },
  };
}

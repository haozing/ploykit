import { NextRequest, NextResponse } from 'next/server';
import { applySecurityHeaders } from './security-headers';

export function shouldRejectUnsignedStripeWebhook(request: NextRequest): boolean {
  return (
    request.nextUrl.pathname === '/api/webhooks/stripe' &&
    request.method.toUpperCase() === 'POST' &&
    !request.headers.get('stripe-signature')
  );
}

export function createMissingStripeSignatureResponse(requestId: string): NextResponse {
  const response = NextResponse.json(
    {
      success: false,
      code: 'VAL_001',
      error: {
        code: 'VAL_001',
        message: 'Missing stripe-signature header',
        statusCode: 400,
      },
      requestId,
    },
    { status: 400 }
  );
  response.headers.set('x-request-id', requestId);
  return applySecurityHeaders(response);
}

import { describe, expect, it } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { ValidationError } from '@/lib/_core/errors';
import { ERROR_CODES } from '@/lib/_core/constants';
import { withErrorHandling } from '../api-error-handler';

function createRequest(): NextRequest {
  return new NextRequest('https://app.example.com/api/test', {
    headers: {
      'x-request-id': 'req_test',
    },
  });
}

describe('API error handler', () => {
  it('returns a standard error payload for AppError failures', async () => {
    const handler = withErrorHandling(async () => {
      throw new ValidationError('Name is required', { field: 'name' });
    });

    const response = await handler(createRequest(), { params: Promise.resolve({}) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(response.headers.get('x-request-id')).toBe('req_test');
    expect(payload).toMatchObject({
      success: false,
      code: ERROR_CODES.INVALID_INPUT,
      requestId: 'req_test',
      error: {
        name: 'ValidationError',
        message: 'Name is required',
        code: ERROR_CODES.INVALID_INPUT,
        statusCode: 400,
        details: { field: 'name' },
      },
    });
  });

  it('redacts sensitive AppError details before returning the response', async () => {
    const handler = withErrorHandling(async () => {
      throw new ValidationError('Invalid payload', {
        field: 'name',
        accessToken: 'secret-token',
        nested: {
          payload: { password: 'secret-password' },
          stack: 'internal stack',
        },
      });
    });

    const response = await handler(createRequest(), { params: Promise.resolve({}) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.details).toMatchObject({
      field: 'name',
      accessToken: '[REDACTED]',
      nested: {
        payload: '[REDACTED]',
      },
    });
    expect(payload.error.details.nested).not.toHaveProperty('stack');
  });

  it('keeps successful responses untouched while adding request metadata', async () => {
    const handler = withErrorHandling(async () => {
      return NextResponse.json({ success: true });
    });

    const response = await handler(createRequest(), { params: Promise.resolve({}) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBe('req_test');
    expect(payload).toEqual({ success: true });
  });
});

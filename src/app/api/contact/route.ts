/**
 * Contact API
 *
 * POST /api/contact
 * Body: { name, email, subject, message }
 */

import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, withRateLimit } from '@/lib/middleware';
import { logger } from '@/lib/_core/logger';
import { sanitizeEmail, sanitizeIp } from '@/lib/_core/log-sanitizer';
import { ValidationError } from '@/lib/_core/errors';

function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

const validSubjects = ['support', 'business', 'bug', 'feature', 'other'];

export const POST = withErrorHandling(
  withRateLimit(async (request: NextRequest) => {
    const body = await request.json();
    const { name, email, subject, message } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new ValidationError('Name is required', { field: 'name' });
    }

    if (!email || typeof email !== 'string' || !validateEmail(email)) {
      throw new ValidationError('Valid email is required', { field: 'email' });
    }

    if (!subject || !validSubjects.includes(subject)) {
      throw new ValidationError('Valid subject is required', {
        field: 'subject',
        allowedSubjects: validSubjects,
      });
    }

    if (!message || typeof message !== 'string' || message.trim().length < 10) {
      throw new ValidationError('Message must be at least 10 characters', {
        field: 'message',
        minimumLength: 10,
      });
    }

    // Log sanitized submission (no raw message body, just length)
    logger.info(
      {
        name: name.trim(),
        email: sanitizeEmail(email),
        subject,
        messageLength: message.trim().length,
        ip: sanitizeIp(
          request.headers.get('x-forwarded-for')?.split(',')[0] ||
            request.headers.get('x-real-ip') ||
            'unknown'
        ),
      },
      'Contact form submission'
    );

    return NextResponse.json(
      {
        success: true,
        message: 'Contact form submitted successfully',
      },
      { status: 200 }
    );
  })
);

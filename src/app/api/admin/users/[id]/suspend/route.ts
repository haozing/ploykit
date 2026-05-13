import { NextResponse } from 'next/server';
import { z } from 'zod';

import { suspendUser } from '@/lib/services/user/user-service';
import {
  withAdminGuard,
  withErrorHandling,
  withValidation,
  type AuthContext,
} from '@/lib/middleware';
import { getClientIP } from '@/lib/shared/api-helpers';

const paramsSchema = z.object({
  id: z.string().min(1, 'User ID is required'),
});

const bodySchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const POST = withAdminGuard(
  withErrorHandling(
    withValidation({ params: paramsSchema, body: bodySchema }, async (request, context) => {
      const { auth, validated } = context as typeof context & { auth: AuthContext };
      const user = await suspendUser(
        validated.params!.id,
        auth.userId,
        getClientIP(request),
        validated.body?.reason
      );

      return NextResponse.json({
        success: true,
        user,
      });
    })
  )
);

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { resetUserPassword } from '@/lib/services/user/user-service';
import {
  withAdminGuard,
  withErrorHandling,
  withParamsValidation,
  type AuthContext,
} from '@/lib/middleware';
import { getClientIP } from '@/lib/shared/api-helpers';

const paramsSchema = z.object({
  id: z.string().min(1, 'User ID is required'),
});

export const POST = withAdminGuard(
  withErrorHandling(
    withParamsValidation(paramsSchema, async (request, context) => {
      const { auth, validated } = context as typeof context & { auth: AuthContext };
      const result = await resetUserPassword(
        validated.params!.id,
        auth.userId,
        getClientIP(request)
      );

      return NextResponse.json({
        success: true,
        user: result.user,
        temporaryPassword: result.temporaryPassword,
        message: 'Temporary password is returned once. Ask the user to change it after login.',
      });
    })
  )
);

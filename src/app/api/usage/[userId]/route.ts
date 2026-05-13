import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  withAuth,
  withErrorHandling,
  withParamsValidation,
  type AuthContext,
} from '@/lib/middleware';
import { ForbiddenError, NotFoundError } from '@/lib/_core/errors';
import { isAdmin } from '@/lib/auth/permissions';
import { getUserEntitlement } from '@/lib/services/user/user-entitlement-service';

const paramsSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
});

const readNumber = (source: Record<string, unknown>, ...keys: string[]) => {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return 0;
};

/**
 * GET /api/usage/[userId]
 *
 * Returns normalized usage counters for the usage dashboard.
 * Regular users can only read their own usage; admins can read any user's usage.
 */
export const GET = withAuth(
  withErrorHandling(
    withParamsValidation(paramsSchema, async (_request, context) => {
      const { auth, validated } = context as typeof context & { auth: AuthContext };
      const targetUserId = validated.params!.userId;

      if (targetUserId !== auth.userId && !(await isAdmin(auth.userId))) {
        throw new ForbiddenError('You can only view your own usage.');
      }

      const entitlement = await getUserEntitlement(targetUserId);

      if (!entitlement) {
        throw new NotFoundError('Usage', targetUserId);
      }

      const metrics = (entitlement.usageMetrics || {}) as Record<string, unknown>;

      return NextResponse.json({
        success: true,
        usage: {
          users: readNumber(metrics, 'platform.users') || 1,
          storage: readNumber(metrics, 'platform.storageBytes'),
          apiCalls: readNumber(metrics, 'platform.apiCalls'),
          plugins: readNumber(metrics, 'platform.pluginsInstalled'),
        },
      });
    })
  )
);

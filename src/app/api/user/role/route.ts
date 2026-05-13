/**
 * User Role API Endpoint
 *
 * GET /api/user/role
 *
 * Returns current user's role
 */

import { NextResponse } from 'next/server';
import { getUserRole } from '@/lib/auth/permissions';
import { withAuth, withErrorHandling, type AuthContext } from '@/lib/middleware';

export const GET = withAuth(
  withErrorHandling(async (request, context) => {
    const { auth } = context as typeof context & { auth: AuthContext };

    // Get user's role from RBAC system
    const role = await getUserRole(auth.userId);

    return NextResponse.json({
      role,
      userId: auth.userId,
    });
  })
);

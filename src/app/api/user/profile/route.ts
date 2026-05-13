/**
 * User Profile API Endpoint
 *
 * GET /api/user/profile - Get current user's profile
 * PUT /api/user/profile - Update current user's profile
 *
 * ACCESS CONTROL:
 * - Requires authentication (any logged-in user)
 * - Users can only access their own profile
 */

import { NextResponse } from 'next/server';
import { requireUserContext } from '@/lib/db';
import { user, userProfiles, userroles, roles } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  withAuth,
  withErrorHandling,
  withBodyValidation,
  type AuthContext,
} from '@/lib/middleware';
import { updateProfileSchema } from '@/lib/validations/user';
import { NotFoundError } from '@/lib/_core/errors';

/**
 * Profile response interface
 */
interface ProfileResponse {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  emailVerified: boolean;
  createdAt: Date;
  role: {
    id: string;
    name: string;
    slug: string;
  } | null;
  preferences: {
    theme?: string;
    language?: string;
    timezone?: string;
    marketingEmails?: boolean;
    securityAlerts?: boolean;
    productUpdates?: boolean;
    billingAlerts?: boolean;
  };
}

/**
 * GET /api/user/profile
 *
 * Get current user's profile with role and preferences
 */
export const GET = withAuth(
  withErrorHandling(async (request, context) => {
    const { auth } = context as typeof context & { auth: AuthContext };

    // Get user with profile and role in a single query
    const result = await requireUserContext(auth.userId, async (database) => {
      return await database
        .select({
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          emailVerified: user.emailVerified,
          createdAt: user.createdAt,
          // Profile
          preferences: userProfiles.preferences,
          // Role
          roleId: roles.id,
          roleName: roles.name,
          roleSlug: roles.slug,
        })
        .from(user)
        .leftJoin(userProfiles, eq(user.id, userProfiles.userId))
        .leftJoin(userroles, eq(user.id, userroles.userId))
        .leftJoin(roles, eq(userroles.roleId, roles.id))
        .where(eq(user.id, auth.userId))
        .limit(1);
    });

    if (!result || result.length === 0) {
      throw new NotFoundError('User', auth.userId);
    }

    const userData = result[0];

    const profile: ProfileResponse = {
      id: userData.id,
      email: userData.email,
      name: userData.name,
      image: userData.image,
      emailVerified: userData.emailVerified,
      createdAt: userData.createdAt,
      role: userData.roleId
        ? {
            id: userData.roleId,
            name: userData.roleName!,
            slug: userData.roleSlug!,
          }
        : null,
      preferences: (userData.preferences as ProfileResponse['preferences']) || {
        theme: 'system',
        language: 'zh',
        timezone: 'Asia/Shanghai',
      },
    };

    return NextResponse.json({
      success: true,
      profile,
    });
  })
);

/**
 * PUT /api/user/profile
 *
 * Update current user's profile (name, image)
 */
export const PUT = withAuth(
  withErrorHandling(
    withBodyValidation(updateProfileSchema, async (request, context) => {
      const { auth, validated } = context as typeof context & {
        auth: AuthContext;
        validated: { body: { name?: string; image?: string } };
      };

      const updateData = validated.body;

      const updatedUser = await requireUserContext(auth.userId, async (database) => {
        // Check if user exists
        const existingUser = await database.query.user.findFirst({
          where: eq(user.id, auth.userId),
        });

        if (!existingUser) {
          throw new NotFoundError('User', auth.userId);
        }

        // Update user table (name, image)
        if (updateData.name !== undefined || updateData.image !== undefined) {
          await database
            .update(user)
            .set({
              ...(updateData.name !== undefined && { name: updateData.name }),
              ...(updateData.image !== undefined && { image: updateData.image }),
              updatedAt: new Date(),
            })
            .where(eq(user.id, auth.userId));
        }

        // Get updated user data
        return database.query.user.findFirst({
          where: eq(user.id, auth.userId),
        });
      });

      return NextResponse.json({
        success: true,
        user: {
          id: updatedUser!.id,
          name: updatedUser!.name,
          email: updatedUser!.email,
          image: updatedUser!.image,
        },
      });
    })
  )
);

/**
 * User Password Change API Endpoint
 *
 * GET /api/user/profile/password - Get current user's password capability
 * POST /api/user/profile/password - Change current user's password
 *
 * ACCESS CONTROL:
 * - Requires authentication (any logged-in user)
 * - Users can only change their own password
 * - Existing credential users must verify current password
 */

import { NextResponse } from 'next/server';
import { requireUserContext } from '@/lib/db';
import { account } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import {
  withAuth,
  withErrorHandling,
  withBodyValidation,
  type AuthContext,
} from '@/lib/middleware';
import { changePasswordSchema, type ChangePasswordInput } from '@/lib/validations/user';
import { ValidationError } from '@/lib/_core/errors';
import { hashPassword, verifyPassword } from 'better-auth/crypto';

async function findCredentialAccount(userId: string) {
  return await requireUserContext(userId, async (database) => {
    return await database.query.account.findFirst({
      where: and(eq(account.userId, userId), eq(account.providerId, 'credential')),
    });
  });
}

export const GET = withAuth(
  withErrorHandling(async (_request, context) => {
    const { auth } = context as typeof context & { auth: AuthContext };
    const credentialAccount = await findCredentialAccount(auth.userId);
    const hasPassword = Boolean(credentialAccount?.password);

    return NextResponse.json({
      success: true,
      hasPassword,
      mode: hasPassword ? 'change' : 'set',
    });
  })
);

/**
 * POST /api/user/profile/password
 *
 * Change or set current user's password
 *
 * Body:
 * - currentPassword: string (required only when a password already exists)
 * - newPassword: string (required, min 8 chars, must include uppercase, lowercase, number)
 * - confirmPassword: string (required, must match newPassword)
 */
export const POST = withAuth(
  withErrorHandling(
    withBodyValidation(changePasswordSchema, async (request, context) => {
      const { auth, validated } = context as typeof context & {
        auth: AuthContext;
        validated: { body: ChangePasswordInput };
      };

      const { currentPassword, newPassword } = validated.body;

      await requireUserContext(auth.userId, async (database) => {
        const credentialAccount = await database.query.account.findFirst({
          where: and(eq(account.userId, auth.userId), eq(account.providerId, 'credential')),
        });
        const storedHash = credentialAccount?.password;

        if (storedHash) {
          if (!currentPassword) {
            throw new ValidationError('Current password is required');
          }

          const isValidPassword = await verifyPassword({
            password: currentPassword,
            hash: storedHash,
          });

          if (!isValidPassword) {
            throw new ValidationError('Current password is incorrect');
          }
        }

        const newPasswordHash = await hashPassword(newPassword);

        if (credentialAccount) {
          await database
            .update(account)
            .set({
              password: newPasswordHash,
              updatedAt: new Date(),
            })
            .where(and(eq(account.userId, auth.userId), eq(account.providerId, 'credential')));
        } else {
          await database.insert(account).values({
            id: `account_${auth.userId}_credential`,
            providerId: 'credential',
            accountId: auth.userEmail,
            userId: auth.userId,
            password: newPasswordHash,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
      });

      return NextResponse.json({
        success: true,
        mode: currentPassword ? 'change' : 'set',
        message: 'Password updated successfully',
      });
    })
  )
);

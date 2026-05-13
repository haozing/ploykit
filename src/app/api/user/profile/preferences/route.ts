/**
 * User Preferences API Endpoint
 *
 * PUT /api/user/profile/preferences - Update current user's preferences
 *
 * ACCESS CONTROL:
 * - Requires authentication (any logged-in user)
 * - Users can only update their own preferences
 */

import { NextResponse } from 'next/server';
import { requireUserContext } from '@/lib/db';
import { userProfiles } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  withAuth,
  withErrorHandling,
  withBodyValidation,
  type AuthContext,
} from '@/lib/middleware';
import { updatePreferencesSchema, type UpdatePreferencesInput } from '@/lib/validations/user';

/**
 * PUT /api/user/profile/preferences
 *
 * Update current user's preferences (theme, language, timezone, notifications)
 */
export const PUT = withAuth(
  withErrorHandling(
    withBodyValidation(updatePreferencesSchema, async (request, context) => {
      const { auth, validated } = context as typeof context & {
        auth: AuthContext;
        validated: { body: UpdatePreferencesInput };
      };

      const updateData = validated.body;

      const newPreferences = await requireUserContext(auth.userId, async (database) => {
        // Get existing profile
        const existingProfile = await database.query.userProfiles.findFirst({
          where: eq(userProfiles.userId, auth.userId),
        });

        // Build new preferences by merging with existing
        const currentPreferences = (existingProfile?.preferences || {}) as Record<string, unknown>;
        const preferences = {
          ...currentPreferences,
          ...(updateData.theme !== undefined && { theme: updateData.theme }),
          ...(updateData.language !== undefined && { language: updateData.language }),
          ...(updateData.timezone !== undefined && { timezone: updateData.timezone }),
          ...(updateData.marketingEmails !== undefined && {
            marketingEmails: updateData.marketingEmails,
          }),
          ...(updateData.securityAlerts !== undefined && {
            securityAlerts: updateData.securityAlerts,
          }),
          ...(updateData.productUpdates !== undefined && {
            productUpdates: updateData.productUpdates,
          }),
          ...(updateData.billingAlerts !== undefined && {
            billingAlerts: updateData.billingAlerts,
          }),
        };

        if (existingProfile) {
          // Update existing profile
          await database
            .update(userProfiles)
            .set({
              preferences,
              updatedAt: new Date(),
            })
            .where(eq(userProfiles.userId, auth.userId));
        } else {
          // Create profile if it doesn't exist
          await database.insert(userProfiles).values({
            userId: auth.userId,
            metadata: {},
            preferences,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }

        return preferences;
      });

      return NextResponse.json({
        success: true,
        preferences: newPreferences,
      });
    })
  )
);

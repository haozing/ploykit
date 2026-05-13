import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUserContext } from '@/lib/db';
import { userProfiles } from '@/lib/db/schema';
import {
  withAuth,
  withBodyValidation,
  withErrorHandling,
  type AuthContext,
} from '@/lib/middleware';
import { eq } from 'drizzle-orm';
import { getSystemSettings } from '@/lib/services/system-settings/system-settings-service';

interface NotificationPreferences {
  id: string;
  emailEnabled: boolean;
  emailAddress: string;
  webhookEnabled: boolean;
  webhookUrl: string | null;
  webhookSecret: string | null;
  inAppEnabled: boolean;
  notifyOnUsageWarning: boolean;
  notifyOnUsageCritical: boolean;
  notifyOnUsageExceeded: boolean;
  notifyOnTrialEvents: boolean;
  notifyOnSubscriptionEvents: boolean;
  notifyOnPaymentEvents: boolean;
  dailyDigestEnabled: boolean;
  weeklyReportEnabled: boolean;
}

const notificationPreferencesSchema = z.object({
  id: z.string().optional(),
  emailEnabled: z.boolean().default(true),
  emailAddress: z.string().max(255).optional(),
  webhookEnabled: z.boolean().default(false),
  webhookUrl: z.string().max(2048).nullable().optional(),
  webhookSecret: z.string().max(255).nullable().optional(),
  inAppEnabled: z.boolean().default(true),
  notifyOnUsageWarning: z.boolean().default(true),
  notifyOnUsageCritical: z.boolean().default(true),
  notifyOnUsageExceeded: z.boolean().default(true),
  notifyOnTrialEvents: z.boolean().default(true),
  notifyOnSubscriptionEvents: z.boolean().default(true),
  notifyOnPaymentEvents: z.boolean().default(true),
  dailyDigestEnabled: z.boolean().default(false),
  weeklyReportEnabled: z.boolean().default(true),
});

async function defaultPreferences(auth: AuthContext): Promise<NotificationPreferences> {
  const settings = await getSystemSettings();
  const digestFrequency = settings.notifications.digestFrequency;

  return {
    id: auth.userId,
    emailEnabled: settings.notifications.emailEnabled,
    emailAddress: auth.userEmail,
    webhookEnabled: settings.notifications.webhookEnabled,
    webhookUrl: null,
    webhookSecret: null,
    inAppEnabled: settings.notifications.inAppEnabled,
    notifyOnUsageWarning: true,
    notifyOnUsageCritical: true,
    notifyOnUsageExceeded: true,
    notifyOnTrialEvents: true,
    notifyOnSubscriptionEvents: true,
    notifyOnPaymentEvents: true,
    dailyDigestEnabled: digestFrequency === 'daily',
    weeklyReportEnabled: digestFrequency === 'weekly',
  };
}

async function normalizePreferences(
  rawPreferences: Record<string, unknown>,
  auth: AuthContext
): Promise<NotificationPreferences> {
  const nested =
    rawPreferences.notificationSettings &&
    typeof rawPreferences.notificationSettings === 'object' &&
    !Array.isArray(rawPreferences.notificationSettings)
      ? (rawPreferences.notificationSettings as Partial<NotificationPreferences>)
      : {};

  const defaults = await defaultPreferences(auth);

  return {
    ...defaults,
    ...nested,
    id: auth.userId,
    emailEnabled:
      typeof nested.emailEnabled === 'boolean' ? nested.emailEnabled : defaults.emailEnabled,
    emailAddress:
      typeof nested.emailAddress === 'string' && nested.emailAddress.trim()
        ? nested.emailAddress
        : auth.userEmail,
    inAppEnabled:
      typeof nested.inAppEnabled === 'boolean' ? nested.inAppEnabled : defaults.inAppEnabled,
    webhookUrl: nested.webhookUrl || null,
    webhookSecret: nested.webhookSecret || null,
  };
}

export const GET = withAuth(
  withErrorHandling(async (_request, context) => {
    const { auth } = context as typeof context & { auth: AuthContext };
    const profile = await requireUserContext(auth.userId, async (database) => {
      return await database.query.userProfiles.findFirst({
        where: eq(userProfiles.userId, auth.userId),
      });
    });

    const rawPreferences = (profile?.preferences || {}) as Record<string, unknown>;

    return NextResponse.json({
      success: true,
      preferences: await normalizePreferences(rawPreferences, auth),
    });
  })
);

export const PUT = withAuth(
  withErrorHandling(
    withBodyValidation(notificationPreferencesSchema, async (_request, context) => {
      const { auth, validated } = context as typeof context & {
        auth: AuthContext;
        validated: { body: z.infer<typeof notificationPreferencesSchema> };
      };

      const existingProfile = await requireUserContext(auth.userId, async (database) => {
        return await database.query.userProfiles.findFirst({
          where: eq(userProfiles.userId, auth.userId),
        });
      });
      const currentPreferences = (existingProfile?.preferences || {}) as Record<string, unknown>;
      const defaults = await defaultPreferences(auth);
      const savedPreferences: NotificationPreferences = {
        ...defaults,
        ...validated.body,
        id: auth.userId,
        emailAddress: validated.body.emailAddress?.trim() || auth.userEmail,
        webhookUrl: validated.body.webhookUrl?.trim() || null,
        webhookSecret: validated.body.webhookSecret?.trim() || null,
      };
      const nextPreferences = {
        ...currentPreferences,
        notificationSettings: savedPreferences,
      };

      if (existingProfile) {
        await requireUserContext(auth.userId, async (database) => {
          await database
            .update(userProfiles)
            .set({ preferences: nextPreferences, updatedAt: new Date() })
            .where(eq(userProfiles.userId, auth.userId));
        });
      } else {
        await requireUserContext(auth.userId, async (database) => {
          await database.insert(userProfiles).values({
            userId: auth.userId,
            metadata: {},
            preferences: nextPreferences,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        });
      }

      return NextResponse.json({
        success: true,
        preferences: savedPreferences,
      });
    })
  )
);

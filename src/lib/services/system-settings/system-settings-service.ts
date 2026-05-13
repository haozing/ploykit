import { db } from '@/lib/db';
import { systemSettings } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import type { SystemSettingsPayload } from '@/lib/validations/system-settings';

const SETTING_DESCRIPTIONS: Record<keyof SystemSettingsPayload, string> = {
  general: 'General platform identity and locale settings',
  security: 'Authentication and account security policy settings',
  email: 'Transactional email provider defaults',
  notifications: 'Platform notification delivery defaults',
};

export const DEFAULT_SYSTEM_SETTINGS: SystemSettingsPayload = {
  general: {
    siteName: 'Ploykit',
    supportEmail: 'support@example.com',
    defaultLocale: 'en',
    timezone: 'UTC',
  },
  security: {
    requireEmailVerification: false,
    sessionMaxAgeDays: 30,
    passwordMinLength: 8,
  },
  email: {
    provider: 'log',
    fromEmail: 'noreply@example.com',
    fromName: 'Ploykit',
    passwordResetDelivery: 'log',
  },
  notifications: {
    inAppEnabled: true,
    emailEnabled: false,
    webhookEnabled: false,
    digestFrequency: 'never',
  },
};

type SystemSettingsKey = keyof SystemSettingsPayload;

function systemSettingKeys(): SystemSettingsKey[] {
  return ['general', 'security', 'email', 'notifications'];
}

export async function getSystemSettings(): Promise<SystemSettingsPayload> {
  const rows = await db.select().from(systemSettings);
  const merged: SystemSettingsPayload = structuredClone(DEFAULT_SYSTEM_SETTINGS);

  for (const row of rows) {
    if (row.key in merged && row.value && typeof row.value === 'object') {
      const key = row.key as SystemSettingsKey;
      merged[key] = {
        ...merged[key],
        ...row.value,
      } as never;
    }
  }

  return merged;
}

export async function updateSystemSettings(
  settings: SystemSettingsPayload,
  operatorUserId: string
): Promise<SystemSettingsPayload> {
  const now = new Date();

  await db.transaction(async (tx) => {
    for (const key of systemSettingKeys()) {
      await tx
        .insert(systemSettings)
        .values({
          key,
          value: settings[key],
          description: SETTING_DESCRIPTIONS[key],
          updatedBy: operatorUserId,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: systemSettings.key,
          set: {
            value: settings[key],
            description: SETTING_DESCRIPTIONS[key],
            updatedBy: operatorUserId,
            updatedAt: now,
          },
        });
    }
  });

  return getSystemSettings();
}

export async function getSystemSettingMetadata() {
  const rows = await db
    .select({
      key: systemSettings.key,
      description: systemSettings.description,
      updatedBy: systemSettings.updatedBy,
      updatedAt: systemSettings.updatedAt,
    })
    .from(systemSettings);

  return rows;
}

export async function getSystemSetting(key: SystemSettingsKey) {
  const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, key)).limit(1);
  return row ?? null;
}

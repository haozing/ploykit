import { and, eq } from 'drizzle-orm';
import { assignRole } from '@/lib/auth/permissions';
import { invalidateUserEntitlementCache, invalidateUserRoleCache } from '@/lib/cache';
import { ConfigurationError } from '@/lib/_core/errors';
import { logger } from '@/lib/_core/logger';
import { withSystemContext, type Database } from '@/lib/db';
import { roles, userEntitlements, userProfiles, type NewuserProfile } from '@/lib/db/schema';
import { createDefaultEntitlement } from '@/lib/services/user/user-entitlement-service';

export type UserInitializationSource = 'email' | 'google' | 'github' | 'admin' | 'unknown';

export interface UserInitializationInput {
  userId: string;
  email?: string | null;
  source: UserInitializationSource;
}

interface UserInitializationOptions {
  dbClient?: Database;
}

function defaultPreferences(): NonNullable<NewuserProfile['preferences']> {
  return {
    theme: 'light',
    language: 'zh',
  };
}

async function executeUserInitialization(
  input: UserInitializationInput,
  database: Database
): Promise<void> {
  const existingProfile = await database.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, input.userId),
  });

  if (existingProfile) {
    logger.debug({ userId: input.userId, source: input.source }, 'User profile already exists');
  } else {
    await database.insert(userProfiles).values({
      userId: input.userId,
      metadata: {
        registrationSource: input.source,
        onboardingCompleted: false,
      },
      preferences: defaultPreferences(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  const defaultRole = await database.query.roles.findFirst({
    where: eq(roles.isDefault, true),
  });

  if (!defaultRole) {
    throw new ConfigurationError(
      'No default role found. Please run seed script: npm run seed:rbac',
      {
        context: 'user-initialization',
      }
    );
  }

  await assignRole(input.userId, defaultRole.slug, undefined, database);

  const existingActiveEntitlement = await database.query.userEntitlements.findFirst({
    where: and(eq(userEntitlements.userId, input.userId), eq(userEntitlements.status, 'active')),
  });

  if (!existingActiveEntitlement) {
    await createDefaultEntitlement(input.userId, database);
  }
}

export async function ensureUserInitialized(
  input: UserInitializationInput,
  options: UserInitializationOptions = {}
): Promise<void> {
  const run = async (database: Database) => {
    await executeUserInitialization(input, database);
  };

  if (options.dbClient) {
    await run(options.dbClient);
  } else {
    await withSystemContext(run);
  }

  invalidateUserRoleCache(input.userId);
  invalidateUserEntitlementCache(input.userId);

  logger.info({ userId: input.userId, source: input.source }, 'User initialization ensured');
}

import { withSystemContext, type Database } from '@/lib/db';
import {
  account,
  session,
  user,
  userProfiles,
  userroles,
  roles,
  userEntitlements,
  entitlementPlans,
} from '@/lib/db/schema';
import { eq, and, or, like, desc, sql, isNull, isNotNull, gt, type SQL } from 'drizzle-orm';
import { auditLog, AUDIT_ACTIONS } from '@/lib/services/audit/audit-service';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/_core/errors';
import {
  updateUserSchema,
  userFiltersSchema,
  searchUsersSchema,
  type UpdateUserInput,
  type UserFiltersInput,
} from '@/lib/validations';
import { paginateWithCount } from '@/lib/helpers';
import { hashPassword } from 'better-auth/crypto';
import { randomBytes } from 'node:crypto';

/**
 * User Service
 *
 * Architecture:
 * - Better Auth `user` table: Authentication data (email, password, OAuth)
 * - `user_profiles` table: Business data (metadata, preferences)
 *
 * Business logic for user management:
 * - List users with filtering and pagination
 * - Get user details with roles and entitlements
 * - Update user profiles and preferences
 * - Manage user status (suspend, activate)
 * - User search and filtering
 *
 * Note: User creation is handled by Better Auth (registration, OAuth)
 * Note: User deletion is handled carefully (soft delete via profile)
 */

/**
 * User with full details (auth + profile + role)
 */
export interface UserWithDetails {
  // Better Auth user data (authentication)
  id: string;
  email: string;
  name: string;
  image?: string | null;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
  status: 'active' | 'pending' | 'suspended' | 'deleted';

  // User profile data (business)
  profile: {
    metadata: Record<string, unknown>;
    preferences: Record<string, unknown>;
    deletedAt: Date | null;
    deletedBy: string | null;
    status: 'active' | 'suspended';
    suspendedAt: Date | null;
    suspendedBy: string | null;
    suspendReason: string | null;
    createdAt: Date;
    updatedAt: Date;
  } | null;

  // Related data - Single role (users only have one role in this system)
  role?: {
    id: string;
    name: string;
    slug: string;
  } | null;
}

type UserListRow = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
  profileDeletedAt: Date | null;
  profileStatus: 'active' | 'suspended' | null;
  profileSuspendedAt: Date | null;
  profileSuspendedBy: string | null;
  profileSuspendReason: string | null;
  roleId: string | null;
  roleName: string | null;
  roleSlug: string | null;
  planName: string | null;
  planSlug: string | null;
  planEndDate: Date | null;
  planPeriodEnd: Date | null;
};

function resolveUserStatus(row: {
  emailVerified: boolean;
  profileDeletedAt?: Date | null;
  profileStatus?: 'active' | 'suspended' | null;
  profile?: { deletedAt?: Date | null; status?: 'active' | 'suspended' | null } | null;
}): UserWithDetails['status'] {
  const deletedAt = row.profileDeletedAt ?? row.profile?.deletedAt ?? null;
  if (deletedAt) {
    return 'deleted';
  }

  const profileStatus = row.profileStatus ?? row.profile?.status ?? null;
  if (profileStatus === 'suspended') {
    return 'suspended';
  }

  return row.emailVerified ? 'active' : 'pending';
}

function toAdminVisibleImageUrl(image: string | null): string | null {
  if (!image?.startsWith('/api/files/')) {
    return image;
  }

  return image.replace('/api/files/', '/api/admin/files/');
}

function mapUserListRow(userData: UserListRow) {
  return {
    id: userData.id,
    email: userData.email,
    name: userData.name || '',
    image: toAdminVisibleImageUrl(userData.image),
    emailVerified: userData.emailVerified,
    status: resolveUserStatus(userData),
    createdAt: userData.createdAt,
    updatedAt: userData.updatedAt,
    role: userData.roleId
      ? {
          id: userData.roleId,
          name: userData.roleName!,
          slug: userData.roleSlug!,
        }
      : null,
    subscription: userData.planName
      ? {
          planName: userData.planName,
          planSlug: userData.planSlug!,
          endDate: userData.planEndDate
            ? userData.planEndDate.toISOString()
            : userData.planPeriodEnd
              ? userData.planPeriodEnd.toISOString()
              : null,
        }
      : null,
  };
}

async function ensureUserProfile(database: Database, userId: string): Promise<void> {
  const existingProfile = await database.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, userId),
  });

  if (existingProfile) {
    await database
      .update(userProfiles)
      .set({
        updatedAt: new Date(),
      })
      .where(eq(userProfiles.userId, userId));
    return;
  }

  await database.insert(userProfiles).values({
    userId,
    metadata: {},
    preferences: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

async function updateAuthUserFields(
  database: Database,
  userId: string,
  data: UpdateUserInput
): Promise<void> {
  await database
    .update(user)
    .set({
      ...(data.name !== undefined && { name: data.name }),
      ...(data.email !== undefined && { email: data.email }),
      ...(data.image !== undefined && { image: data.image }),
      updatedAt: new Date(),
    })
    .where(eq(user.id, userId));
}

async function findUserById(database: Database, userId: string): Promise<UserWithDetails | null> {
  const result = await database
    .select({
      // Better Auth user fields
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,

      // Profile fields (nullable)
      profileMetadata: userProfiles.metadata,
      profilePreferences: userProfiles.preferences,
      profileDeletedAt: userProfiles.deletedAt,
      profileStatus: userProfiles.status,
      profileSuspendedAt: userProfiles.suspendedAt,
      profileSuspendedBy: userProfiles.suspendedBy,
      profileSuspendReason: userProfiles.suspendReason,
      profileDeletedBy: userProfiles.deletedBy,
      profileCreatedAt: userProfiles.createdAt,
      profileUpdatedAt: userProfiles.updatedAt,

      // Role fields (nullable) - only active role relation
      roleId: roles.id,
      roleName: roles.name,
      roleSlug: roles.slug,
    })
    .from(user)
    .leftJoin(userProfiles, eq(user.id, userProfiles.userId))
    .leftJoin(
      userroles,
      and(
        eq(user.id, userroles.userId),
        or(isNull(userroles.expiresAt), gt(userroles.expiresAt, new Date()))
      )
    )
    .leftJoin(roles, eq(userroles.roleId, roles.id))
    .where(eq(user.id, userId))
    .limit(1);

  if (!result || result.length === 0) {
    return null;
  }

  const userData = result[0];

  return {
    id: userData.id,
    email: userData.email,
    name: userData.name || '',
    image: toAdminVisibleImageUrl(userData.image),
    emailVerified: userData.emailVerified,
    createdAt: userData.createdAt,
    updatedAt: userData.updatedAt,
    status: resolveUserStatus(userData),

    // Profile (nullable)
    profile: userData.profileCreatedAt
      ? {
          metadata: userData.profileMetadata || {},
          preferences: userData.profilePreferences || {},
          deletedAt: userData.profileDeletedAt,
          deletedBy: userData.profileDeletedBy,
          status: userData.profileStatus || 'active',
          suspendedAt: userData.profileSuspendedAt,
          suspendedBy: userData.profileSuspendedBy,
          suspendReason: userData.profileSuspendReason,
          createdAt: userData.profileCreatedAt,
          updatedAt: userData.profileUpdatedAt!,
        }
      : null,

    // Role (single, nullable) - users only have one role
    role: userData.roleId
      ? {
          id: userData.roleId,
          name: userData.roleName!,
          slug: userData.roleSlug!,
        }
      : null,
  };
}

/**
 * List users with filtering and pagination
 *
 * Joins Better Auth user table with user_profiles for complete data
 */
export async function listUsers(filters: Partial<UserFiltersInput> = {}) {
  // Validate input
  const validatedFilters = userFiltersSchema.parse(filters);

  const { search, status, page, limit } = validatedFilters;

  const offset = (page - 1) * limit;

  // Build where conditions
  const conditions: SQL[] = [];

  // Search by name or email
  if (search) {
    const searchCondition = or(like(user.name, `%${search}%`), like(user.email, `%${search}%`));
    if (searchCondition) {
      conditions.push(searchCondition);
    }
  }

  // Filter by email verification status plus first-class profile status.
  if (status === 'pending') {
    const pendingCondition = and(
      eq(user.emailVerified, false),
      isNull(userProfiles.deletedAt),
      or(isNull(userProfiles.status), eq(userProfiles.status, 'active'))
    );
    if (pendingCondition) {
      conditions.push(pendingCondition);
    }
  } else if (status === 'active') {
    const activeCondition = and(
      eq(user.emailVerified, true),
      isNull(userProfiles.deletedAt),
      or(isNull(userProfiles.status), eq(userProfiles.status, 'active'))
    );
    if (activeCondition) {
      conditions.push(activeCondition);
    }
  } else if (status === 'deleted') {
    conditions.push(isNotNull(userProfiles.deletedAt));
  } else if (status === 'suspended') {
    conditions.push(and(eq(userProfiles.status, 'suspended'), isNull(userProfiles.deletedAt))!);
  }

  return withSystemContext(async (database) => {
    // Build query with LEFT JOIN to include users without profiles and roles.
    const baseQuery = database
      .select({
        // Better Auth user fields
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,

        // Profile fields (nullable)
        profileDeletedAt: userProfiles.deletedAt,
        profileStatus: userProfiles.status,
        profileSuspendedAt: userProfiles.suspendedAt,
        profileSuspendedBy: userProfiles.suspendedBy,
        profileSuspendReason: userProfiles.suspendReason,

        // Role fields (nullable) - only active role relation
        roleId: roles.id,
        roleName: roles.name,
        roleSlug: roles.slug,

        // Subscription fields (nullable) - active entitlement only
        planName: entitlementPlans.name,
        planSlug: entitlementPlans.slug,
        planEndDate: userEntitlements.endDate,
        planPeriodEnd: userEntitlements.currentPeriodEnd,
      })
      .from(user)
      .leftJoin(userProfiles, eq(user.id, userProfiles.userId))
      .leftJoin(
        userroles,
        and(
          eq(user.id, userroles.userId),
          or(isNull(userroles.expiresAt), gt(userroles.expiresAt, new Date()))
        )
      )
      .leftJoin(roles, eq(userroles.roleId, roles.id))
      .leftJoin(
        userEntitlements,
        and(eq(user.id, userEntitlements.userId), eq(userEntitlements.status, 'active'))
      )
      .leftJoin(entitlementPlans, eq(userEntitlements.planId, entitlementPlans.id));

    // Apply filters
    let query = baseQuery;
    if (conditions.length > 0) {
      query = baseQuery.where(and(...conditions)) as typeof baseQuery;
    }

    const usersQuery = query
      .orderBy(desc(user.createdAt))
      .limit(limit)
      .offset(offset)
      .then((rows) => rows.map((userData) => mapUserListRow(userData as UserListRow)));

    const countQuery = database
      .select({ count: sql<number>`count(*)` })
      .from(user)
      .leftJoin(userProfiles, eq(user.id, userProfiles.userId))
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    return paginateWithCount(usersQuery, countQuery, { page, limit });
  });
}

/**
 * Get user by ID with full details
 *
 * Fetches user from Better Auth + profile + roles
 *
 * OPTIMIZED: Single query with all JOINs (previously 2 queries)
 * Performance improvement: 50% reduction in database queries
 */
export async function getUserById(userId: string): Promise<UserWithDetails | null> {
  return withSystemContext(async (database) => findUserById(database, userId));
}

/**
 * Update user profile information
 *
 * Note: This updates the user_profiles table (business data)
 * To update authentication data (email, password), use Better Auth API
 */
export async function updateUser(
  userId: string,
  data: UpdateUserInput,
  operatorUserId: string,
  ipAddress?: string
): Promise<UserWithDetails> {
  // Validate input
  const validatedData = updateUserSchema.parse(data);

  const updatedUser = await withSystemContext(async (database) => {
    // Check if user exists
    const existingUser = await database.query.user.findFirst({
      where: eq(user.id, userId),
    });

    if (!existingUser) {
      throw new NotFoundError('User', userId);
    }

    if (validatedData.email && validatedData.email !== existingUser.email) {
      const emailOwner = await database.query.user.findFirst({
        where: eq(user.email, validatedData.email),
      });

      if (emailOwner && emailOwner.id !== userId) {
        throw new ConflictError('User email already exists', {
          userId,
          email: validatedData.email,
        });
      }
    }

    await updateAuthUserFields(database, userId, validatedData);
    await ensureUserProfile(database, userId);

    const reloadedUser = await findUserById(database, userId);
    if (!reloadedUser) {
      throw new NotFoundError('User', userId);
    }

    return {
      existingUser,
      reloadedUser,
    };
  });

  // Log audit trail
  auditLog({
    userId: operatorUserId,
    action: AUDIT_ACTIONS.USER_UPDATE,
    resource: 'user',
    resourceId: userId,
    resourceName: updatedUser.existingUser.name || updatedUser.existingUser.email,
    status: 'success',
    ipAddress,
    metadata: {
      changes: validatedData,
      fields: Object.keys(validatedData),
    },
  });

  return updatedUser.reloadedUser;
}

function generateTemporaryPassword(): string {
  return `Tmp-${randomBytes(9).toString('base64url')}9A`;
}

async function loadAuthUserOrThrow(database: Database, userId: string) {
  const existingAuthUser = await database.query.user.findFirst({
    where: eq(user.id, userId),
  });

  if (!existingAuthUser) {
    throw new NotFoundError('User', userId);
  }

  return existingAuthUser;
}

/**
 * Suspend a user account and revoke all active sessions.
 */
export async function suspendUser(
  userId: string,
  operatorUserId: string,
  ipAddress?: string,
  reason?: string
): Promise<UserWithDetails> {
  if (userId === operatorUserId) {
    throw new ForbiddenError('Administrators cannot suspend their own account.');
  }

  const result = await withSystemContext(async (database) => {
    const existingAuthUser = await loadAuthUserOrThrow(database, userId);
    const existingProfile = await database.query.userProfiles.findFirst({
      where: eq(userProfiles.userId, userId),
    });

    if (existingProfile?.deletedAt) {
      throw new ValidationError('Deleted users cannot be suspended.');
    }

    const now = new Date();
    const profileValues = {
      status: 'suspended' as const,
      suspendedAt: now,
      suspendedBy: operatorUserId,
      suspendReason: reason?.trim() || null,
      updatedAt: now,
    };

    if (existingProfile) {
      await database.update(userProfiles).set(profileValues).where(eq(userProfiles.userId, userId));
    } else {
      await database.insert(userProfiles).values({
        userId,
        metadata: {},
        preferences: {},
        ...profileValues,
        createdAt: now,
      });
    }

    await database.delete(session).where(eq(session.userId, userId));

    const reloadedUser = await findUserById(database, userId);
    if (!reloadedUser) {
      throw new NotFoundError('User', userId);
    }

    return { existingAuthUser, reloadedUser };
  });

  auditLog({
    userId: operatorUserId,
    action: AUDIT_ACTIONS.USER_SUSPEND,
    resource: 'user',
    resourceId: userId,
    resourceName: result.existingAuthUser.name || result.existingAuthUser.email,
    status: 'success',
    ipAddress,
    metadata: {
      ...(reason?.trim() ? { reason: reason.trim() } : {}),
      sessionsRevoked: true,
    },
  });

  return result.reloadedUser;
}

/**
 * Restore a suspended user account.
 */
export async function restoreUser(
  userId: string,
  operatorUserId: string,
  ipAddress?: string
): Promise<UserWithDetails> {
  const result = await withSystemContext(async (database) => {
    const existingAuthUser = await loadAuthUserOrThrow(database, userId);
    const existingProfile = await database.query.userProfiles.findFirst({
      where: eq(userProfiles.userId, userId),
    });

    if (existingProfile?.deletedAt) {
      throw new ValidationError('Deleted users cannot be restored with suspend/restore.');
    }

    const now = new Date();
    const profileValues = {
      status: 'active' as const,
      suspendedAt: null,
      suspendedBy: null,
      suspendReason: null,
      updatedAt: now,
    };

    if (existingProfile) {
      await database.update(userProfiles).set(profileValues).where(eq(userProfiles.userId, userId));
    } else {
      await database.insert(userProfiles).values({
        userId,
        metadata: {},
        preferences: {},
        ...profileValues,
        createdAt: now,
      });
    }

    const reloadedUser = await findUserById(database, userId);
    if (!reloadedUser) {
      throw new NotFoundError('User', userId);
    }

    return { existingAuthUser, reloadedUser };
  });

  auditLog({
    userId: operatorUserId,
    action: AUDIT_ACTIONS.USER_RESTORE,
    resource: 'user',
    resourceId: userId,
    resourceName: result.existingAuthUser.name || result.existingAuthUser.email,
    status: 'success',
    ipAddress,
  });

  return result.reloadedUser;
}

/**
 * Reset credential password for a user and return a one-time temporary password.
 */
export async function resetUserPassword(
  userId: string,
  operatorUserId: string,
  ipAddress?: string
): Promise<{ user: UserWithDetails; temporaryPassword: string }> {
  if (userId === operatorUserId) {
    throw new ForbiddenError('Administrators cannot reset their own password here.');
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  const result = await withSystemContext(async (database) => {
    const existingAuthUser = await loadAuthUserOrThrow(database, userId);
    const credentialAccount = await database.query.account.findFirst({
      where: and(eq(account.userId, userId), eq(account.providerId, 'credential')),
    });

    const now = new Date();
    if (credentialAccount) {
      await database
        .update(account)
        .set({
          password: passwordHash,
          accountId: existingAuthUser.email,
          updatedAt: now,
        })
        .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')));
    } else {
      await database.insert(account).values({
        id: `account_${userId}_credential`,
        providerId: 'credential',
        accountId: existingAuthUser.email,
        userId,
        password: passwordHash,
        createdAt: now,
        updatedAt: now,
      });
    }

    await database.delete(session).where(eq(session.userId, userId));

    const reloadedUser = await findUserById(database, userId);
    if (!reloadedUser) {
      throw new NotFoundError('User', userId);
    }

    return { existingAuthUser, reloadedUser };
  });

  auditLog({
    userId: operatorUserId,
    action: AUDIT_ACTIONS.USER_PASSWORD_RESET,
    resource: 'user',
    resourceId: userId,
    resourceName: result.existingAuthUser.name || result.existingAuthUser.email,
    status: 'success',
    ipAddress,
    metadata: {
      credentialAccountEnsured: true,
      sessionsRevoked: true,
    },
  });

  return {
    user: result.reloadedUser,
    temporaryPassword,
  };
}

/**
 * Delete user profile (soft delete)
 *
 * Note: This only deletes the user_profiles entry.
 * To fully delete a user (including auth data), use Better Auth API.
 *
 * For soft delete, consider adding metadata.deleted: true instead.
 */
export async function deleteUser(userId: string, operatorUserId: string, ipAddress?: string) {
  const authUser = await withSystemContext(async (database) => {
    // Check if user exists in Better Auth
    const existingAuthUser = await database.query.user.findFirst({
      where: eq(user.id, userId),
    });

    if (!existingAuthUser) {
      throw new NotFoundError('User', userId);
    }

    // Check if profile exists
    const userProfile = await database.query.userProfiles.findFirst({
      where: eq(userProfiles.userId, userId),
    });

    if (userProfile) {
      // OPTIMIZED: Soft delete using dedicated columns (faster than JSONB)
      await database
        .update(userProfiles)
        .set({
          status: 'active',
          suspendedAt: null,
          suspendedBy: null,
          suspendReason: null,
          deletedAt: new Date(),
          deletedBy: operatorUserId,
          updatedAt: new Date(),
        })
        .where(eq(userProfiles.userId, userId));
    } else {
      await database.insert(userProfiles).values({
        userId,
        metadata: {},
        preferences: {},
        deletedAt: new Date(),
        deletedBy: operatorUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    return existingAuthUser;
  });

  // Log audit trail
  auditLog({
    userId: operatorUserId,
    action: AUDIT_ACTIONS.USER_DELETE,
    resource: 'user_profile',
    resourceId: userId,
    resourceName: authUser.name || authUser.email,
    status: 'success',
    ipAddress,
    metadata: {
      deletedUser: {
        id: authUser.id,
        email: authUser.email,
        name: authUser.name,
      },
      note: 'Profile soft deleted. Auth user remains active.',
    },
  });

  return { success: true };
}

/**
 * Search users by name or email
 *
 * Searches in Better Auth user table
 */
export async function searchUsers(searchParams: { query: string; limit?: number }) {
  // Validate input
  const { query, limit } = searchUsersSchema.parse(searchParams);

  const results = await withSystemContext(async (database) => {
    return database
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
      })
      .from(user)
      .leftJoin(userProfiles, eq(user.id, userProfiles.userId))
      .where(
        and(
          or(like(user.name, `%${query}%`), like(user.email, `%${query}%`)),
          isNull(userProfiles.deletedAt)
        )
      )
      .limit(limit);
  });

  return results;
}

/**
 * Get user statistics
 *
 * Counts users from Better Auth user table
 *
 * OPTIMIZED: Reduced from 4 queries to 2 queries using conditional aggregation
 * Performance improvement: 50% reduction in database queries
 */
export async function getUserStats() {
  const { userStatsResult, deletedResult } = await withSystemContext(async (database) => {
    // Single query with conditional aggregation for user stats.
    const userStats = await database.execute<{
      total: string;
      active: string;
      pending: string;
      suspended: string;
    }>(sql`
      SELECT
        COUNT(*)::text as total,
        COUNT(CASE WHEN ${user.emailVerified} = true AND ${userProfiles.deletedAt} IS NULL AND COALESCE(${userProfiles.status}, 'active') = 'active' THEN 1 END)::text as active,
        COUNT(CASE WHEN ${user.emailVerified} = false AND ${userProfiles.deletedAt} IS NULL AND COALESCE(${userProfiles.status}, 'active') = 'active' THEN 1 END)::text as pending,
        COUNT(CASE WHEN ${userProfiles.deletedAt} IS NULL AND ${userProfiles.status} = 'suspended' THEN 1 END)::text as suspended
      FROM ${user}
      LEFT JOIN ${userProfiles} ON ${user.id} = ${userProfiles.userId}
    `);

    // OPTIMIZED: Query deleted profiles using dedicated column (uses index)
    const deleted = await database
      .select({ count: sql<number>`count(*)` })
      .from(userProfiles)
      .where(isNotNull(userProfiles.deletedAt));

    return {
      userStatsResult: userStats,
      deletedResult: deleted,
    };
  });

  // Handle different return types from db.execute (Neon vs standard Postgres)
  const statsRow = 'rows' in userStatsResult ? userStatsResult.rows[0] : userStatsResult[0];

  return {
    total: Number(statsRow?.total || 0),
    active: Number(statsRow?.active || 0),
    pending: Number(statsRow?.pending || 0),
    deleted: deletedResult[0]?.count || 0,
    suspended: Number(statsRow?.suspended || 0),
  };
}

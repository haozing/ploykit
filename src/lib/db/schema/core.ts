/**
 * Core Database Schema Definitions
 *
 * Contains core user authentication and profile tables:
 * - user: Better Auth user table (authentication data)
 * - user_profiles: Extended user business data
 * - account: OAuth account connections
 * - session: User session management
 * - verification: Email verification tokens
 *
 * Better Auth handles: Login, Registration, OAuth, Email Verification
 */

import { pgTable, text, timestamp, jsonb, index, uniqueIndex, boolean } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

//
// Type Definitions
//

/**
 * User Metadata Type
 *
 * Stores additional user information like avatar, department, etc.
 */
export interface userMetadata {
  avatar?: string;
  department?: string;
  title?: string;
  phoneNumber?: string;
  lastLogin?: string; // ISO timestamp
  [key: string]: unknown;
}

export type UserProfileStatus = 'active' | 'suspended';

/**
 * User Preferences Type
 *
 * Stores user UI/UX preferences like theme, notifications, etc.
 */
export interface userPreferences {
  notifications?: boolean;
  emailDigest?: 'daily' | 'weekly' | 'never';
  theme?: 'light' | 'dark' | 'auto';
  language?: string;
  timezone?: string;
  [key: string]: unknown;
}

//
// Table Definitions
//

/**
 * Better Auth User Table
 *
 * Handles core authentication:
 * - User registration/login (email + password)
 * - Email verification
 * - Session management
 *
 * Note: Uses TEXT type for id (Better Auth default)
 */
export const betterAuthuser = pgTable('user', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('emailVerified').notNull().default(false),
  name: text('name'),
  image: text('image'),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull(),
});

/**
 * Account Table (OAuth & Password Authentication)
 *
 * Stores authentication provider information
 */
export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    providerId: text('providerId').notNull(),
    accountId: text('accountId').notNull(),
    userId: text('userId')
      .notNull()
      .references(() => betterAuthuser.id, { onDelete: 'cascade' }),
    accessToken: text('accessToken'),
    refreshToken: text('refreshToken'),
    idToken: text('idToken'),
    accessTokenExpiresAt: timestamp('accessTokenExpiresAt', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    providerAccountIdx: uniqueIndex('account_provider_account_idx').on(
      table.providerId,
      table.accountId
    ),
    userIdx: index('account_user_idx').on(table.userId),
  })
);

/**
 * Session Table
 *
 * Manages user sessions with token-based authentication
 */
export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    userId: text('userId')
      .notNull()
      .references(() => betterAuthuser.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expiresAt', { withTimezone: true }).notNull(),
    token: text('token').notNull(),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tokenIdx: uniqueIndex('session_token_idx').on(table.token),
    userIdx: index('session_user_idx').on(table.userId),
    expiresAtIdx: index('session_expires_at_idx').on(table.expiresAt),
  })
);

/**
 * Verification Table
 *
 * Stores email verification tokens and other verification codes
 */
export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expiresAt', { withTimezone: true }).notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    identifierIdx: index('verification_identifier_idx').on(table.identifier),
    expiresAtIdx: index('verification_expires_at_idx').on(table.expiresAt),
  })
);

/**
 * User Profiles Table
 *
 * Extended user business data (metadata and preferences)
 * References Better Auth user table via user_id
 *
 * Relationship: user.id (TEXT) ← user_profiles.user_id (TEXT)
 *
 * OPTIMIZED: Added dedicated soft delete columns (deletedAt, deletedBy)
 * Previous: Used metadata->>'deleted' (slow JSONB scan)
 * New: Native timestamp columns with partial indexes (fast)
 */
export const userProfiles = pgTable(
  'user_profiles',
  {
    // Foreign key to Better Auth user table (TEXT type)
    userId: text('user_id')
      .primaryKey()
      .references(() => betterAuthuser.id, { onDelete: 'cascade' }),

    // User metadata (avatar, department, etc.)
    metadata: jsonb('metadata').$type<userMetadata>().default({}),

    // User preferences (theme, notifications, etc.)
    preferences: jsonb('preferences').$type<userPreferences>().default({}),

    // First-class account state used by admin operations and auth guards.
    status: text('status').$type<UserProfileStatus>().notNull().default('active'),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    suspendedBy: text('suspended_by'),
    suspendReason: text('suspend_reason'),

    // Soft delete columns (OPTIMIZED for performance)
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: text('deleted_by'),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // Index for sorting by creation date
    createdAtIdx: index('user_profiles_created_at_idx').on(table.createdAt),
    // Partial index for soft-deleted profiles (only indexes deleted records)
    deletedAtIdx: index('user_profiles_deleted_at_idx').on(table.deletedAt),
    // Index for audit purposes
    deletedByIdx: index('user_profiles_deleted_by_idx').on(table.deletedBy),
    statusIdx: index('user_profiles_status_idx').on(table.status),
    suspendedAtIdx: index('user_profiles_suspended_at_idx').on(table.suspendedAt),
  })
);

//
// Relations
//

/**
 * User Profiles Relations
 */
export const userProfilesRelations = relations(userProfiles, ({ one }) => ({
  // Relation to Better Auth user table
  user: one(betterAuthuser, {
    fields: [userProfiles.userId],
    references: [betterAuthuser.id],
  }),
}));

/**
 * Account Relations
 */
export const accountRelations = relations(account, ({ one }) => ({
  user: one(betterAuthuser, {
    fields: [account.userId],
    references: [betterAuthuser.id],
  }),
}));

/**
 * Session Relations
 */
export const sessionRelations = relations(session, ({ one }) => ({
  user: one(betterAuthuser, {
    fields: [session.userId],
    references: [betterAuthuser.id],
  }),
}));

//
// Exports
//

/**
 * Re-export Better Auth user table for convenience
 *
 * Usage:
 * ```typescript
 * import { user } from '@/lib/db/schema';
 * ```
 */
export const user = betterAuthuser;

// Type Exports

export type Account = typeof account.$inferSelect;
export type NewAccount = typeof account.$inferInsert;

export type Session = typeof session.$inferSelect;
export type NewSession = typeof session.$inferInsert;

export type Verification = typeof verification.$inferSelect;
export type NewVerification = typeof verification.$inferInsert;

export type userProfile = typeof userProfiles.$inferSelect;
export type NewuserProfile = typeof userProfiles.$inferInsert;

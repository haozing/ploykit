/**
 * RBAC (role-Based Access Control) Schema
 *
 *
 * Contains)
 */

import { pgTable, uuid, text, timestamp, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { user } from './core';

// TypeDefinition

/**
 * PermissionDefinition
 *
 * - plugin:install (InstallPlugin)
 * - admin:access:all (Access admin panel)
 */
export type Permission = string;

/**
 * roleTable
 *
 * Updated: Global role definitions for user-level architecture
 *
 *
 * Note: In user-level architecture, all roles are global and manageable.
 * The is_system field was removed in migration 0005.
 */
export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    name: text('name').notNull(),

    // dmin, user, premium
    slug: text('slug').notNull().unique(),

    // roleDescription
    description: text('description'),

    // 'user:read:all', 'admin:access:all']
    permissions: text('permissions').array().notNull().default([]),

    isDefault: boolean('is_default').notNull().default(false),

    // In user-level architecture, all roles are global and can be managed
    // through the admin interface. No need for "system" vs "custom" distinction.

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // CreateTimeSort
    createdAtIdx: index('roles_created_at_idx').on(table.createdAt),
  })
);

/**
 *
 *
 */
export const userroles = pgTable(
  'user_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Better Auth user.id is text type
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),

    // Role ID
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),

    grantedBy: text('granted_by'),

    // AuthorizationTime
    grantedAt: timestamp('granted_at', { withTimezone: true }).defaultNow().notNull(),

    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (table) => ({
    userroleIdx: uniqueIndex('user_roles_user_role_idx').on(table.userId, table.roleId),

    // userQuery
    userIdx: index('user_roles_user_idx').on(table.userId),

    roleIdx: index('user_roles_role_idx').on(table.roleId),
  })
);

/**
 *
 */
export const permissions = pgTable(
  'permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Resource type, for example user, role, plugin, setting
    resource: text('resource').notNull(),

    // Actions
    // reate, read, update, delete, manage
    action: text('action').notNull(),

    scope: text('scope').notNull(),

    identifier: text('identifier').notNull().unique(),

    // PermissionDescription
    description: text('description'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    resourceActionScopeIdx: uniqueIndex('permissions_resource_action_scope_idx').on(
      table.resource,
      table.action,
      table.scope
    ),

    // Query
    resourceIdx: index('permissions_resource_idx').on(table.resource),
  })
);

export const rolesRelations = relations(roles, ({ many }) => ({
  // user
  userroles: many(userroles),
}));

export const userrolesRelations = relations(userroles, ({ one }) => ({
  user: one(user, {
    fields: [userroles.userId],
    references: [user.id],
  }),
  role: one(roles, {
    fields: [userroles.roleId],
    references: [roles.id],
  }),
}));

// TypeExport

export type role = typeof roles.$inferSelect;
export type Newrole = typeof roles.$inferInsert;

export type userrole = typeof userroles.$inferSelect;
export type Newuserrole = typeof userroles.$inferInsert;

export type PermissionRecord = typeof permissions.$inferSelect;
export type NewPermissionRecord = typeof permissions.$inferInsert;

/**
 * RBAC (Role-Based Access Control) schema.
 */

import { pgTable, uuid, text, timestamp, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { user } from './core';

/**
 * Permission identifiers use the format resource:action:scope.
 *
 * Examples:
 * - plugin:install:all
 * - admin:access:all
 */
export type Permission = string;

/**
 * Global role definitions.
 */
export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    name: text('name').notNull(),

    slug: text('slug').notNull().unique(),

    description: text('description'),

    permissions: text('permissions').array().notNull().default([]),

    isDefault: boolean('is_default').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    createdAtIdx: index('roles_created_at_idx').on(table.createdAt),
  })
);

/**
 * User-to-role assignments.
 */
export const userroles = pgTable(
  'user_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Better Auth user.id is text type
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),

    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),

    grantedBy: text('granted_by'),

    grantedAt: timestamp('granted_at', { withTimezone: true }).defaultNow().notNull(),

    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (table) => ({
    userroleIdx: uniqueIndex('user_roles_user_role_idx').on(table.userId, table.roleId),

    userIdx: index('user_roles_user_idx').on(table.userId),

    roleIdx: index('user_roles_role_idx').on(table.roleId),
  })
);

/**
 * Permission catalog.
 */
export const permissions = pgTable(
  'permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Resource type, for example user, role, plugin, setting
    resource: text('resource').notNull(),

    action: text('action').notNull(),

    scope: text('scope').notNull(),

    identifier: text('identifier').notNull().unique(),

    description: text('description'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    resourceActionScopeIdx: uniqueIndex('permissions_resource_action_scope_idx').on(
      table.resource,
      table.action,
      table.scope
    ),

    resourceIdx: index('permissions_resource_idx').on(table.resource),
  })
);

export const rolesRelations = relations(roles, ({ many }) => ({
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

export type role = typeof roles.$inferSelect;
export type Newrole = typeof roles.$inferInsert;

export type userrole = typeof userroles.$inferSelect;
export type Newuserrole = typeof userroles.$inferInsert;

export type PermissionRecord = typeof permissions.$inferSelect;
export type NewPermissionRecord = typeof permissions.$inferInsert;

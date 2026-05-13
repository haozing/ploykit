/**
 *
 * Contains)
 * - plugin_installations: PluginInstallRecord
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { user } from './core';

// TypeDefinition

/**
 */
export interface LifecycleMetadata {
  duration?: number; //
  userId?: string; // userID
  version?: string; // Version
  error?: {
    message: string;
    stack?: string;
    code?: string;
  };
  context?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * PluginInstallRecordTable
 *
 */
export const pluginInstallations = pgTable(
  'plugin_installations',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    pluginId: text('plugin_id').notNull().unique(),

    version: text('version').notNull(),

    enabled: boolean('enabled').default(false).notNull(),

    installedAt: timestamp('installed_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),

    installedBy: text('installed_by'),
  },
  (table) => ({
    enabledIdx: index('plugin_installations_enabled_idx').on(table.enabled),
    pluginIdIdx: index('plugin_installations_plugin_id_idx').on(table.pluginId),
  })
);

/**
 * PluginConfigurationTable
 *
 */
export const pluginSettings = pgTable(
  'plugin_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // ID
    pluginId: text('plugin_id').notNull(),

    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),

    key: text('key').notNull(),

    value: jsonb('value').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pluginuserKeyIdx: uniqueIndex('plugin_settings_plugin_user_key_idx').on(
      table.pluginId,
      table.userId,
      table.key
    ),
    pluginIdx: index('plugin_settings_plugin_idx').on(table.pluginId),
    userIdx: index('plugin_settings_user_idx').on(table.userId),
  })
);

/**
 *
 */
export const pluginLifecycleLogs = pgTable(
  'plugin_lifecycle_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // ID
    pluginId: text('plugin_id').notNull(),

    // HookName
    // ? onInstall, onEnable, onDisable, onUninstall, onUpgrade
    hook: text('hook').notNull(),

    success: boolean('success').notNull().default(true),

    error: text('error'),

    metadata: jsonb('metadata').$type<LifecycleMetadata>(),

    // Time
    executedAt: timestamp('executed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // QueryLogs
    pluginIdx: index('plugin_lifecycle_logs_plugin_idx').on(table.pluginId),
    executedAtIdx: index('plugin_lifecycle_logs_executed_at_idx').on(table.executedAt),
    // hooks
    successIdx: index('plugin_lifecycle_logs_success_idx').on(table.success),
  })
);

// Relations

/**
 * Plugin Installations Relations
 */
export const pluginInstallationsRelations = relations(pluginInstallations, () => ({}));

/**
 * Plugin Settings Relations
 */
export const pluginSettingsRelations = relations(pluginSettings, ({ one }) => ({
  user: one(user, {
    fields: [pluginSettings.userId],
    references: [user.id],
  }),
}));

/**
 * Plugin Lifecycle Logs Relations
 */
export const pluginLifecycleLogsRelations = relations(pluginLifecycleLogs, () => ({}));

// Type Exports

export type PluginInstallation = typeof pluginInstallations.$inferSelect;
export type NewPluginInstallation = typeof pluginInstallations.$inferInsert;

export type PluginSetting = typeof pluginSettings.$inferSelect;
export type NewPluginSetting = typeof pluginSettings.$inferInsert;

export type PluginLifecycleLog = typeof pluginLifecycleLogs.$inferSelect;
export type NewPluginLifecycleLog = typeof pluginLifecycleLogs.$inferInsert;

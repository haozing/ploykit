/**
 * Plugin runtime database schema.
 *
 * Tables:
 * - plugin_installations: installed plugin versions and enabled state
 * - plugin_settings: per-user plugin settings
 * - plugin_lifecycle_logs: install/enable/disable lifecycle execution logs
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  jsonb,
  index,
  integer,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { user } from './core';

export interface LifecycleMetadata {
  duration?: number;
  userId?: string;
  version?: string;
  error?: {
    message: string;
    stack?: string;
    code?: string;
  };
  context?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Installed plugin records.
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
 * Per-user plugin settings.
 */
export const pluginSettings = pgTable(
  'plugin_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),

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
 * Plugin lifecycle execution logs.
 */
export const pluginLifecycleLogs = pgTable(
  'plugin_lifecycle_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    pluginId: text('plugin_id').notNull(),

    hook: text('hook').notNull(),

    success: boolean('success').notNull().default(true),

    error: text('error'),

    metadata: jsonb('metadata').$type<LifecycleMetadata>(),

    executedAt: timestamp('executed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pluginIdx: index('plugin_lifecycle_logs_plugin_idx').on(table.pluginId),
    executedAtIdx: index('plugin_lifecycle_logs_executed_at_idx').on(table.executedAt),
    successIdx: index('plugin_lifecycle_logs_success_idx').on(table.success),
  })
);

export const pluginHostPageOverrides = pgTable(
  'plugin_host_page_overrides',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pagePath: text('page_path').notNull(),
    pluginId: text('plugin_id').notNull(),
    componentPath: text('component_path').notNull(),
    mode: text('mode').notNull().default('main.replace'),
    status: text('status').notNull().default('active'),
    priority: integer('priority').notNull().default(100),
    seoHash: text('seo_hash'),
    i18nHash: text('i18n_hash'),
    activatedBy: text('activated_by'),
    activatedAt: timestamp('activated_at', { withTimezone: true }).defaultNow().notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    activePageIdx: uniqueIndex('plugin_host_page_overrides_active_page_idx')
      .on(table.pagePath)
      .where(sql`${table.status} = 'active'`),
    pluginPageIdx: uniqueIndex('plugin_host_page_overrides_plugin_page_idx').on(
      table.pluginId,
      table.pagePath
    ),
    statusIdx: index('plugin_host_page_overrides_status_idx').on(table.status),
    pluginIdx: index('plugin_host_page_overrides_plugin_idx').on(table.pluginId),
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
export const pluginHostPageOverridesRelations = relations(pluginHostPageOverrides, () => ({}));

// Type Exports

export type PluginInstallation = typeof pluginInstallations.$inferSelect;
export type NewPluginInstallation = typeof pluginInstallations.$inferInsert;

export type PluginSetting = typeof pluginSettings.$inferSelect;
export type NewPluginSetting = typeof pluginSettings.$inferInsert;

export type PluginLifecycleLog = typeof pluginLifecycleLogs.$inferSelect;
export type NewPluginLifecycleLog = typeof pluginLifecycleLogs.$inferInsert;
export type PluginHostPageOverride = typeof pluginHostPageOverrides.$inferSelect;
export type NewPluginHostPageOverride = typeof pluginHostPageOverrides.$inferInsert;

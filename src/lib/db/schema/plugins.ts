/**
 * Plugin runtime database schema.
 *
 * Tables:
 * - app_products: runtime product boundaries
 * - plugin_suites: plugin suite boundaries
 * - app_bundles: installable bundle boundaries
 * - plugin_installations: product-scoped installed plugin versions and enabled state
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

export const appProducts = pgTable(
  'app_products',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    runtimeKey: text('runtime_key').notNull(),
    defaultLocale: text('default_locale').notNull().default('en'),
    status: text('status').notNull().default('active'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    runtimeKeyIdx: uniqueIndex('app_products_runtime_key_idx').on(table.runtimeKey),
    statusIdx: index('app_products_status_idx').on(table.status),
  })
);

export const pluginSuites = pgTable(
  'plugin_suites',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => appProducts.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    version: text('version').notNull().default('0.1.0'),
    status: text('status').notNull().default('active'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    productIdx: index('plugin_suites_product_idx').on(table.productId, table.status),
  })
);

export const pluginSuiteMembers = pgTable(
  'plugin_suite_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    suiteId: text('suite_id')
      .notNull()
      .references(() => pluginSuites.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => appProducts.id, { onDelete: 'cascade' }),
    pluginId: text('plugin_id').notNull(),
    role: text('role').notNull().default('member'),
    sortOrder: integer('sort_order').notNull().default(100),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    suitePluginIdx: uniqueIndex('plugin_suite_members_suite_plugin_idx').on(
      table.suiteId,
      table.pluginId
    ),
    productPluginIdx: uniqueIndex('plugin_suite_members_product_plugin_idx').on(
      table.productId,
      table.pluginId
    ),
    productIdx: index('plugin_suite_members_product_idx').on(table.productId),
  })
);

export const appBundles = pgTable(
  'app_bundles',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => appProducts.id, { onDelete: 'cascade' }),
    suiteId: text('suite_id').references(() => pluginSuites.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    version: text('version').notNull().default('0.1.0'),
    sourceType: text('source_type').notNull().default('local'),
    sourceRef: text('source_ref'),
    status: text('status').notNull().default('active'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    productIdx: index('app_bundles_product_idx').on(table.productId, table.status),
    suiteIdx: index('app_bundles_suite_idx').on(table.suiteId),
  })
);

export const appBundleMembers = pgTable(
  'app_bundle_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bundleId: text('bundle_id')
      .notNull()
      .references(() => appBundles.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => appProducts.id, { onDelete: 'cascade' }),
    suiteId: text('suite_id').references(() => pluginSuites.id, { onDelete: 'set null' }),
    pluginId: text('plugin_id').notNull(),
    enableByDefault: boolean('enable_by_default').notNull().default(true),
    required: boolean('required').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(100),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    bundlePluginIdx: uniqueIndex('app_bundle_members_bundle_plugin_idx').on(
      table.bundleId,
      table.pluginId
    ),
    productPluginIdx: index('app_bundle_members_product_plugin_idx').on(
      table.productId,
      table.pluginId
    ),
    suiteIdx: index('app_bundle_members_suite_idx').on(table.suiteId),
  })
);

/**
 * Installed plugin records.
 */
export const pluginInstallations = pgTable(
  'plugin_installations',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    productId: text('product_id')
      .notNull()
      .references(() => appProducts.id, { onDelete: 'cascade' }),

    suiteId: text('suite_id').references(() => pluginSuites.id, { onDelete: 'set null' }),

    bundleId: text('bundle_id').references(() => appBundles.id, { onDelete: 'set null' }),

    pluginId: text('plugin_id').notNull(),

    version: text('version').notNull(),

    enabled: boolean('enabled').default(false).notNull(),

    installStatus: text('install_status').notNull().default('installed'),

    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),

    installedAt: timestamp('installed_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),

    installedBy: text('installed_by'),
  },
  (table) => ({
    productPluginIdx: uniqueIndex('plugin_installations_product_plugin_idx').on(
      table.productId,
      table.pluginId
    ),
    productEnabledIdx: index('plugin_installations_product_enabled_idx').on(
      table.productId,
      table.enabled
    ),
    suiteEnabledIdx: index('plugin_installations_suite_enabled_idx').on(
      table.suiteId,
      table.enabled
    ),
    bundleIdx: index('plugin_installations_bundle_idx').on(table.bundleId),
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
    productId: text('product_id')
      .notNull()
      .references(() => appProducts.id, { onDelete: 'cascade' }),
    suiteId: text('suite_id').references(() => pluginSuites.id, { onDelete: 'set null' }),
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
      .on(table.productId, table.pagePath)
      .where(sql`${table.status} = 'active'`),
    pluginPageIdx: uniqueIndex('plugin_host_page_overrides_plugin_page_idx').on(
      table.productId,
      table.pluginId,
      table.pagePath
    ),
    productIdx: index('plugin_host_page_overrides_product_idx').on(table.productId),
    suiteIdx: index('plugin_host_page_overrides_suite_idx').on(table.suiteId),
    statusIdx: index('plugin_host_page_overrides_status_idx').on(table.status),
    pluginIdx: index('plugin_host_page_overrides_plugin_idx').on(table.pluginId),
  })
);

export const pluginRuntimeSurfaces = pgTable(
  'plugin_runtime_surfaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: text('product_id')
      .notNull()
      .references(() => appProducts.id, { onDelete: 'cascade' }),
    suiteId: text('suite_id').references(() => pluginSuites.id, { onDelete: 'set null' }),
    pluginId: text('plugin_id').notNull(),
    surfaceType: text('surface_type').notNull(),
    surfaceKey: text('surface_key').notNull(),
    status: text('status').notNull().default('active'),
    sourceHash: text('source_hash'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueSurfaceIdx: uniqueIndex('plugin_runtime_surfaces_unique_surface_idx').on(
      table.productId,
      table.pluginId,
      table.surfaceType,
      table.surfaceKey
    ),
    productSurfaceIdx: index('plugin_runtime_surfaces_product_surface_idx').on(
      table.productId,
      table.surfaceType,
      table.status
    ),
    suiteIdx: index('plugin_runtime_surfaces_suite_idx').on(table.suiteId),
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
export const appProductsRelations = relations(appProducts, () => ({}));
export const pluginSuitesRelations = relations(pluginSuites, () => ({}));
export const pluginSuiteMembersRelations = relations(pluginSuiteMembers, () => ({}));
export const appBundlesRelations = relations(appBundles, () => ({}));
export const appBundleMembersRelations = relations(appBundleMembers, () => ({}));
export const pluginRuntimeSurfacesRelations = relations(pluginRuntimeSurfaces, () => ({}));

// Type Exports

export type PluginInstallation = typeof pluginInstallations.$inferSelect;
export type NewPluginInstallation = typeof pluginInstallations.$inferInsert;
export type AppProduct = typeof appProducts.$inferSelect;
export type NewAppProduct = typeof appProducts.$inferInsert;
export type PluginSuite = typeof pluginSuites.$inferSelect;
export type NewPluginSuite = typeof pluginSuites.$inferInsert;
export type PluginSuiteMember = typeof pluginSuiteMembers.$inferSelect;
export type NewPluginSuiteMember = typeof pluginSuiteMembers.$inferInsert;
export type AppBundle = typeof appBundles.$inferSelect;
export type NewAppBundle = typeof appBundles.$inferInsert;
export type AppBundleMember = typeof appBundleMembers.$inferSelect;
export type NewAppBundleMember = typeof appBundleMembers.$inferInsert;
export type PluginRuntimeSurface = typeof pluginRuntimeSurfaces.$inferSelect;
export type NewPluginRuntimeSurface = typeof pluginRuntimeSurfaces.$inferInsert;

export type PluginSetting = typeof pluginSettings.$inferSelect;
export type NewPluginSetting = typeof pluginSettings.$inferInsert;

export type PluginLifecycleLog = typeof pluginLifecycleLogs.$inferSelect;
export type NewPluginLifecycleLog = typeof pluginLifecycleLogs.$inferInsert;
export type PluginHostPageOverride = typeof pluginHostPageOverrides.$inferSelect;
export type NewPluginHostPageOverride = typeof pluginHostPageOverrides.$inferInsert;

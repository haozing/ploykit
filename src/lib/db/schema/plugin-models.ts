import { boolean, index, pgTable, text, uuid, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

/**
 * Plugin data model metadata table
 * Records information about each model created by plugins, used for management and cleanup
 */
export const pluginModels = pgTable(
  'plugin_models',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    productId: text('product_id').notNull(),
    pluginId: text('plugin_id').notNull(),

    // Model information
    modelName: text('model_name').notNull(), // e.g. ExportHistory
    tableName: text('table_name').notNull().unique(), // e.g. plugin_welcome_export_history

    // Model definition (JSON format)
    definition: jsonb('definition').notNull(),

    // Reconcile metadata for dynamic tables
    schemaHash: text('schema_hash').notNull(),
    ddl: text('ddl').notNull(),
    rlsEnabled: boolean('rls_enabled').notNull().default(true),
    createdByVersion: text('created_by_version').notNull(),

    // Version information (for future schema migrations)
    version: text('version').notNull().default('1.0.0'),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    productPluginIdx: index('plugin_models_product_plugin_idx').on(
      table.productId,
      table.pluginId
    ),
  })
);

/**
 * Relation definitions
 */
export const pluginModelsRelations = relations(pluginModels, () => ({}));

// Export types
export type PluginModel = typeof pluginModels.$inferSelect;
export type InsertPluginModel = typeof pluginModels.$inferInsert;

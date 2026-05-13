import { boolean, pgTable, text, uuid, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { pluginInstallations } from './plugins';

/**
 * Plugin data model metadata table
 * Records information about each model created by plugins, used for management and cleanup
 */
export const pluginModels = pgTable('plugin_models', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Plugin ID
  pluginId: text('plugin_id')
    .notNull()
    .references(() => pluginInstallations.pluginId, {
      onDelete: 'cascade', // Automatically delete model records when plugin is uninstalled
    }),

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
});

/**
 * Relation definitions
 */
export const pluginModelsRelations = relations(pluginModels, ({ one }) => ({
  installation: one(pluginInstallations, {
    fields: [pluginModels.pluginId],
    references: [pluginInstallations.pluginId],
  }),
}));

// Export types
export type PluginModel = typeof pluginModels.$inferSelect;
export type InsertPluginModel = typeof pluginModels.$inferInsert;

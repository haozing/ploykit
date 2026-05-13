import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const pluginConfig = pgTable(
  'plugin_config',
  {
    id: text('id').primaryKey(),
    pluginId: text('plugin_id').notNull(),
    userId: text('user_id').notNull().default(''),
    key: text('key').notNull(),
    value: jsonb('value').$type<unknown>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pluginUserKeyIdx: uniqueIndex('plugin_config_plugin_user_key_idx').on(
      table.pluginId,
      table.userId,
      table.key
    ),
    pluginIdx: index('plugin_config_plugin_idx').on(table.pluginId),
    userIdx: index('plugin_config_user_idx').on(table.userId),
  })
);

export const pluginSecrets = pgTable(
  'plugin_secrets',
  {
    id: text('id').primaryKey(),
    pluginId: text('plugin_id').notNull(),
    userId: text('user_id').notNull().default(''),
    name: text('name').notNull(),
    valueCiphertext: text('value_ciphertext').notNull(),
    encoding: text('encoding').notNull().default('aes-256-gcm-v1'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pluginUserNameIdx: uniqueIndex('plugin_secrets_plugin_user_name_idx').on(
      table.pluginId,
      table.userId,
      table.name
    ),
    pluginIdx: index('plugin_secrets_plugin_idx').on(table.pluginId),
    userIdx: index('plugin_secrets_user_idx').on(table.userId),
  })
);

export type PluginConfigRecord = typeof pluginConfig.$inferSelect;
export type NewPluginConfigRecord = typeof pluginConfig.$inferInsert;

export type PluginSecretRecord = typeof pluginSecrets.$inferSelect;
export type NewPluginSecretRecord = typeof pluginSecrets.$inferInsert;

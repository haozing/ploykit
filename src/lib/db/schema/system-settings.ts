import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export interface SystemSettingValue {
  [key: string]: unknown;
}

export const systemSettings = pgTable(
  'system_settings',
  {
    key: text('key').primaryKey(),
    value: jsonb('value').$type<SystemSettingValue>().notNull().default({}),
    description: text('description'),
    updatedBy: text('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    updatedAtIdx: index('system_settings_updated_at_idx').on(table.updatedAt),
    updatedByIdx: index('system_settings_updated_by_idx').on(table.updatedBy),
  })
);

export type SystemSetting = typeof systemSettings.$inferSelect;
export type NewSystemSetting = typeof systemSettings.$inferInsert;

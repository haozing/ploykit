import { index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { appProducts } from './plugins';
import { user } from './core';
import { workspaces } from './plugin-platform';

export const productScopePreferences = pgTable(
  'product_scope_preferences',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => appProducts.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userProductIdx: uniqueIndex('product_scope_preferences_user_product_idx').on(
      table.userId,
      table.productId
    ),
    productIdx: index('product_scope_preferences_product_idx').on(table.productId),
    workspaceIdx: index('product_scope_preferences_workspace_idx').on(table.workspaceId),
  })
);

export type ProductScopePreference = typeof productScopePreferences.$inferSelect;
export type NewProductScopePreference = typeof productScopePreferences.$inferInsert;


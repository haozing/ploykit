/**
 * Notifications Schema
 *
 * Stores user-visible notification records and queued delivery attempts.
 */

import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { user } from './core';

export type NotificationChannel = 'in_app' | 'email' | 'webhook';
export type NotificationStatus = 'pending' | 'sent' | 'failed';

export interface NotificationMetadata {
  pluginId?: string;
  requestId?: string;
  source?: string;
  [key: string]: unknown;
}

export const notifications = pgTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    channel: text('channel').$type<NotificationChannel>().notNull().default('in_app'),
    recipient: text('recipient').notNull(),
    subject: text('subject'),
    body: text('body').notNull(),
    status: text('status').$type<NotificationStatus>().notNull().default('pending'),
    error: text('error'),
    readAt: timestamp('read_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    metadata: jsonb('metadata').$type<NotificationMetadata>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userStatusIdx: index('notifications_user_status_idx').on(table.userId, table.status),
    userReadIdx: index('notifications_user_read_idx').on(table.userId, table.readAt),
    userCreatedAtIdx: index('notifications_user_created_at_idx').on(table.userId, table.createdAt),
    typeIdx: index('notifications_type_idx').on(table.type),
  })
);

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(user, {
    fields: [notifications.userId],
    references: [user.id],
  }),
}));

export type NotificationRecord = typeof notifications.$inferSelect;
export type NewNotificationRecord = typeof notifications.$inferInsert;

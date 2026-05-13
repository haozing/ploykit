/**
 * File Storage Schema (user-Level)
 *
 *
 * Database tables for file storage and management
 * Each file is owned by a user
 */

import { pgTable, text, timestamp, integer, varchar, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { user } from './core';

export type FileDeletionStatus = 'active' | 'pending_delete';
export type FileRetentionAction = 'none' | 'archive' | 'delete';

/**
 * Files Table
 *
 * Stores metadata for uploaded files
 *
 *
 * Ownership model:
 * - Each file is owned by a user (user_id)
 * - uploadedBy tracks who actually uploaded it (may differ from owner)
 * - Files are automatically deleted when owner is deleted (CASCADE)
 */
export const files = pgTable(
  'files',
  {
    // Primary key
    id: text('id').primaryKey(),

    // User ownership
    // References Better Auth user table
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),

    // File metadata
    fileName: varchar('file_name', { length: 255 }).notNull(),
    originalName: varchar('original_name', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    size: integer('size').notNull(), // in bytes

    // Upload tracking
    uploadedBy: text('uploaded_by').notNull(),
    uploadedByEmail: varchar('uploaded_by_email', { length: 255 }).notNull(),

    // Storage location
    path: text('path').notNull(),
    folder: varchar('folder', { length: 255 }),
    provider: varchar('provider', { length: 50 }).notNull().default('local'),

    // Retention policy metadata
    retentionAction: text('retention_action')
      .$type<FileRetentionAction>()
      .notNull()
      .default('none'),
    retentionUntil: timestamp('retention_until', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),

    // Delete workflow state
    deleteStatus: text('delete_status').$type<FileDeletionStatus>().notNull().default('active'),
    deleteRequestedAt: timestamp('delete_requested_at', { withTimezone: true }),
    deleteAttempts: integer('delete_attempts').notNull().default(0),
    deleteLastError: text('delete_last_error'),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Indexes for performance
    userIdx: index('idx_files_user_id').on(table.userId),
    uploadedByIdx: index('idx_files_uploaded_by').on(table.uploadedBy),
    createdAtIdx: index('idx_files_created_at').on(table.createdAt),
    deleteStatusIdx: index('idx_files_delete_status').on(table.deleteStatus),
    folderIdx: index('idx_files_folder').on(table.folder),
    providerIdx: index('idx_files_provider').on(table.provider),
    retentionIdx: index('idx_files_retention').on(table.retentionAction, table.retentionUntil),
    deleteStatusRequestedAtIdx: index('idx_files_delete_status_requested_at').on(
      table.deleteStatus,
      table.deleteRequestedAt
    ),
  })
);

/**
 * Files Relations
 *
 * Defines relationships with other tables for Drizzle ORM queries
 */
export const filesRelations = relations(files, ({ one }) => ({
  // File owner (the user who owns this file)
  owner: one(user, {
    fields: [files.userId],
    references: [user.id],
  }),
}));

// ?
// Type Exports
// ?

export type File = typeof files.$inferSelect;
export type NewFile = typeof files.$inferInsert;

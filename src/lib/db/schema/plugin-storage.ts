import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export type PluginCollectionSchema = Record<string, unknown>;
export type PluginCollectionIndexes = Array<Record<string, unknown>>;
export type PluginRecordData = Record<string, unknown>;

export const pluginCollections = pgTable(
  'plugin_collections',
  {
    id: text('id').primaryKey(),
    pluginId: text('plugin_id').notNull(),
    name: text('name').notNull(),
    schemaJson: jsonb('schema_json').$type<PluginCollectionSchema>().notNull(),
    schemaHash: text('schema_hash').notNull(),
    indexesJson: jsonb('indexes_json').$type<PluginCollectionIndexes>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pluginNameIdx: uniqueIndex('plugin_collections_plugin_name_idx').on(table.pluginId, table.name),
    pluginIdx: index('plugin_collections_plugin_idx').on(table.pluginId),
    schemaHashIdx: index('plugin_collections_schema_hash_idx').on(table.schemaHash),
  })
);

export const pluginRecords = pgTable(
  'plugin_records',
  {
    id: text('id').primaryKey(),
    pluginId: text('plugin_id').notNull(),
    collectionName: text('collection_name').notNull(),
    userId: text('user_id'),
    data: jsonb('data').$type<PluginRecordData>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    pluginCollectionRecordIdx: uniqueIndex('plugin_records_plugin_collection_record_idx').on(
      table.pluginId,
      table.collectionName,
      table.id
    ),
    pluginCollectionIdx: index('plugin_records_plugin_collection_idx').on(
      table.pluginId,
      table.collectionName
    ),
    userIdx: index('plugin_records_user_idx').on(table.userId),
    activeIdx: index('plugin_records_active_idx').on(
      table.pluginId,
      table.collectionName,
      table.userId,
      table.deletedAt
    ),
    createdAtIdx: index('plugin_records_created_at_idx').on(table.createdAt),
  })
);

export const pluginArtifacts = pgTable(
  'plugin_artifacts',
  {
    id: text('id').primaryKey(),
    pluginId: text('plugin_id').notNull(),
    userId: text('user_id'),
    scopeType: text('scope_type').notNull(),
    scopeId: text('scope_id').notNull(),
    path: text('path').notNull(),
    contentType: text('content_type').notNull(),
    content: text('content').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    version: integer('version').notNull().default(1),
    size: integer('size').notNull().default(0),
    hash: text('hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    activePathIdx: uniqueIndex('plugin_artifacts_active_path_idx')
      .on(table.pluginId, table.userId, table.scopeType, table.scopeId, table.path)
      .where(sql`${table.deletedAt} IS NULL`),
    activeUserPathIdx: uniqueIndex('plugin_artifacts_active_user_path_idx')
      .on(table.pluginId, table.userId, table.scopeType, table.scopeId, table.path)
      .where(sql`${table.deletedAt} IS NULL AND ${table.scopeType} = 'user'`),
    activeWorkspacePathIdx: uniqueIndex('plugin_artifacts_active_workspace_path_idx')
      .on(table.pluginId, table.scopeType, table.scopeId, table.path)
      .where(sql`${table.deletedAt} IS NULL AND ${table.scopeType} = 'workspace'`),
    scopeIdx: index('plugin_artifacts_scope_idx').on(
      table.pluginId,
      table.userId,
      table.scopeType,
      table.scopeId
    ),
    workspaceScopeIdx: index('plugin_artifacts_workspace_scope_idx').on(
      table.pluginId,
      table.scopeType,
      table.scopeId
    ),
    pluginIdx: index('plugin_artifacts_plugin_idx').on(table.pluginId),
    userIdx: index('plugin_artifacts_user_idx').on(table.userId),
    hashIdx: index('plugin_artifacts_hash_idx').on(table.hash),
    updatedAtIdx: index('plugin_artifacts_updated_at_idx').on(table.updatedAt),
  })
);

export const pluginRagChunks = pgTable(
  'plugin_rag_chunks',
  {
    id: text('id').primaryKey(),
    pluginId: text('plugin_id').notNull(),
    userId: text('user_id'),
    scopeType: text('scope_type').notNull(),
    scopeId: text('scope_id').notNull(),
    sourceId: text('source_id').notNull(),
    sourcePath: text('source_path'),
    sourceHash: text('source_hash').notNull(),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    contentHash: text('content_hash').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    activeChunkIdx: uniqueIndex('plugin_rag_chunks_active_chunk_idx')
      .on(
        table.pluginId,
        table.userId,
        table.scopeType,
        table.scopeId,
        table.sourceId,
        table.chunkIndex
      )
      .where(sql`${table.deletedAt} IS NULL`),
    scopeIdx: index('plugin_rag_chunks_scope_idx').on(
      table.pluginId,
      table.userId,
      table.scopeType,
      table.scopeId
    ),
    sourceIdx: index('plugin_rag_chunks_source_idx').on(
      table.pluginId,
      table.userId,
      table.scopeType,
      table.scopeId,
      table.sourceId
    ),
    pathIdx: index('plugin_rag_chunks_path_idx').on(table.sourcePath),
    sourceHashIdx: index('plugin_rag_chunks_source_hash_idx').on(table.sourceHash),
    contentHashIdx: index('plugin_rag_chunks_content_hash_idx').on(table.contentHash),
  })
);

export type PluginCollection = typeof pluginCollections.$inferSelect;
export type NewPluginCollection = typeof pluginCollections.$inferInsert;
export type PluginRecord = typeof pluginRecords.$inferSelect;
export type NewPluginRecord = typeof pluginRecords.$inferInsert;
export type PluginArtifact = typeof pluginArtifacts.$inferSelect;
export type NewPluginArtifact = typeof pluginArtifacts.$inferInsert;
export type PluginRagChunk = typeof pluginRagChunks.$inferSelect;
export type NewPluginRagChunk = typeof pluginRagChunks.$inferInsert;

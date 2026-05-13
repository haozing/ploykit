import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export type ResourceScopeType = 'user' | 'workspace';
export type WorkspaceRole = 'owner' | 'admin' | 'editor' | 'viewer';

export const workspaces = pgTable(
  'workspaces',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug'),
    ownerUserId: text('owner_user_id').notNull(),
    status: text('status').notNull().default('active'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    slugIdx: uniqueIndex('workspaces_slug_idx').on(table.slug),
    ownerIdx: index('workspaces_owner_idx').on(table.ownerUserId),
    statusIdx: index('workspaces_status_idx').on(table.status),
  })
);

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    userId: text('user_id').notNull(),
    role: text('role').notNull(),
    status: text('status').notNull().default('active'),
    email: text('email'),
    joinedAt: timestamp('joined_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceUserIdx: uniqueIndex('workspace_members_workspace_user_idx').on(
      table.workspaceId,
      table.userId
    ),
    workspaceIdx: index('workspace_members_workspace_idx').on(table.workspaceId),
    userIdx: index('workspace_members_user_idx').on(table.userId),
    roleIdx: index('workspace_members_role_idx').on(table.role),
  })
);

export const workspaceInvitations = pgTable(
  'workspace_invitations',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    email: text('email').notNull(),
    role: text('role').notNull(),
    status: text('status').notNull().default('pending'),
    invitedByUserId: text('invited_by_user_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceEmailIdx: index('workspace_invitations_workspace_email_idx').on(
      table.workspaceId,
      table.email
    ),
    statusIdx: index('workspace_invitations_status_idx').on(table.status),
  })
);

export const pluginRuns = pgTable(
  'plugin_runs',
  {
    id: text('id').primaryKey(),
    pluginId: text('plugin_id').notNull(),
    userId: text('user_id'),
    scopeType: text('scope_type').notNull(),
    scopeId: text('scope_id').notNull(),
    title: text('title').notNull(),
    visibility: text('visibility').notNull().default('internal'),
    status: text('status').notNull(),
    progress: integer('progress').notNull().default(0),
    inputs: jsonb('inputs').$type<Record<string, unknown>[]>().notNull().default([]),
    costs: jsonb('costs').$type<Record<string, unknown>[]>().notNull().default([]),
    retry: jsonb('retry').$type<Record<string, unknown>>(),
    idempotencyKey: text('idempotency_key'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    error: jsonb('error').$type<Record<string, unknown>>(),
    cancelReason: text('cancel_reason'),
    cancelRequestedAt: timestamp('cancel_requested_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pluginScopeIdx: index('plugin_runs_plugin_scope_idx').on(
      table.pluginId,
      table.scopeType,
      table.scopeId
    ),
    pluginStatusIdx: index('plugin_runs_plugin_status_idx').on(table.pluginId, table.status),
    visibilityIdx: index('plugin_runs_visibility_idx').on(table.visibility),
    idempotencyIdx: uniqueIndex('plugin_runs_idempotency_idx').on(
      table.pluginId,
      table.userId,
      table.idempotencyKey
    ),
  })
);

export const pluginRunSteps = pgTable(
  'plugin_run_steps',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull(),
    progress: integer('progress').notNull().default(0),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    error: jsonb('error').$type<Record<string, unknown>>(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    runIdx: index('plugin_run_steps_run_idx').on(table.runId),
  })
);

export const pluginRunLogs = pgTable(
  'plugin_run_logs',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull(),
    level: text('level').notNull(),
    message: text('message').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    runIdx: index('plugin_run_logs_run_idx').on(table.runId),
    createdAtIdx: index('plugin_run_logs_created_at_idx').on(table.createdAt),
  })
);

export const pluginRunResults = pgTable(
  'plugin_run_results',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull(),
    type: text('type').notNull(),
    ref: text('ref').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    runIdx: index('plugin_run_results_run_idx').on(table.runId),
    typeIdx: index('plugin_run_results_type_idx').on(table.type),
  })
);

export const pluginFiles = pgTable(
  'plugin_files',
  {
    id: text('id').primaryKey(),
    pluginId: text('plugin_id').notNull(),
    userId: text('user_id'),
    scopeType: text('scope_type').notNull(),
    scopeId: text('scope_id').notNull(),
    ownerUserId: text('owner_user_id').notNull(),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull().default(0),
    hash: text('hash'),
    purpose: text('purpose').notNull().default('source'),
    status: text('status').notNull().default('pending_upload'),
    storageKey: text('storage_key').notNull(),
    storageProvider: text('storage_provider').notNull().default('local'),
    runId: text('run_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pluginScopeIdx: index('plugin_files_plugin_scope_idx').on(
      table.pluginId,
      table.scopeType,
      table.scopeId
    ),
    pluginStatusIdx: index('plugin_files_plugin_status_idx').on(table.pluginId, table.status),
    ownerIdx: index('plugin_files_owner_idx').on(table.ownerUserId),
    runIdx: index('plugin_files_run_idx').on(table.runId),
    expiresIdx: index('plugin_files_expires_idx').on(table.expiresAt),
    storageKeyIdx: uniqueIndex('plugin_files_storage_key_idx').on(table.storageKey),
  })
);

export const pluginConnectors = pgTable(
  'plugin_connectors',
  {
    id: text('id').primaryKey(),
    pluginId: text('plugin_id').notNull(),
    name: text('name').notNull(),
    type: text('type').notNull(),
    scopeType: text('scope_type'),
    scopeId: text('scope_id'),
    baseUrl: text('base_url').notNull(),
    auth: jsonb('auth').$type<Record<string, unknown>>().notNull().default({ type: 'none' }),
    authType: text('auth_type').notNull().default('none'),
    secretName: text('secret_name'),
    egress: jsonb('egress').$type<Record<string, unknown>>().notNull().default({}),
    retry: jsonb('retry').$type<Record<string, unknown>>().notNull().default({}),
    redaction: jsonb('redaction').$type<Record<string, unknown>>().notNull().default({}),
    status: text('status').notNull().default('active'),
    timeoutMs: integer('timeout_ms').notNull().default(30000),
    retryCount: integer('retry_count').notNull().default(0),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pluginNameIdx: uniqueIndex('plugin_connectors_plugin_name_idx').on(
      table.pluginId,
      table.name,
      table.scopeType,
      table.scopeId
    ),
    pluginIdx: index('plugin_connectors_plugin_idx').on(table.pluginId),
    scopeIdx: index('plugin_connectors_scope_idx').on(table.scopeType, table.scopeId),
  })
);

export const pluginConnectorCallLogs = pgTable(
  'plugin_connector_call_logs',
  {
    id: text('id').primaryKey(),
    pluginId: text('plugin_id').notNull(),
    connectorName: text('connector_name').notNull(),
    userId: text('user_id'),
    runId: text('run_id'),
    method: text('method').notNull(),
    url: text('url').notNull(),
    status: integer('status'),
    ok: text('ok').notNull().default('false'),
    durationMs: integer('duration_ms'),
    meter: text('meter'),
    creditsConsumed: integer('credits_consumed').notNull().default(0),
    requestMetadata: jsonb('request_metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    responseMetadata: jsonb('response_metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    error: jsonb('error').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pluginConnectorIdx: index('plugin_connector_call_logs_plugin_connector_idx').on(
      table.pluginId,
      table.connectorName
    ),
    runIdx: index('plugin_connector_call_logs_run_idx').on(table.runId),
    createdAtIdx: index('plugin_connector_call_logs_created_at_idx').on(table.createdAt),
  })
);

export const pluginApiKeys = pgTable(
  'plugin_api_keys',
  {
    id: text('id').primaryKey(),
    pluginId: text('plugin_id').notNull(),
    userId: text('user_id'),
    scopeType: text('scope_type').notNull(),
    scopeId: text('scope_id').notNull(),
    name: text('name').notNull(),
    prefix: text('prefix').notNull(),
    keyHash: text('key_hash').notNull(),
    permissions: jsonb('permissions').$type<string[]>().notNull().default([]),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    hashIdx: uniqueIndex('plugin_api_keys_hash_idx').on(table.keyHash),
    pluginScopeIdx: index('plugin_api_keys_plugin_scope_idx').on(
      table.pluginId,
      table.scopeType,
      table.scopeId
    ),
    prefixIdx: index('plugin_api_keys_prefix_idx').on(table.prefix),
  })
);

export const pluginRateLimitBuckets = pgTable(
  'plugin_rate_limit_buckets',
  {
    id: text('id').primaryKey(),
    pluginId: text('plugin_id').notNull(),
    bucket: text('bucket').notNull(),
    windowKey: text('window_key').notNull(),
    count: integer('count').notNull().default(0),
    limit: integer('limit').notNull(),
    resetAt: timestamp('reset_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    bucketWindowIdx: uniqueIndex('plugin_rate_limit_buckets_bucket_window_idx').on(
      table.pluginId,
      table.bucket,
      table.windowKey
    ),
    resetIdx: index('plugin_rate_limit_buckets_reset_idx').on(table.resetAt),
  })
);

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type NewWorkspaceMember = typeof workspaceMembers.$inferInsert;
export type WorkspaceInvitation = typeof workspaceInvitations.$inferSelect;
export type NewWorkspaceInvitation = typeof workspaceInvitations.$inferInsert;
export type PluginRun = typeof pluginRuns.$inferSelect;
export type NewPluginRun = typeof pluginRuns.$inferInsert;
export type PluginRunLog = typeof pluginRunLogs.$inferSelect;
export type NewPluginRunLog = typeof pluginRunLogs.$inferInsert;
export type PluginRunResult = typeof pluginRunResults.$inferSelect;
export type NewPluginRunResult = typeof pluginRunResults.$inferInsert;
export type PluginFile = typeof pluginFiles.$inferSelect;
export type NewPluginFile = typeof pluginFiles.$inferInsert;
export type PluginConnector = typeof pluginConnectors.$inferSelect;
export type NewPluginConnector = typeof pluginConnectors.$inferInsert;
export type PluginConnectorCallLog = typeof pluginConnectorCallLogs.$inferSelect;
export type NewPluginConnectorCallLog = typeof pluginConnectorCallLogs.$inferInsert;
export type PluginApiKey = typeof pluginApiKeys.$inferSelect;
export type NewPluginApiKey = typeof pluginApiKeys.$inferInsert;
export type PluginRateLimitBucket = typeof pluginRateLimitBuckets.$inferSelect;
export type NewPluginRateLimitBucket = typeof pluginRateLimitBuckets.$inferInsert;

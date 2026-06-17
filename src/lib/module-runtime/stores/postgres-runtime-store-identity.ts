import type { ModuleDataPostgresExecutor } from '../data';
import { redactSensitive } from '../observability/redaction';
import type { RuntimeStore, RuntimeStoreHostUserStatus } from './runtime-store-types';
import { mapApiKey, mapHostUser, type Row } from './postgres-runtime-store-mappers';
import { json, runtimeWorkspaceFilter } from './postgres-runtime-store-utils';

export type PostgresIdentityStore = Pick<
  RuntimeStore,
  | 'createApiKey'
  | 'getApiKey'
  | 'findApiKeyByHash'
  | 'updateApiKey'
  | 'listApiKeys'
  | 'upsertHostUser'
  | 'getHostUser'
  | 'findHostUserByEmail'
  | 'listHostUsers'
  | 'updateHostUserStatus'
>;

export interface CreatePostgresIdentityStoreOptions {
  database: ModuleDataPostgresExecutor;
  createId: (prefix: string) => string;
}

export function createPostgresIdentityStore(
  options: CreatePostgresIdentityStoreOptions
): PostgresIdentityStore {
  const { database, createId } = options;

  return {
    async createApiKey(input) {
      const id = input.id ?? createId('api_key');
      const result = await database.query<Row>(
        `insert into module_api_keys (
          id, product_id, environment_id, workspace_id, module_id, name, prefix, key_hash,
          owner_subject_type, owner_subject_id, created_by, permissions, rate_limit,
          status, expires_at, revoked_at, last_used_at, metadata
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb,
          $14, $15::timestamptz, $16::timestamptz, $17::timestamptz, $18::jsonb)
        returning *`,
        [
          id,
          input.productId,
          input.environmentId ?? null,
          input.workspaceId ?? null,
          input.moduleId ?? null,
          input.name,
          input.prefix,
          input.keyHash,
          input.ownerSubjectType ?? null,
          input.ownerSubjectId ?? null,
          input.createdBy ?? null,
          json(input.permissions ?? []),
          json(input.rateLimit ?? null),
          input.status ?? 'active',
          input.expiresAt ?? null,
          input.revokedAt ?? null,
          input.lastUsedAt ?? null,
          json(redactSensitive(input.metadata ?? {})),
        ]
      );
      return mapApiKey(result.rows[0]!);
    },
    async getApiKey(input) {
      const result = await database.query<Row>(
        `select * from module_api_keys
         where id = $1
           and ($2::text is null or product_id = $2)
           and ($3::text is null or environment_id is null or coalesce(environment_id, ''::text) = $3)
           and ($4::text is null or coalesce(workspace_id, ''::text) = $4)`,
        [
          input.id,
          input.productId ?? null,
          runtimeWorkspaceFilter(input.environmentId),
          runtimeWorkspaceFilter(input.workspaceId),
        ]
      );
      return result.rows[0] ? mapApiKey(result.rows[0]) : null;
    },
    async findApiKeyByHash(input) {
      const result = await database.query<Row>(
        `select * from module_api_keys
         where key_hash = $1
           and ($2::text is null or prefix = $2)
           and ($3::text is null or product_id = $3)
           and ($4::text is null or environment_id is null or coalesce(environment_id, ''::text) = $4)
         order by created_at desc
         limit 1`,
        [
          input.keyHash,
          input.prefix ?? null,
          input.productId ?? null,
          runtimeWorkspaceFilter(input.environmentId),
        ]
      );
      return result.rows[0] ? mapApiKey(result.rows[0]) : null;
    },
    async updateApiKey(id, patch) {
      const result = await database.query<Row>(
        `update module_api_keys
         set prefix = coalesce($2, prefix),
             key_hash = coalesce($3, key_hash),
             status = coalesce($4, status),
             expires_at = case when $5::boolean then null else coalesce($6::timestamptz, expires_at) end,
             revoked_at = case when $7::boolean then null else coalesce($8::timestamptz, revoked_at) end,
             last_used_at = case when $9::boolean then null else coalesce($10::timestamptz, last_used_at) end,
             rate_limit = case when $11::boolean then null else coalesce($12::jsonb, rate_limit) end,
             metadata = metadata || $13::jsonb,
             updated_at = now()
         where id = $1
         returning *`,
        [
          id,
          patch.prefix ?? null,
          patch.keyHash ?? null,
          patch.status ?? null,
          patch.expiresAt === null,
          patch.expiresAt ?? null,
          patch.revokedAt === null,
          patch.revokedAt ?? null,
          patch.lastUsedAt === null,
          patch.lastUsedAt ?? null,
          patch.rateLimit === null,
          json(patch.rateLimit ?? null),
          json(redactSensitive(patch.metadata ?? {})),
        ]
      );
      if (!result.rows[0]) {
        throw new Error(`RUNTIME_STORE_API_KEY_NOT_FOUND: ${id}`);
      }
      return mapApiKey(result.rows[0]);
    },
    async listApiKeys(query = {}) {
      const result = await database.query<Row>(
        `select * from module_api_keys
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(environment_id, ''::text) = $2)
           and ($3::text is null or coalesce(workspace_id, ''::text) = $3)
           and ($4::text is null or coalesce(module_id, ''::text) = $4)
           and ($5::text is null or owner_subject_type = $5)
           and ($6::text is null or owner_subject_id = $6)
           and ($7::text is null or status = $7)
         order by created_at desc`,
        [
          query.productId ?? null,
          runtimeWorkspaceFilter(query.environmentId),
          runtimeWorkspaceFilter(query.workspaceId),
          query.moduleId === undefined ? null : (query.moduleId ?? ''),
          query.ownerSubjectType ?? null,
          query.ownerSubjectId ?? null,
          query.status ?? null,
        ]
      );
      return result.rows.map(mapApiKey);
    },
    async upsertHostUser(input) {
      const result = await database.query<Row>(
        `insert into module_host_users (
          id, email, password_hash, role, status, product_id, workspace_id,
          workspace_role, permissions, metadata
        )
        values ($1, lower($2), $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)
        on conflict (id)
        do update set
          email = excluded.email,
          password_hash = excluded.password_hash,
          role = excluded.role,
          status = excluded.status,
          product_id = excluded.product_id,
          workspace_id = excluded.workspace_id,
          workspace_role = excluded.workspace_role,
          permissions = excluded.permissions,
          metadata = excluded.metadata,
          updated_at = now()
        returning *`,
        [
          input.id,
          input.email,
          input.passwordHash,
          input.role,
          input.status,
          input.productId,
          input.workspaceId,
          input.workspaceRole,
          json(input.permissions ?? null),
          json(input.metadata ?? {}),
        ]
      );
      return mapHostUser(result.rows[0]!);
    },
    async getHostUser(id) {
      const result = await database.query<Row>('select * from module_host_users where id = $1', [
        id,
      ]);
      return result.rows[0] ? mapHostUser(result.rows[0]) : null;
    },
    async findHostUserByEmail(email) {
      const result = await database.query<Row>(
        'select * from module_host_users where lower(email) = lower($1) limit 1',
        [email]
      );
      return result.rows[0] ? mapHostUser(result.rows[0]) : null;
    },
    async listHostUsers(query = {}) {
      const result = await database.query<Row>(
        `select * from module_host_users
         where ($1::text is null or product_id = $1)
           and ($2::text is null or role = $2)
           and ($3::text is null or status = $3)
         order by created_at asc`,
        [query.productId ?? null, query.role ?? null, query.status ?? null]
      );
      return result.rows.map(mapHostUser);
    },
    async updateHostUserStatus(id: string, status: RuntimeStoreHostUserStatus, metadata) {
      const result = await database.query<Row>(
        `update module_host_users
         set status = $2,
             metadata = metadata || $3::jsonb,
             updated_at = now()
         where id = $1
         returning *`,
        [id, status, json(metadata ?? {})]
      );
      if (!result.rows[0]) {
        throw new Error(`RUNTIME_STORE_HOST_USER_NOT_FOUND: ${id}`);
      }
      return mapHostUser(result.rows[0]);
    },
  };
}

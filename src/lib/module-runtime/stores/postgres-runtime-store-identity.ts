import type { ModuleDataPostgresExecutor } from '../data';
import { redactSensitive } from '../observability/redaction';
import type {
  RuntimeStore,
  RuntimeStoreAuthSessionStatus,
  RuntimeStoreHostUserStatus,
  RuntimeStorePlatformUserStatus,
  RuntimeStoreUserIdentityStatus,
  RuntimeStoreWorkspaceInviteStatus,
  RuntimeStoreWorkspaceMemberStatus,
} from './runtime-store-types';
import {
  mapApiKey,
  mapAuthSession,
  mapHostUser,
  mapPlatformUser,
  mapUserIdentity,
  mapWorkspaceInvite,
  mapWorkspaceMember,
  type Row,
} from './postgres-runtime-store-mappers';
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
  | 'upsertPlatformUser'
  | 'getPlatformUser'
  | 'findPlatformUserByEmail'
  | 'listPlatformUsers'
  | 'updatePlatformUserStatus'
  | 'upsertWorkspaceMember'
  | 'listWorkspaceMembers'
  | 'updateWorkspaceMemberStatus'
  | 'upsertWorkspaceInvite'
  | 'getWorkspaceInvite'
  | 'findWorkspaceInviteByTokenHash'
  | 'listWorkspaceInvites'
  | 'updateWorkspaceInviteStatus'
  | 'createAuthSession'
  | 'getAuthSession'
  | 'listAuthSessions'
  | 'touchAuthSession'
  | 'revokeAuthSession'
  | 'revokeAuthSessions'
  | 'upsertUserIdentity'
  | 'findUserIdentity'
  | 'listUserIdentities'
  | 'updateUserIdentityStatus'
>;

export interface CreatePostgresIdentityStoreOptions {
  database: ModuleDataPostgresExecutor;
  createId: (prefix: string) => string;
}

function normalizeProvider(provider: string): string {
  return provider.trim().toLowerCase();
}

function normalizeIdentityEmail(email: string | undefined): string | null {
  return email?.trim().toLowerCase() || null;
}

function normalizePlatformEmail(email: string): string {
  return email.trim().toLowerCase();
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
    async upsertPlatformUser(input) {
      const existingResult = await database.query<Row>(
        'select * from module_platform_users where lower(email) = lower($1) limit 1',
        [input.email]
      );
      const existing = existingResult.rows[0] ? mapPlatformUser(existingResult.rows[0]) : null;
      if (existing && input.id && existing.id !== input.id) {
        throw new Error(`RUNTIME_STORE_PLATFORM_USER_EMAIL_CONFLICT: ${input.email}`);
      }
      const id = existing?.id ?? input.id ?? createId('platform_user');
      const result = await database.query<Row>(
        `insert into module_platform_users (
          id, email, display_name, status, metadata, created_at, updated_at
        )
        values (
          $1, lower($2), $3, $4, $5::jsonb,
          coalesce($6::timestamptz, now()),
          coalesce($7::timestamptz, now())
        )
        on conflict (id)
        do update set
          email = excluded.email,
          display_name = coalesce(excluded.display_name, module_platform_users.display_name),
          status = excluded.status,
          metadata = module_platform_users.metadata || excluded.metadata,
          updated_at = excluded.updated_at
        returning *`,
        [
          id,
          input.email,
          input.displayName ?? null,
          input.status ?? existing?.status ?? 'active',
          json(redactSensitive(input.metadata ?? {})),
          input.createdAt ?? null,
          input.updatedAt ?? null,
        ]
      );
      return mapPlatformUser(result.rows[0]!);
    },
    async getPlatformUser(id) {
      const result = await database.query<Row>('select * from module_platform_users where id = $1', [
        id,
      ]);
      return result.rows[0] ? mapPlatformUser(result.rows[0]) : null;
    },
    async findPlatformUserByEmail(email) {
      const result = await database.query<Row>(
        'select * from module_platform_users where lower(email) = lower($1) limit 1',
        [email]
      );
      return result.rows[0] ? mapPlatformUser(result.rows[0]) : null;
    },
    async listPlatformUsers(query = {}) {
      const result = await database.query<Row>(
        `select * from module_platform_users
         where ($1::text is null or status = $1)
         order by created_at asc`,
        [query.status ?? null]
      );
      return result.rows.map(mapPlatformUser);
    },
    async updatePlatformUserStatus(
      id: string,
      status: RuntimeStorePlatformUserStatus,
      metadata
    ) {
      const result = await database.query<Row>(
        `update module_platform_users
         set status = $2,
             metadata = metadata || $3::jsonb,
             updated_at = now()
         where id = $1
         returning *`,
        [id, status, json(redactSensitive(metadata ?? {}))]
      );
      if (!result.rows[0]) {
        throw new Error(`RUNTIME_STORE_PLATFORM_USER_NOT_FOUND: ${id}`);
      }
      return mapPlatformUser(result.rows[0]);
    },
    async upsertWorkspaceMember(input) {
      const result = await database.query<Row>(
        `insert into module_workspace_members (
          id, product_id, workspace_id, platform_user_id, role, status,
          metadata, created_at, updated_at
        )
        values (
          $1, $2, $3, $4, $5, $6, $7::jsonb,
          coalesce($8::timestamptz, now()),
          coalesce($9::timestamptz, now())
        )
        on conflict (product_id, workspace_id, platform_user_id)
        do update set
          role = excluded.role,
          status = excluded.status,
          metadata = module_workspace_members.metadata || excluded.metadata,
          updated_at = excluded.updated_at
        returning *`,
        [
          input.id ?? createId('workspace_member'),
          input.productId,
          input.workspaceId,
          input.platformUserId,
          input.role,
          input.status ?? 'active',
          json(redactSensitive(input.metadata ?? {})),
          input.createdAt ?? null,
          input.updatedAt ?? null,
        ]
      );
      return mapWorkspaceMember(result.rows[0]!);
    },
    async listWorkspaceMembers(query = {}) {
      const result = await database.query<Row>(
        `select * from module_workspace_members
         where ($1::text is null or product_id = $1)
           and ($2::text is null or workspace_id = $2)
           and ($3::text is null or platform_user_id = $3)
           and ($4::text is null or status = $4)
         order by updated_at desc`,
        [
          query.productId ?? null,
          query.workspaceId ?? null,
          query.platformUserId ?? null,
          query.status ?? null,
        ]
      );
      return result.rows.map(mapWorkspaceMember);
    },
    async updateWorkspaceMemberStatus(
      id: string,
      status: RuntimeStoreWorkspaceMemberStatus,
      metadata
    ) {
      const result = await database.query<Row>(
        `update module_workspace_members
         set status = $2,
             metadata = metadata || $3::jsonb,
             updated_at = now()
         where id = $1
         returning *`,
        [id, status, json(redactSensitive(metadata ?? {}))]
      );
      if (!result.rows[0]) {
        throw new Error(`RUNTIME_STORE_WORKSPACE_MEMBER_NOT_FOUND: ${id}`);
      }
      return mapWorkspaceMember(result.rows[0]);
    },
    async upsertWorkspaceInvite(input) {
      const result = await database.query<Row>(
        `insert into module_workspace_invites (
          id, product_id, workspace_id, email, role, status, token_hash,
          invited_by_platform_user_id, accepted_by_platform_user_id,
          expires_at, accepted_at, revoked_at, metadata, created_at, updated_at
        )
        values (
          $1, $2, $3, lower($4), $5, $6, $7, $8, $9,
          $10::timestamptz, $11::timestamptz, $12::timestamptz, $13::jsonb,
          coalesce($14::timestamptz, now()),
          coalesce($15::timestamptz, now())
        )
        on conflict (token_hash)
        do update set
          email = excluded.email,
          role = excluded.role,
          status = excluded.status,
          invited_by_platform_user_id = coalesce(
            excluded.invited_by_platform_user_id,
            module_workspace_invites.invited_by_platform_user_id
          ),
          accepted_by_platform_user_id = coalesce(
            excluded.accepted_by_platform_user_id,
            module_workspace_invites.accepted_by_platform_user_id
          ),
          expires_at = excluded.expires_at,
          accepted_at = coalesce(excluded.accepted_at, module_workspace_invites.accepted_at),
          revoked_at = coalesce(excluded.revoked_at, module_workspace_invites.revoked_at),
          metadata = module_workspace_invites.metadata || excluded.metadata,
          updated_at = excluded.updated_at
        returning *`,
        [
          input.id ?? createId('workspace_invite'),
          input.productId,
          input.workspaceId,
          input.email,
          input.role,
          input.status ?? 'pending',
          input.tokenHash,
          input.invitedByPlatformUserId ?? null,
          input.acceptedByPlatformUserId ?? null,
          input.expiresAt,
          input.acceptedAt ?? null,
          input.revokedAt ?? null,
          json(redactSensitive(input.metadata ?? {})),
          input.createdAt ?? null,
          input.updatedAt ?? null,
        ]
      );
      return mapWorkspaceInvite(result.rows[0]!);
    },
    async getWorkspaceInvite(id) {
      const result = await database.query<Row>(
        'select * from module_workspace_invites where id = $1',
        [id]
      );
      return result.rows[0] ? mapWorkspaceInvite(result.rows[0]) : null;
    },
    async findWorkspaceInviteByTokenHash(tokenHash) {
      const result = await database.query<Row>(
        'select * from module_workspace_invites where token_hash = $1 limit 1',
        [tokenHash]
      );
      return result.rows[0] ? mapWorkspaceInvite(result.rows[0]) : null;
    },
    async listWorkspaceInvites(query = {}) {
      const result = await database.query<Row>(
        `select * from module_workspace_invites
         where ($1::text is null or product_id = $1)
           and ($2::text is null or workspace_id = $2)
           and ($3::text is null or status = $3)
           and ($4::text is null or email = lower($4))
         order by created_at desc`,
        [
          query.productId ?? null,
          query.workspaceId ?? null,
          query.status ?? null,
          query.email ?? null,
        ]
      );
      return result.rows.map(mapWorkspaceInvite);
    },
    async updateWorkspaceInviteStatus(
      id: string,
      status: RuntimeStoreWorkspaceInviteStatus,
      patch = {}
    ) {
      const result = await database.query<Row>(
        `update module_workspace_invites
         set status = $2,
             accepted_by_platform_user_id = coalesce($3, accepted_by_platform_user_id),
             accepted_at = coalesce($4::timestamptz, accepted_at),
             revoked_at = coalesce($5::timestamptz, revoked_at),
             metadata = metadata || $6::jsonb,
             updated_at = now()
         where id = $1
         returning *`,
        [
          id,
          status,
          patch.acceptedByPlatformUserId ?? null,
          patch.acceptedAt ?? null,
          patch.revokedAt ?? null,
          json(redactSensitive(patch.metadata ?? {})),
        ]
      );
      if (!result.rows[0]) {
        throw new Error(`RUNTIME_STORE_WORKSPACE_INVITE_NOT_FOUND: ${id}`);
      }
      return mapWorkspaceInvite(result.rows[0]);
    },
    async createAuthSession(input) {
      const id = input.id ?? createId('auth_session');
      const result = await database.query<Row>(
        `insert into module_auth_sessions (
          id, product_id, environment_id, workspace_id, subject_type, subject_id,
          device_id, session_type, status, last_seen_at, expires_at, revoked_at,
          revoked_reason, metadata
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          coalesce($10::timestamptz, now()),
          $11::timestamptz,
          $12::timestamptz,
          $13,
          $14::jsonb
        )
        returning *`,
        [
          id,
          input.productId,
          input.environmentId ?? null,
          input.workspaceId ?? null,
          input.subjectType,
          input.subjectId,
          input.deviceId ?? null,
          input.sessionType ?? 'browser',
          input.status ?? 'active',
          input.lastSeenAt ?? null,
          input.expiresAt ?? null,
          input.revokedAt ?? null,
          input.revokedReason ?? null,
          json(redactSensitive(input.metadata ?? {})),
        ]
      );
      return mapAuthSession(result.rows[0]!);
    },
    async getAuthSession(id) {
      const result = await database.query<Row>('select * from module_auth_sessions where id = $1', [
        id,
      ]);
      return result.rows[0] ? mapAuthSession(result.rows[0]) : null;
    },
    async listAuthSessions(query = {}) {
      const result = await database.query<Row>(
        `select * from module_auth_sessions
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(environment_id, ''::text) = $2)
           and ($3::text is null or coalesce(workspace_id, ''::text) = $3)
           and ($4::text is null or subject_type = $4)
           and ($5::text is null or subject_id = $5)
           and ($6::text is null or status = $6)
           and ($7::text is null or session_type = $7)
         order by last_seen_at desc`,
        [
          query.productId ?? null,
          runtimeWorkspaceFilter(query.environmentId),
          runtimeWorkspaceFilter(query.workspaceId),
          query.subjectType ?? null,
          query.subjectId ?? null,
          query.status ?? null,
          query.sessionType ?? null,
        ]
      );
      return result.rows.map(mapAuthSession);
    },
    async touchAuthSession(id, patch = {}) {
      const result = await database.query<Row>(
        `update module_auth_sessions
         set last_seen_at = coalesce($2::timestamptz, now()),
             metadata = metadata || $3::jsonb,
             updated_at = now()
         where id = $1
         returning *`,
        [id, patch.lastSeenAt ?? null, json(redactSensitive(patch.metadata ?? {}))]
      );
      if (!result.rows[0]) {
        throw new Error(`RUNTIME_STORE_AUTH_SESSION_NOT_FOUND: ${id}`);
      }
      return mapAuthSession(result.rows[0]);
    },
    async revokeAuthSession(id, patch = {}) {
      const result = await database.query<Row>(
        `update module_auth_sessions
         set status = 'revoked',
             revoked_at = coalesce($2::timestamptz, now()),
             revoked_reason = coalesce($3, revoked_reason),
             metadata = metadata || $4::jsonb,
             updated_at = now()
         where id = $1
         returning *`,
        [
          id,
          patch.revokedAt ?? null,
          patch.reason ?? null,
          json(redactSensitive(patch.metadata ?? {})),
        ]
      );
      if (!result.rows[0]) {
        throw new Error(`RUNTIME_STORE_AUTH_SESSION_NOT_FOUND: ${id}`);
      }
      return mapAuthSession(result.rows[0]);
    },
    async revokeAuthSessions(query) {
      const result = await database.query<Row>(
        `update module_auth_sessions
         set status = 'revoked',
             revoked_at = coalesce($8::timestamptz, now()),
             revoked_reason = coalesce($7, revoked_reason),
             updated_at = now()
         where status = 'active'
           and ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(environment_id, ''::text) = $2)
           and ($3::text is null or coalesce(workspace_id, ''::text) = $3)
           and ($4::text is null or subject_type = $4)
           and ($5::text is null or subject_id = $5)
           and ($6::text is null or id <> $6)
         returning *`,
        [
          query.productId ?? null,
          runtimeWorkspaceFilter(query.environmentId),
          runtimeWorkspaceFilter(query.workspaceId),
          query.subjectType ?? null,
          query.subjectId ?? null,
          query.excludeId ?? null,
          query.reason ?? null,
          query.revokedAt ?? null,
        ]
      );
      return result.rows.map(mapAuthSession);
    },
    async upsertUserIdentity(input) {
      const provider = normalizeProvider(input.provider);
      const providerKey = input.providerKey.trim();
      if (!provider || !providerKey) {
        throw new Error('RUNTIME_STORE_USER_IDENTITY_INVALID: provider and providerKey are required');
      }
      const result = await database.query<Row>(
        `insert into module_user_identities (
          id, product_id, environment_id, user_id, provider, provider_key,
          email, status, metadata, last_used_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::timestamptz)
        on conflict (
          product_id,
          (coalesce(environment_id, ''::text)),
          provider,
          provider_key
        )
        do update set
          email = coalesce(excluded.email, module_user_identities.email),
          status = excluded.status,
          metadata = module_user_identities.metadata || excluded.metadata,
          last_used_at = coalesce(excluded.last_used_at, module_user_identities.last_used_at),
          updated_at = now()
        where module_user_identities.user_id = excluded.user_id
        returning *`,
        [
          input.id ?? createId('user_identity'),
          input.productId,
          input.environmentId ?? null,
          input.userId,
          provider,
          providerKey,
          normalizeIdentityEmail(input.email),
          input.status ?? 'active',
          json(redactSensitive(input.metadata ?? {})),
          input.lastUsedAt ?? null,
        ]
      );
      if (!result.rows[0]) {
        throw new Error(`RUNTIME_STORE_USER_IDENTITY_ALREADY_LINKED: ${provider}:${providerKey}`);
      }
      return mapUserIdentity(result.rows[0]);
    },
    async findUserIdentity(query) {
      const result = await database.query<Row>(
        `select * from module_user_identities
         where product_id = $1
           and coalesce(environment_id, ''::text) = $2
           and provider = $3
           and provider_key = $4
           and ($5::text is null or status = $5)
         limit 1`,
        [
          query.productId,
          runtimeWorkspaceFilter(query.environmentId) ?? '',
          normalizeProvider(query.provider),
          query.providerKey.trim(),
          query.status ?? null,
        ]
      );
      return result.rows[0] ? mapUserIdentity(result.rows[0]) : null;
    },
    async listUserIdentities(query = {}) {
      const result = await database.query<Row>(
        `select * from module_user_identities
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(environment_id, ''::text) = $2)
           and ($3::text is null or user_id = $3)
           and ($4::text is null or provider = $4)
           and ($5::text is null or status = $5)
         order by created_at asc`,
        [
          query.productId ?? null,
          runtimeWorkspaceFilter(query.environmentId),
          query.userId ?? null,
          query.provider ? normalizeProvider(query.provider) : null,
          query.status ?? null,
        ]
      );
      return result.rows.map(mapUserIdentity);
    },
    async updateUserIdentityStatus(
      id: string,
      status: RuntimeStoreUserIdentityStatus,
      metadata
    ) {
      const result = await database.query<Row>(
        `update module_user_identities
         set status = $2,
             metadata = metadata || $3::jsonb,
             updated_at = now()
         where id = $1
         returning *`,
        [id, status, json(redactSensitive(metadata ?? {}))]
      );
      if (!result.rows[0]) {
        throw new Error(`RUNTIME_STORE_USER_IDENTITY_NOT_FOUND: ${id}`);
      }
      return mapUserIdentity(result.rows[0]);
    },
  };
}

import type { ModuleDataPostgresExecutor } from '../data';
import type { RuntimeStore } from './runtime-store-types';
import {
  mapResourceBinding,
  mapServiceConnection,
  mapSetting,
  type Row,
} from './postgres-runtime-store-mappers';
import { json } from './postgres-runtime-store-utils';

export type PostgresConfigStore = Pick<
  RuntimeStore,
  | 'upsertSetting'
  | 'getSetting'
  | 'listSettings'
  | 'upsertServiceConnection'
  | 'getServiceConnection'
  | 'listServiceConnections'
  | 'touchServiceConnection'
  | 'upsertResourceBinding'
  | 'listResourceBindings'
>;

export interface CreatePostgresConfigStoreOptions {
  database: ModuleDataPostgresExecutor;
}

export function createPostgresConfigStore(
  options: CreatePostgresConfigStoreOptions
): PostgresConfigStore {
  const { database } = options;

  return {
    async upsertSetting(input) {
      const status = input.status ?? 'active';
      const settingId = `${input.productId}:${input.workspaceId ?? ''}:${input.namespace}:${input.key}:${status}`;
      const result = await database.query<Row>(
        `insert into module_host_settings (
          id, product_id, workspace_id, namespace, key, value_json, status,
          version, updated_by, metadata
        )
        values ($1, $2, $3, $4, $5, $6::jsonb, $7, coalesce($8::integer, 1), $9, $10::jsonb)
        on conflict (id)
        do update set
          value_json = excluded.value_json,
          version = coalesce($8::integer, module_host_settings.version + 1),
          updated_by = excluded.updated_by,
          metadata = excluded.metadata,
          updated_at = now()
        returning *`,
        [
          settingId,
          input.productId,
          input.workspaceId ?? null,
          input.namespace,
          input.key,
          json(input.value),
          status,
          input.version ?? null,
          input.actorId ?? null,
          json(input.metadata ?? {}),
        ]
      );
      return mapSetting(result.rows[0]!) as never;
    },
    async getSetting(query) {
      const result = await database.query<Row>(
        `select * from module_host_settings
         where product_id = $1
           and namespace = $2
           and key = $3
           and ($4::text is null or coalesce(workspace_id, '') = coalesce($4, ''))
           and status = $5
         order by version desc
         limit 1`,
        [
          query.productId,
          query.namespace,
          query.key,
          query.workspaceId === undefined ? null : (query.workspaceId ?? ''),
          query.status ?? 'active',
        ]
      );
      return result.rows[0] ? (mapSetting(result.rows[0]) as never) : null;
    },
    async listSettings(query = {}) {
      const result = await database.query<Row>(
        `select * from module_host_settings
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, '') = coalesce($2, ''))
           and ($3::text is null or namespace = $3)
           and ($4::text is null or status = $4)
         order by updated_at desc`,
        [
          query.productId ?? null,
          query.workspaceId === undefined ? null : (query.workspaceId ?? ''),
          query.namespace ?? null,
          query.status ?? null,
        ]
      );
      return result.rows.map((row) => mapSetting(row)) as never;
    },
    async upsertServiceConnection(input) {
      const result = await database.query<Row>(
        `insert into module_service_connections (
          connection_id, product_id, workspace_id, module_id, service, provider,
          status, environment, owner_type, scope_type, auth_type, config,
          secret_refs, health, last_used_at, updated_by, metadata
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
          $12::jsonb, $13::jsonb, $14::jsonb, $15::timestamptz, $16, $17::jsonb
        )
        on conflict (product_id, connection_id)
        do update set
          workspace_id = excluded.workspace_id,
          module_id = excluded.module_id,
          service = excluded.service,
          provider = excluded.provider,
          status = excluded.status,
          environment = excluded.environment,
          owner_type = excluded.owner_type,
          scope_type = excluded.scope_type,
          auth_type = excluded.auth_type,
          config = excluded.config,
          secret_refs = excluded.secret_refs,
          health = excluded.health,
          last_used_at = excluded.last_used_at,
          updated_by = excluded.updated_by,
          metadata = excluded.metadata,
          updated_at = now()
        returning *`,
        [
          input.connectionId,
          input.productId,
          input.workspaceId ?? null,
          input.moduleId ?? null,
          input.service,
          input.provider,
          input.status ?? 'active',
          input.environment ?? null,
          input.ownerType ?? null,
          input.scopeType ?? null,
          input.authType ?? null,
          json(input.config ?? {}),
          json(input.secretRefs ?? {}),
          json(input.health ?? {}),
          input.lastUsedAt ?? null,
          input.actorId ?? null,
          json(input.metadata ?? {}),
        ]
      );
      return mapServiceConnection(result.rows[0]!);
    },
    async getServiceConnection(productId, connectionId) {
      const result = await database.query<Row>(
        `select * from module_service_connections
         where product_id = $1 and connection_id = $2
         limit 1`,
        [productId, connectionId]
      );
      return result.rows[0] ? mapServiceConnection(result.rows[0]) : null;
    },
    async listServiceConnections(query = {}) {
      const result = await database.query<Row>(
        `select * from module_service_connections
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, '') = coalesce($2, ''))
           and ($3::text is null or service = $3)
           and ($4::text is null or provider = $4)
           and ($5::text is null or status = $5)
         order by updated_at desc`,
        [
          query.productId ?? null,
          query.workspaceId === undefined ? null : (query.workspaceId ?? ''),
          query.service ?? null,
          query.provider ?? null,
          query.status ?? null,
        ]
      );
      return result.rows.map(mapServiceConnection);
    },
    async touchServiceConnection(productId, connectionId, patch = {}) {
      const result = await database.query<Row>(
        `update module_service_connections
         set health = coalesce($3::jsonb, health),
             metadata = metadata || $4::jsonb,
             last_used_at = now(),
             updated_at = now()
         where product_id = $1 and connection_id = $2
         returning *`,
        [
          productId,
          connectionId,
          patch.health ? json(patch.health) : null,
          json(patch.metadata ?? {}),
        ]
      );
      if (!result.rows[0]) {
        throw new Error(`RUNTIME_STORE_SERVICE_CONNECTION_NOT_FOUND: ${connectionId}`);
      }
      return mapServiceConnection(result.rows[0]);
    },
    async upsertResourceBinding(input) {
      const bindingId =
        input.bindingId ??
        `${input.productId}:${input.workspaceId ?? ''}:${input.moduleId ?? ''}:${input.name}`;
      const result = await database.query<Row>(
        `insert into module_resource_bindings (
          binding_id, product_id, workspace_id, module_id, name, kind,
          value_json, status, updated_by, metadata
        )
        values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10::jsonb)
        on conflict (binding_id)
        do update set
          product_id = excluded.product_id,
          workspace_id = excluded.workspace_id,
          module_id = excluded.module_id,
          name = excluded.name,
          kind = excluded.kind,
          value_json = excluded.value_json,
          status = excluded.status,
          updated_by = excluded.updated_by,
          metadata = excluded.metadata,
          updated_at = now()
        returning *`,
        [
          bindingId,
          input.productId,
          input.workspaceId ?? null,
          input.moduleId ?? null,
          input.name,
          input.kind ?? null,
          json(input.value),
          input.status ?? 'active',
          input.actorId ?? null,
          json(input.metadata ?? {}),
        ]
      );
      return mapResourceBinding(result.rows[0]!) as never;
    },
    async listResourceBindings(query = {}) {
      const result = await database.query<Row>(
        `select * from module_resource_bindings
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, '') = coalesce($2, ''))
           and ($3::text is null or coalesce(module_id, '') = coalesce($3, ''))
           and ($4::text is null or name = $4)
           and ($5::text is null or kind = $5)
           and ($6::text is null or status = $6)
         order by updated_at desc`,
        [
          query.productId ?? null,
          query.workspaceId === undefined ? null : (query.workspaceId ?? ''),
          query.moduleId === undefined ? null : (query.moduleId ?? ''),
          query.name ?? null,
          query.kind ?? null,
          query.status ?? null,
        ]
      );
      return result.rows.map((row) => mapResourceBinding(row)) as never;
    },
  };
}

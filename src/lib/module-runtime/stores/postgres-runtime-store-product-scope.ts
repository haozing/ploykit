import type { ModuleDataPostgresExecutor } from '../data';
import type { RuntimeStore } from './runtime-store-types';
import {
  mapMembership,
  mapProductScopeDomainAlias,
  mapProductScopeInvite,
  mapProductScopeProduct,
  mapProductScopeWorkspace,
  type Row,
} from './postgres-runtime-store-mappers';
import { json } from './postgres-runtime-store-utils';

export type PostgresProductScopeStore = Pick<
  RuntimeStore,
  | 'upsertMembership'
  | 'listMemberships'
  | 'upsertProductScopeProduct'
  | 'listProductScopeProducts'
  | 'upsertProductScopeWorkspace'
  | 'listProductScopeWorkspaces'
  | 'upsertProductScopeDomainAlias'
  | 'listProductScopeDomainAliases'
  | 'upsertProductScopeInvite'
  | 'listProductScopeInvites'
>;

export interface CreatePostgresProductScopeStoreOptions {
  database: ModuleDataPostgresExecutor;
}

export function createPostgresProductScopeStore(
  options: CreatePostgresProductScopeStoreOptions
): PostgresProductScopeStore {
  const { database } = options;

  return {
    async upsertMembership(input) {
      const id = input.id ?? `${input.productId}:${input.workspaceId}:${input.userId}`;
      const result = await database.query<Row>(
        `insert into module_product_scope_memberships (
          id, product_id, workspace_id, user_id, role, status
        )
        values ($1, $2, $3, $4, $5, $6)
        on conflict (product_id, workspace_id, user_id)
        do update set role = excluded.role, status = excluded.status, updated_at = now()
        returning *`,
        [id, input.productId, input.workspaceId, input.userId, input.role, input.status]
      );
      return mapMembership(result.rows[0]!);
    },
    async listMemberships(query = {}) {
      const result = await database.query<Row>(
        `select * from module_product_scope_memberships
         where ($1::text is null or product_id = $1)
           and ($2::text is null or workspace_id = $2)
           and ($3::text is null or user_id = $3)
         order by updated_at desc`,
        [query.productId ?? null, query.workspaceId ?? null, query.userId ?? null]
      );
      return result.rows.map(mapMembership);
    },
    async upsertProductScopeProduct(product) {
      const result = await database.query<Row>(
        `insert into module_product_scope_products (
          id, name, profile, default_workspace_id
        )
        values ($1, $2, $3, $4)
        on conflict (id)
        do update set
          name = excluded.name,
          profile = excluded.profile,
          default_workspace_id = excluded.default_workspace_id,
          updated_at = now()
        returning *`,
        [product.id, product.name, product.profile, product.defaultWorkspaceId ?? null]
      );
      return mapProductScopeProduct(result.rows[0]!);
    },
    async listProductScopeProducts(query = {}) {
      const result = await database.query<Row>(
        `select * from module_product_scope_products
         where ($1::text is null or id = $1)
         order by id asc`,
        [query.productId ?? null]
      );
      return result.rows.map(mapProductScopeProduct);
    },
    async upsertProductScopeWorkspace(workspace) {
      const result = await database.query<Row>(
        `insert into module_product_scope_workspaces (
          id, product_id, name, slug, domain_aliases
        )
        values ($1, $2, $3, $4, $5::jsonb)
        on conflict (id)
        do update set
          product_id = excluded.product_id,
          name = excluded.name,
          slug = excluded.slug,
          domain_aliases = excluded.domain_aliases,
          updated_at = now()
        returning *`,
        [
          workspace.id,
          workspace.productId,
          workspace.name,
          workspace.slug,
          json(workspace.domainAliases ?? null),
        ]
      );
      return mapProductScopeWorkspace(result.rows[0]!);
    },
    async listProductScopeWorkspaces(query = {}) {
      const result = await database.query<Row>(
        `select * from module_product_scope_workspaces
         where ($1::text is null or product_id = $1)
           and ($2::text is null or id = $2)
         order by product_id asc, id asc`,
        [query.productId ?? null, query.workspaceId ?? null]
      );
      return result.rows.map(mapProductScopeWorkspace);
    },
    async upsertProductScopeDomainAlias(alias) {
      const result = await database.query<Row>(
        `insert into module_product_scope_domain_aliases (
          hostname, product_id, workspace_id
        )
        values (lower($1), $2, $3)
        on conflict (hostname)
        do update set
          product_id = excluded.product_id,
          workspace_id = excluded.workspace_id,
          updated_at = now()
        returning *`,
        [alias.hostname, alias.productId, alias.workspaceId ?? null]
      );
      return mapProductScopeDomainAlias(result.rows[0]!);
    },
    async listProductScopeDomainAliases(query = {}) {
      const result = await database.query<Row>(
        `select * from module_product_scope_domain_aliases
         where ($1::text is null or product_id = $1)
           and ($2::text is null or hostname = lower($2))
         order by hostname asc`,
        [query.productId ?? null, query.hostname ?? null]
      );
      return result.rows.map(mapProductScopeDomainAlias);
    },
    async upsertProductScopeInvite(invite) {
      const result = await database.query<Row>(
        `insert into module_product_scope_invites (
          id, product_id, workspace_id, email, role, status, token, expires_at, invited_by, accepted_by
        )
        values ($1, $2, $3, lower($4), $5, $6, $7, $8::timestamptz, $9, $10)
        on conflict (token)
        do update set
          email = excluded.email,
          role = excluded.role,
          status = excluded.status,
          expires_at = excluded.expires_at,
          invited_by = excluded.invited_by,
          accepted_by = excluded.accepted_by,
          updated_at = now()
        returning *`,
        [
          invite.id,
          invite.productId,
          invite.workspaceId,
          invite.email,
          invite.role,
          invite.status,
          invite.token,
          invite.expiresAt,
          invite.invitedBy ?? null,
          invite.acceptedBy ?? null,
        ]
      );
      return mapProductScopeInvite(result.rows[0]!);
    },
    async listProductScopeInvites(query = {}) {
      const result = await database.query<Row>(
        `select * from module_product_scope_invites
         where ($1::text is null or product_id = $1)
           and ($2::text is null or workspace_id = $2)
           and ($3::text is null or status = $3)
           and ($4::text is null or token = $4)
         order by created_at desc`,
        [
          query.productId ?? null,
          query.workspaceId ?? null,
          query.status ?? null,
          query.token ?? null,
        ]
      );
      return result.rows.map(mapProductScopeInvite);
    },
  };
}

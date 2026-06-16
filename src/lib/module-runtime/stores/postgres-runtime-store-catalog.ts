import type { ModuleCatalogModuleState } from '../catalog';
import type { ModuleDataPostgresExecutor } from '../data';
import type { RuntimeStore } from './runtime-store-types';
import { mapCatalogState, type Row } from './postgres-runtime-store-mappers';
import { json } from './postgres-runtime-store-utils';

export type PostgresCatalogStore = Pick<RuntimeStore, 'upsertCatalogState' | 'listCatalogStates'>;

export interface CreatePostgresCatalogStoreOptions {
  database: ModuleDataPostgresExecutor;
}

export function createPostgresCatalogStore(
  options: CreatePostgresCatalogStoreOptions
): PostgresCatalogStore {
  const { database } = options;

  return {
    async upsertCatalogState(state: ModuleCatalogModuleState) {
      const result = await database.query<Row>(
        `insert into module_catalog_states (
          product_id, module_id, status, bundle_id, required, scope_profile, diagnostics
        )
        values ($1, $2, $3, $4, $5, $6, $7::jsonb)
        on conflict (product_id, module_id)
        do update set
          status = excluded.status,
          bundle_id = excluded.bundle_id,
          required = excluded.required,
          scope_profile = excluded.scope_profile,
          diagnostics = excluded.diagnostics,
          updated_at = now()
        returning *`,
        [
          state.productId,
          state.moduleId,
          state.status,
          state.bundleId ?? null,
          state.required ?? false,
          state.scopeProfile ?? null,
          json(state.diagnostics ?? []),
        ]
      );
      return mapCatalogState(result.rows[0]!);
    },
    async listCatalogStates(query = {}) {
      const result = await database.query<Row>(
        `select * from module_catalog_states
         where ($1::text is null or product_id = $1)
           and ($2::text is null or status = $2)
         order by module_id asc`,
        [query.productId ?? null, query.status ?? null]
      );
      return result.rows.map(mapCatalogState);
    },
  };
}

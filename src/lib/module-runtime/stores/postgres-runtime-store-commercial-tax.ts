import type { ModuleDataPostgresExecutor } from '../data';
import type { RuntimeStore } from './runtime-store-types';
import { mapTaxProfile, type Row } from './postgres-runtime-store-mappers';
import { json, orderWorkspaceKey } from './postgres-runtime-store-utils';

export type PostgresCommercialTaxStore = Pick<RuntimeStore, 'upsertTaxProfile' | 'getTaxProfile'>;

export interface CreatePostgresCommercialTaxStoreOptions {
  database: ModuleDataPostgresExecutor;
  createId: (prefix: string) => string;
}

export function createPostgresCommercialTaxStore(
  options: CreatePostgresCommercialTaxStoreOptions
): PostgresCommercialTaxStore {
  const { database, createId } = options;

  return {
    async upsertTaxProfile(input) {
      const result = await database.query<Row>(
        `insert into module_tax_profiles (
          id, product_id, workspace_id, user_id, status, jurisdiction,
          validation_status, profile, evidence, metadata
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb)
        on conflict (product_id, (coalesce(workspace_id, ''::text)), user_id)
        do update set
          status = excluded.status,
          jurisdiction = excluded.jurisdiction,
          validation_status = excluded.validation_status,
          profile = module_tax_profiles.profile || excluded.profile,
          evidence = module_tax_profiles.evidence || excluded.evidence,
          metadata = module_tax_profiles.metadata || excluded.metadata,
          updated_at = now()
        returning *`,
        [
          createId('tax_profile'),
          input.productId,
          input.workspaceId ?? null,
          input.userId,
          input.status ?? 'draft',
          input.jurisdiction ?? null,
          input.validationStatus ?? 'unverified',
          json(input.profile ?? {}),
          json(input.evidence ?? {}),
          json(input.metadata ?? {}),
        ]
      );
      return mapTaxProfile(result.rows[0]!);
    },
    async getTaxProfile(productId, userId, workspaceId) {
      const result = await database.query<Row>(
        `select * from module_tax_profiles
         where product_id = $1
           and user_id = $2
           and coalesce(workspace_id, ''::text) = $3
         limit 1`,
        [productId, userId, orderWorkspaceKey(workspaceId)]
      );
      return result.rows[0] ? mapTaxProfile(result.rows[0]) : null;
    },
  };
}

import type { ModuleDataPostgresExecutor } from '../data';
import { redactSensitive } from '../observability/redaction';
import type { RuntimeStore } from './runtime-store-types';
import { mapProviderInvocation, type Row } from './postgres-runtime-store-mappers';
import {
  deliveryErrorFrom,
  json,
  runtimeWorkspaceFilter,
} from './postgres-runtime-store-utils';

export type PostgresProviderInvocationStore = Pick<
  RuntimeStore,
  'recordProviderInvocation' | 'listProviderInvocations'
>;

export interface CreatePostgresProviderInvocationStoreOptions {
  database: ModuleDataPostgresExecutor;
  createId: (prefix: string) => string;
}

export function createPostgresProviderInvocationStore(
  options: CreatePostgresProviderInvocationStoreOptions
): PostgresProviderInvocationStore {
  const { database, createId } = options;

  return {
    async recordProviderInvocation(input) {
      const result = await database.query<Row>(
        `insert into module_provider_invocations (
          id, product_id, workspace_id, module_id, provider_id, kind, operation,
          status, target, model, service_connection_id, resource_binding_id,
          usage, cost, latency_ms, correlation_id, error, metadata
        )
        values (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12,
          $13::jsonb, $14::jsonb, $15, $16, $17::jsonb, $18::jsonb
        )
        returning *`,
        [
          createId('provider_invocation'),
          input.productId,
          input.workspaceId ?? null,
          input.moduleId ?? null,
          input.providerId,
          input.kind,
          input.operation,
          input.status,
          input.target ?? null,
          input.model ?? null,
          input.serviceConnectionId ?? null,
          input.resourceBindingId ?? null,
          json(input.usage ?? {}),
          json(input.cost ?? {}),
          input.latencyMs ?? 0,
          input.correlationId ?? null,
          json(deliveryErrorFrom(input.error)),
          json(redactSensitive(input.metadata ?? {})),
        ]
      );
      return mapProviderInvocation(result.rows[0]!);
    },
    async listProviderInvocations(query = {}) {
      const result = await database.query<Row>(
        `select * from module_provider_invocations
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, ''::text) = $2)
           and ($3::text is null or module_id = $3)
           and ($4::text is null or provider_id = $4)
           and ($5::text is null or kind = $5)
           and ($6::text is null or operation = $6)
           and ($7::text is null or status = $7)
         order by created_at desc`,
        [
          query.productId ?? null,
          runtimeWorkspaceFilter(query.workspaceId),
          query.moduleId ?? null,
          query.providerId ?? null,
          query.kind ?? null,
          query.operation ?? null,
          query.status ?? null,
        ]
      );
      return result.rows.map(mapProviderInvocation);
    },
  };
}

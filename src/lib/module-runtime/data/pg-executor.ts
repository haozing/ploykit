import { Pool, type PoolClient, type PoolConfig } from 'pg';
import type { CreateModuleRuntimeDataApiInput, ModuleRuntimeDataApiFactory } from '../host';
import {
  createPostgresModuleDataApi,
  type ModuleDataPostgresExecutor,
  type ModuleDataPostgresQueryResult,
  type ModuleDataRuntimeSession,
} from './postgres';

export interface CreatePgModuleDataPoolOptions extends PoolConfig {
  connectionString?: string;
}

export interface CreatePostgresModuleDataHostFactoryOptions {
  database: ModuleDataPostgresExecutor;
  session:
    | ModuleDataRuntimeSession
    | ((input: CreateModuleRuntimeDataApiInput) => ModuleDataRuntimeSession);
  schema?: string;
  useRlsSession?: boolean;
  wrapOperationsInTransaction?: boolean;
  unsafeAllowRlsBypass?: boolean;
}

function normalizeRowCount(rowCount: number | null): number {
  return rowCount ?? 0;
}

function createClientExecutor(client: PoolClient): ModuleDataPostgresExecutor {
  return {
    async query<TRecord = Record<string, unknown>>(
      text: string,
      values: readonly unknown[] = []
    ): Promise<ModuleDataPostgresQueryResult<TRecord>> {
      const result = await client.query(text, [...values]);
      return {
        rows: result.rows as TRecord[],
        rowCount: normalizeRowCount(result.rowCount),
      };
    },
    async transaction<TResult>(
      callback: (tx: ModuleDataPostgresExecutor) => Promise<TResult>
    ): Promise<TResult> {
      const savepoint = `ploykit_nested_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      await client.query(`savepoint ${savepoint}`);
      try {
        const result = await callback(createClientExecutor(client));
        await client.query(`release savepoint ${savepoint}`);
        return result;
      } catch (error) {
        await client.query(`rollback to savepoint ${savepoint}`);
        throw error;
      }
    },
  };
}

export function createPgModuleDataPool(options: CreatePgModuleDataPoolOptions = {}): Pool {
  return new Pool(options);
}

export function createPgModuleDataExecutor(pool: Pool): ModuleDataPostgresExecutor {
  return {
    async query<TRecord = Record<string, unknown>>(
      text: string,
      values: readonly unknown[] = []
    ): Promise<ModuleDataPostgresQueryResult<TRecord>> {
      const result = await pool.query(text, [...values]);
      return {
        rows: result.rows as TRecord[],
        rowCount: normalizeRowCount(result.rowCount),
      };
    },
    async transaction<TResult>(
      callback: (tx: ModuleDataPostgresExecutor) => Promise<TResult>
    ): Promise<TResult> {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await callback(createClientExecutor(client));
        await client.query('commit');
        return result;
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

export function createPostgresModuleDataHostFactory(
  options: CreatePostgresModuleDataHostFactoryOptions
): ModuleRuntimeDataApiFactory {
  return (input) =>
    createPostgresModuleDataApi({
      contract: input.contract,
      database: options.database,
      session: typeof options.session === 'function' ? options.session(input) : options.session,
      schema: options.schema,
      useRlsSession: options.useRlsSession,
      wrapOperationsInTransaction: options.wrapOperationsInTransaction,
      unsafeAllowRlsBypass: options.unsafeAllowRlsBypass,
    });
}

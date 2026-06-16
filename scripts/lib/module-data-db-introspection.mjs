import { quoteIdentifier } from './module-data-sql.mjs';

export function databaseUrlFromOptions(options) {
  return (
    options.values.get('databaseUrl') ?? process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? ''
  );
}

export function appDatabaseUrlFromOptions(options) {
  return options.values.get('appDatabaseUrl') ?? process.env.PLOYKIT_APP_DATABASE_URL ?? '';
}

export async function createPgPool(databaseUrl) {
  const { Pool } = await import('pg');
  return new Pool({ connectionString: databaseUrl });
}

export async function tableExists(pool, schema, tableName) {
  const result = await pool.query(`select to_regclass($1) is not null as exists`, [
    `${schema}.${quoteIdentifier(tableName)}`,
  ]);
  return Boolean(result.rows[0]?.exists);
}

export async function readTableColumns(pool, schema, tableName) {
  const result = await pool.query(
    `select column_name, data_type, is_nullable
     from information_schema.columns
     where table_schema = $1 and table_name = $2`,
    [schema, tableName]
  );

  return new Map(
    result.rows.map((row) => [
      row.column_name,
      {
        type: row.data_type,
        nullable: row.is_nullable === 'YES',
      },
    ])
  );
}

export async function readRlsState(pool, schema, tableName) {
  const result = await pool.query(
    `select c.relrowsecurity, c.relforcerowsecurity
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = $1 and c.relname = $2`,
    [schema, tableName]
  );
  return result.rows[0] ?? null;
}

export async function readRlsPolicies(pool, schema, tableName) {
  const result = await pool.query(
    `select policyname, cmd, qual, with_check
     from pg_policies
     where schemaname = $1 and tablename = $2`,
    [schema, tableName]
  );
  return result.rows;
}

export async function readCurrentRoleSafety(pool, schema, tableNames) {
  const roleResult = await pool.query(
    `select r.rolname, r.rolsuper, r.rolbypassrls, r.rolcreatedb, r.rolcreaterole
     from pg_roles r
     where r.rolname = current_user`
  );
  const schemaPrivilegeResult = await pool.query(
    `select has_schema_privilege(current_user, $1, 'CREATE') as can_create`,
    [schema]
  );
  const ownerResult =
    tableNames.length > 0
      ? await pool.query(
          `select c.relname, pg_get_userbyid(c.relowner) as owner
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = $1
           and c.relkind in ('r', 'p')
           and c.relname = any($2::text[])
           and pg_get_userbyid(c.relowner) = current_user
         order by c.relname`,
          [schema, tableNames]
        )
      : { rows: [] };

  return {
    role: roleResult.rows[0] ?? null,
    canCreateInSchema: Boolean(schemaPrivilegeResult.rows[0]?.can_create),
    ownedTables: ownerResult.rows.map((row) => row.relname),
  };
}

export async function metadataHash(pool, moduleId, kind, name) {
  const result = await pool.query(
    `select schema_hash
     from public.module_data_models
     where module_id = $1 and model_kind = $2 and model_name = $3`,
    [moduleId, kind, name]
  );
  return result.rows[0]?.schema_hash ?? null;
}

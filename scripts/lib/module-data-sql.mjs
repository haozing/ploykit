export function quoteIdentifier(value) {
  return `"${value.replace(/"/g, '""')}"`;
}

export function quoteString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function formatDefault(column) {
  if (column.defaultRandom && column.kind === 'uuid') {
    return ' default gen_random_uuid()';
  }
  if (!Object.prototype.hasOwnProperty.call(column, 'default')) {
    return '';
  }
  if (column.kind === 'jsonb') {
    const raw =
      typeof column.default === 'string' && /^[{\[]/.test(column.default)
        ? column.default
        : JSON.stringify(column.default);
    return ` default ${quoteString(raw)}::jsonb`;
  }
  if (typeof column.default === 'number' || typeof column.default === 'boolean') {
    return ` default ${column.default}`;
  }
  if (column.default === null) {
    return ' default null';
  }
  return ` default ${quoteString(column.default)}`;
}

function sqlType(column) {
  switch (column.kind) {
    case 'uuid':
      return 'uuid';
    case 'integer':
      return 'integer';
    case 'number':
      return 'double precision';
    case 'boolean':
      return 'boolean';
    case 'jsonb':
      return 'jsonb';
    case 'timestamp':
      return 'timestamptz';
    default:
      return 'text';
  }
}

export function dbColumnType(column) {
  switch (column.kind) {
    case 'uuid':
      return 'uuid';
    case 'integer':
      return 'integer';
    case 'number':
      return 'double precision';
    case 'boolean':
      return 'boolean';
    case 'jsonb':
      return 'jsonb';
    case 'timestamp':
      return 'timestamp with time zone';
    default:
      return 'text';
  }
}

function generateDocumentStoreSql() {
  return `create table if not exists public.module_documents (
  id uuid primary key default gen_random_uuid(),
  product_id text not null,
  module_id text not null,
  scope_type text not null,
  scope_id text,
  document_name text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by text,
  updated_by text
);

create index if not exists module_documents__module_document_scope_idx
  on public.module_documents (product_id, module_id, document_name, scope_type, scope_id);

alter table public.module_documents enable row level security;
alter table public.module_documents force row level security;

drop policy if exists module_documents__module_scope_policy on public.module_documents;
create policy module_documents__module_scope_policy
  on public.module_documents
  for all
  using (
    product_id = current_setting('ploykit.product_id', true)
    and module_id = current_setting('ploykit.module_id', true)
    and (
      scope_type = 'public-read'
      or (
        scope_type = current_setting('ploykit.scope_type', true)
        and scope_id = current_setting('ploykit.scope_id', true)
      )
    )
  )
  with check (
    product_id = current_setting('ploykit.product_id', true)
    and module_id = current_setting('ploykit.module_id', true)
    and (
      (
        scope_type = 'public-read'
        and scope_id is null
        and current_setting('ploykit.allow_public_write', true) = 'true'
      )
      or (
        scope_type = current_setting('ploykit.scope_type', true)
        and scope_id = current_setting('ploykit.scope_id', true)
      )
    )
  );
`;
}

function generateMetadataSql(modulePlan, stableHash) {
  const modelRows = [
    ...modulePlan.documents.map((document) => ({
      kind: 'document',
      name: document.name,
      definition: document,
    })),
    ...modulePlan.tables.map((table) => ({
      kind: 'table',
      name: table.name,
      definition: table,
    })),
    ...(modulePlan.views ?? []).map((view) => ({
      kind: 'view',
      name: view.name,
      definition: view,
    })),
  ];

  const modelValues = modelRows
    .map((row) => {
      const definition = JSON.stringify(row.definition);
      const hash = stableHash(row.definition);
      return `(${quoteString(modulePlan.moduleId)}, ${quoteString(row.kind)}, ${quoteString(row.name)}, ${quoteString(hash)}, ${quoteString(definition)}::jsonb)`;
    })
    .join(',\n  ');

  const grants = modulePlan.grants ?? [];
  const checks = modulePlan.checks ?? [];
  const grantValues = grants
    .map((grant) => {
      const definition = JSON.stringify(grant.definition);
      return `(${quoteString(modulePlan.moduleId)}, ${quoteString(grant.name)}, ${quoteString(stableHash(grant.definition))}, ${quoteString(definition)}::jsonb)`;
    })
    .join(',\n  ');
  const checkValues = checks
    .map((check) => {
      const definition = JSON.stringify(check.definition);
      return `(${quoteString(modulePlan.moduleId)}, ${quoteString(check.name)}, ${quoteString(stableHash(check.definition))}, ${quoteString(definition)}::jsonb)`;
    })
    .join(',\n  ');

  const blocks = [
    `create table if not exists public.module_data_models (
  module_id text not null,
  model_kind text not null,
  model_name text not null,
  schema_hash text not null,
  definition jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (module_id, model_kind, model_name)
);

create table if not exists public.module_data_migrations (
  module_id text primary key,
  data_version integer not null,
  migration_mode text not null,
  migration_dir text not null,
  schema_hash text not null,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.module_data_grants (
  module_id text not null,
  grant_name text not null,
  schema_hash text not null,
  definition jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (module_id, grant_name)
);

create table if not exists public.module_data_checks (
  module_id text not null,
  check_name text not null,
  schema_hash text not null,
  definition jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (module_id, check_name)
);

insert into public.module_data_migrations
  (module_id, data_version, migration_mode, migration_dir, schema_hash)
values
  (${quoteString(modulePlan.moduleId)}, ${Number(modulePlan.dataVersion ?? 1)}, ${quoteString(modulePlan.migrations.mode)}, ${quoteString(modulePlan.migrations.dir)}, ${quoteString(modulePlan.schemaHash)})
on conflict (module_id)
do update set
  data_version = excluded.data_version,
  migration_mode = excluded.migration_mode,
  migration_dir = excluded.migration_dir,
  schema_hash = excluded.schema_hash,
  updated_at = now();
`,
  ];

  if (modelValues) {
    blocks.push(`
insert into public.module_data_models
  (module_id, model_kind, model_name, schema_hash, definition)
values
  ${modelValues}
on conflict (module_id, model_kind, model_name)
do update set
  schema_hash = excluded.schema_hash,
  definition = excluded.definition,
  updated_at = now();
`);
  }

  blocks.push(`delete from public.module_data_grants where module_id = ${quoteString(modulePlan.moduleId)};`);
  if (grantValues) {
    blocks.push(`
insert into public.module_data_grants
  (module_id, grant_name, schema_hash, definition)
values
  ${grantValues};
`);
  }

  blocks.push(`delete from public.module_data_checks where module_id = ${quoteString(modulePlan.moduleId)};`);
  if (checkValues) {
    blocks.push(`
insert into public.module_data_checks
  (module_id, check_name, schema_hash, definition)
values
  ${checkValues};
`);
  }

  return blocks.join('\n').trim();
}

function generateTableSql(modulePlan, table, standardColumns) {
  const tableName = quoteIdentifier(table.physicalName);
  const columnLines = standardColumns.map(
    (column) => `  ${quoteIdentifier(column.name)} ${column.sql}`
  );

  for (const [name, column] of Object.entries(table.columns)) {
    const notNull = column.nullable === false ? ' not null' : '';
    const primaryKey = column.primaryKey ? ' primary key' : '';
    columnLines.push(
      `  ${quoteIdentifier(name)} ${sqlType(column)}${notNull}${primaryKey}${formatDefault(column)}`
    );
  }

  const sql = [
    `create table if not exists public.${tableName} (`,
    `${columnLines.join(',\n')}`,
    ');',
    '',
    `alter table public.${tableName} enable row level security;`,
    `alter table public.${tableName} force row level security;`,
    '',
  ];

  for (const [index, fields] of table.unique.entries()) {
    const suffix = fields.join('_') || String(index + 1);
    sql.push(
      `create unique index if not exists ${quoteIdentifier(`${table.physicalName}__uniq_${suffix}`)}`,
      `  on public.${tableName} (${fields.map(quoteIdentifier).join(', ')});`,
      ''
    );
  }

  for (const [index, fields] of table.indexes.entries()) {
    const suffix = fields.join('_') || String(index + 1);
    sql.push(
      `create index if not exists ${quoteIdentifier(`${table.physicalName}__idx_${suffix}`)}`,
      `  on public.${tableName} (${fields.map(quoteIdentifier).join(', ')});`,
      ''
    );
  }

  sql.push(
    `drop policy if exists ${quoteIdentifier(`${table.physicalName}__module_scope_policy`)} on public.${tableName};`,
    `create policy ${quoteIdentifier(`${table.physicalName}__module_scope_policy`)}`,
    `  on public.${tableName}`,
    '  for all',
    '  using (',
    `    product_id = current_setting('ploykit.product_id', true)`,
    `    and module_id = ${quoteString(modulePlan.moduleId)}`,
    '    and (',
    "      scope_type = 'public-read'",
    '      or (',
    "        scope_type = current_setting('ploykit.scope_type', true)",
    "        and scope_id = current_setting('ploykit.scope_id', true)",
    '      )',
    '    )',
    '  )',
    '  with check (',
    `    product_id = current_setting('ploykit.product_id', true)`,
    `    and module_id = ${quoteString(modulePlan.moduleId)}`,
    '    and (',
    '      (',
    "        scope_type = 'public-read'",
    '        and scope_id is null',
    "        and current_setting('ploykit.allow_public_write', true) = 'true'",
    '      )',
    '      or (',
    "        scope_type = current_setting('ploykit.scope_type', true)",
    "        and scope_id = current_setting('ploykit.scope_id', true)",
    '      )',
    '    )',
    '  );',
    ''
  );

  return sql.join('\n');
}

export function generateMigrationSql(modulePlan, options) {
  const { stableHash, standardColumns } = options;
  const blocks = [
    '-- Generated by scripts/module-data.mjs.',
    '-- Do not edit by hand; change module.ts and run npm run data:generate.',
    `-- Module: ${modulePlan.moduleId}`,
    `-- Schema hash: ${modulePlan.schemaHash}`,
    '',
    'create extension if not exists pgcrypto;',
    '',
  ];

  if (modulePlan.documents.length > 0) {
    blocks.push(generateDocumentStoreSql(), '');
  }

  blocks.push(generateMetadataSql(modulePlan, stableHash), '');

  for (const table of modulePlan.tables) {
    blocks.push(generateTableSql(modulePlan, table, standardColumns));
  }

  return `${blocks
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`;
}

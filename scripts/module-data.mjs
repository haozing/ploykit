import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { register } from 'tsx/esm/api';

const PROJECT_ROOT = process.cwd();
const MODULE_DIRS_ENV = 'PLOYKIT_MODULE_DIRS';
const MODULE_DIR_ALLOWLIST_ENV = 'PLOYKIT_MODULE_DIR_ALLOWLIST';
const tsx = register({ namespace: 'ploykit-module-data' });
const STANDARD_COLUMNS = [
  { name: 'id', sql: 'uuid primary key default gen_random_uuid()', ts: 'string' },
  { name: 'product_id', sql: 'text not null', ts: 'string' },
  { name: 'module_id', sql: 'text not null', ts: 'string' },
  { name: 'scope_type', sql: 'text not null', ts: 'string' },
  { name: 'scope_id', sql: 'text', ts: 'string | null' },
  { name: 'created_at', sql: 'timestamptz not null default now()', ts: 'string' },
  { name: 'updated_at', sql: 'timestamptz not null default now()', ts: 'string' },
  { name: 'deleted_at', sql: 'timestamptz', ts: 'string | null' },
  { name: 'created_by', sql: 'text', ts: 'string | null' },
  { name: 'updated_by', sql: 'text', ts: 'string | null' },
];
const STANDARD_COLUMN_NAMES = new Set(STANDARD_COLUMNS.map((column) => column.name));
const STANDARD_DB_COLUMNS = {
  id: { type: 'uuid', nullable: false },
  product_id: { type: 'text', nullable: false },
  module_id: { type: 'text', nullable: false },
  scope_type: { type: 'text', nullable: false },
  scope_id: { type: 'text', nullable: true },
  created_at: { type: 'timestamp with time zone', nullable: false },
  updated_at: { type: 'timestamp with time zone', nullable: false },
  deleted_at: { type: 'timestamp with time zone', nullable: true },
  created_by: { type: 'text', nullable: true },
  updated_by: { type: 'text', nullable: true },
};

function moduleDataPhysicalTableName(moduleId, tableName) {
  return `mod_${moduleId.replace(/-/g, '_')}__${tableName}`;
}

function slash(value) {
  return value.replace(/\\/g, '/');
}

function toProjectPath(file) {
  return slash(path.relative(PROJECT_ROOT, file));
}

function diagnostic(severity, code, message, pathValue, fix, details) {
  return {
    severity,
    code,
    message,
    ...(pathValue ? { path: pathValue } : {}),
    ...(fix ? { fix } : {}),
    ...(details ? { details } : {}),
  };
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function splitExternalDirs(value) {
  return value
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function canonicalPath(value) {
  const resolved = path.resolve(PROJECT_ROOT, value);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function isPathInsideDirectory(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function externalDirAllowlist() {
  return [
    canonicalPath(PROJECT_ROOT),
    ...splitExternalDirs(process.env[MODULE_DIR_ALLOWLIST_ENV] ?? '').map(canonicalPath),
  ];
}

function assertExternalDirAllowed(configuredValue, dir) {
  const candidate = canonicalPath(dir);
  if (externalDirAllowlist().some((allowed) => isPathInsideDirectory(allowed, candidate))) {
    return;
  }

  throw new Error(
    `External module directory "${configuredValue}" resolves outside the allowed module roots. ` +
      `Move it under the project root or add its parent directory to ${MODULE_DIR_ALLOWLIST_ENV}.`
  );
}

function getSourceTargets() {
  const targets = [
    {
      kind: 'default',
      configuredValue: 'modules',
      dir: path.join(PROJECT_ROOT, 'modules'),
    },
  ];

  for (const configuredValue of splitExternalDirs(process.env[MODULE_DIRS_ENV] ?? '')) {
    const dir = path.resolve(PROJECT_ROOT, configuredValue);
    assertExternalDirAllowed(configuredValue, dir);
    targets.push({
      kind: 'external',
      configuredValue,
      dir,
    });
  }

  return targets;
}

function findModuleRoots(target) {
  if (!fs.existsSync(target.dir)) {
    if (target.kind === 'external') {
      throw new Error(`Configured module directory not found: ${target.configuredValue}`);
    }
    return [];
  }

  if (fs.existsSync(path.join(target.dir, 'module.ts'))) {
    return [target.dir];
  }

  return fs
    .readdirSync(target.dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(target.dir, entry.name))
    .filter((dir) => fs.existsSync(path.join(dir, 'module.ts')));
}

function discoverModuleRoots(targetPath = 'modules') {
  const resolved = path.resolve(PROJECT_ROOT, targetPath);
  let roots;

  if (fs.existsSync(path.join(resolved, 'module.ts'))) {
    roots = [resolved];
  } else if (targetPath === 'modules') {
    roots = getSourceTargets().flatMap(findModuleRoots);
  } else {
    const target = { kind: 'explicit', configuredValue: targetPath, dir: resolved };
    roots = findModuleRoots(target);
  }
  return roots;
}

function parseCommandArgs(args) {
  let targetPath = 'modules';
  const moduleFilter = new Set();
  const flags = new Set();
  const values = new Map();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--module') {
      const moduleId = args[index + 1];
      if (!moduleId) {
        throw new Error('Expected module id after --module.');
      }
      moduleFilter.add(moduleId);
      index += 1;
      continue;
    }

    if (arg === '--database-url') {
      const databaseUrl = args[index + 1];
      if (!databaseUrl) {
        throw new Error('Expected database URL after --database-url.');
      }
      values.set('databaseUrl', databaseUrl);
      index += 1;
      continue;
    }

    if (arg === '--app-database-url') {
      const databaseUrl = args[index + 1];
      if (!databaseUrl) {
        throw new Error('Expected database URL after --app-database-url.');
      }
      values.set('appDatabaseUrl', databaseUrl);
      index += 1;
      continue;
    }

    if (arg === '--schema') {
      const schema = args[index + 1];
      if (!schema) {
        throw new Error('Expected schema after --schema.');
      }
      values.set('schema', schema);
      index += 1;
      continue;
    }

    if (arg.startsWith('--')) {
      flags.add(arg.slice(2));
      continue;
    }

    if (!arg.startsWith('--')) {
      targetPath = arg;
    }
  }

  return { targetPath, moduleFilter, flags, values };
}

const DATA_SCOPES = new Set(['user', 'workspace', 'product', 'public-read', 'system']);
const DATA_MIGRATION_MODES = new Set(['generated', 'sql']);
const RELATION_ON_DELETE = new Set(['cascade', 'restrict', 'set-null']);
const LOCAL_DATA_PATH_PATTERN = /^\.\/(?!\.)(?!.*(?:^|\/)\.\.(?:\/|$))/;

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function readDefaultExport(value) {
  return value && typeof value === 'object' && 'default' in value ? value.default : value;
}

async function readModuleDefinition(moduleRoot) {
  const loaded = await tsx.import(
    pathToFileURL(path.join(moduleRoot, 'module.ts')).href,
    import.meta.url
  );
  const definition = readDefaultExport(loaded);
  if (!definition || typeof definition !== 'object') {
    throw new Error(`Module ${toProjectPath(moduleRoot)} did not export a module definition.`);
  }
  return definition;
}

function cloneJson(value) {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value));
}

function hasOwn(object, property) {
  return Object.prototype.hasOwnProperty.call(object ?? {}, property);
}

function normalizeDocumentField(field) {
  if (typeof field === 'string') {
    return {
      type: field,
      required: !field.endsWith('?'),
    };
  }

  const normalized = {
    type: typeof field?.type === 'string' ? field.type : 'json',
    required: field?.required === undefined ? false : Boolean(field.required),
  };

  if (typeof field?.maxLength === 'number') {
    normalized.maxLength = field.maxLength;
  }
  if (Array.isArray(field?.enum)) {
    normalized.enum = [...field.enum];
  }
  if (hasOwn(field, 'default')) {
    normalized.default = cloneJson(field.default);
  }

  return normalized;
}

function normalizeDocuments(data) {
  return Object.entries(data.documents ?? {}).map(([name, document]) => {
    const normalized = {
      name,
      scope: typeof document.scope === 'string' ? document.scope : 'user',
      fields: Object.fromEntries(
        Object.entries(document.fields ?? {}).map(([fieldName, field]) => [
          fieldName,
          normalizeDocumentField(field),
        ])
      ),
    };

    if (Array.isArray(document.indexes)) {
      normalized.indexes = document.indexes.map((index) => ({
        fields: [...(index.fields ?? [])],
        ...(index.unique === true ? { unique: true } : {}),
        ...(index.order ? { order: index.order } : {}),
      }));
    }

    return normalized;
  });
}

function normalizeColumn(column) {
  const normalized = {
    kind: typeof column?.kind === 'string' ? column.kind : 'text',
    nullable: column?.primaryKey ? false : column?.nullable === true,
    primaryKey: column?.primaryKey === true,
    defaultRandom: column?.defaultRandom === true,
  };

  if (hasOwn(column, 'default')) {
    normalized.default = cloneJson(column.default);
  }

  return normalized;
}

function normalizeStringGroups(groups) {
  if (!Array.isArray(groups)) {
    return [];
  }
  return groups
    .filter((group) => Array.isArray(group))
    .map((group) => group.map((field) => String(field)));
}

function normalizeRelations(relations) {
  const normalized = {};
  for (const [name, relation] of Object.entries(relations ?? {})) {
    normalized[name] = {
      table: String(relation.table ?? ''),
      local: String(relation.local ?? ''),
      foreign: String(relation.foreign ?? ''),
      ...(relation.onDelete ? { onDelete: String(relation.onDelete) } : {}),
    };
  }
  return normalized;
}

function normalizeTables(data, moduleId) {
  return Object.entries(data.tables ?? {}).map(([name, table]) => {
    const normalized = {
      name,
      physicalName: moduleDataPhysicalTableName(moduleId, name),
      scope: typeof table.scope === 'string' ? table.scope : 'workspace',
      columns: Object.fromEntries(
        Object.entries(table.columns ?? {}).map(([columnName, column]) => [
          columnName,
          normalizeColumn(column),
        ])
      ),
      unique: normalizeStringGroups(table.unique),
      indexes: normalizeStringGroups(table.indexes),
    };
    const relations = normalizeRelations(table.relations);
    if (Object.keys(relations).length > 0) {
      normalized.relations = relations;
    }
    return normalized;
  });
}

function normalizeNamedDefinitions(definitions) {
  return Object.entries(definitions ?? {}).map(([name, definition]) => ({
    name,
    definition: cloneJson(definition ?? {}),
  }));
}

function normalizeMigrations(data) {
  const migrations = data.migrations;
  if (!migrations) {
    return {
      mode: 'generated',
      dir: './migrations',
    };
  }

  return {
    mode: typeof migrations.mode === 'string' ? migrations.mode : 'generated',
    dir: typeof migrations.dir === 'string' ? migrations.dir : './migrations',
    ...(Array.isArray(migrations.owns) ? { owns: [...migrations.owns] } : {}),
  };
}

function dataModelNames(documents, tables, views) {
  return new Set([
    ...documents.map((document) => document.name),
    ...tables.map((table) => table.name),
    ...views.map((view) => view.name),
  ]);
}

function validateNormalizedData(data, plan, diagnostics) {
  if (!Number.isInteger(plan.dataVersion) || plan.dataVersion < 1) {
    diagnostics.push(
      diagnostic(
        'error',
        'MODULE_DATA_VERSION_INVALID',
        'Data definition version must be a positive integer.',
        'data.version'
      )
    );
  }

  for (const document of plan.documents) {
    if (!DATA_SCOPES.has(document.scope)) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_DATA_SCOPE_INVALID',
          `Document scope "${document.scope}" is not supported.`,
          `data.documents.${document.name}.scope`
        )
      );
    }
  }

  for (const table of plan.tables) {
    const sourceTable = data.tables?.[table.name];
    if (sourceTable?.$$type !== 'ploykit.data.table') {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_DATA_TABLE_DSL_REQUIRED',
          `Table "${table.name}" must be created with table(...).`,
          `data.tables.${table.name}`,
          'Use table({ scope, columns, indexes, unique }).'
        )
      );
    }

    if (!DATA_SCOPES.has(table.scope)) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_DATA_SCOPE_INVALID',
          `Table scope "${table.scope}" is not supported.`,
          `data.tables.${table.name}.scope`
        )
      );
    }

    const columnNames = new Set(Object.keys(table.columns));
    const addressableColumnNames = new Set([...STANDARD_COLUMN_NAMES, ...columnNames]);
    for (const columnName of columnNames) {
      if (STANDARD_COLUMN_NAMES.has(columnName)) {
        diagnostics.push(
          diagnostic(
            'error',
            'MODULE_DATA_COLUMN_RESERVED',
            `Column "${columnName}" is reserved for the module data runtime.`,
            `data.tables.${table.name}.columns.${columnName}`,
            'Rename the module-owned column.'
          )
        );
      }
    }

    for (const [kind, groups] of [
      ['unique', table.unique],
      ['indexes', table.indexes],
    ]) {
      for (const [groupIndex, fields] of groups.entries()) {
        for (const [fieldIndex, field] of fields.entries()) {
          if (!columnNames.has(field)) {
            diagnostics.push(
              diagnostic(
                'error',
                'MODULE_DATA_TABLE_INDEX_FIELD_UNKNOWN',
                `Table "${table.name}" ${kind} field "${field}" is not declared as a column.`,
                `data.tables.${table.name}.${kind}.${groupIndex}.${fieldIndex}`
              )
            );
          }
        }
      }
    }

    for (const [relationName, relation] of Object.entries(table.relations ?? {})) {
      const target = plan.tables.find((candidate) => candidate.name === relation.table);
      if (!target) {
        diagnostics.push(
          diagnostic(
            'error',
            'MODULE_DATA_TABLE_RELATION_TARGET_UNKNOWN',
            `Relation "${relationName}" references unknown table "${relation.table}".`,
            `data.tables.${table.name}.relations.${relationName}.table`
          )
        );
      }
      if (!addressableColumnNames.has(relation.local)) {
        diagnostics.push(
          diagnostic(
            'error',
            'MODULE_DATA_TABLE_RELATION_LOCAL_FIELD_UNKNOWN',
            `Relation "${relationName}" local field "${relation.local}" is not declared.`,
            `data.tables.${table.name}.relations.${relationName}.local`
          )
        );
      }
      const targetColumnNames = new Set([
        ...STANDARD_COLUMN_NAMES,
        ...Object.keys(target?.columns ?? {}),
      ]);
      if (target && !targetColumnNames.has(relation.foreign)) {
        diagnostics.push(
          diagnostic(
            'error',
            'MODULE_DATA_TABLE_RELATION_FOREIGN_FIELD_UNKNOWN',
            `Relation "${relationName}" foreign field "${relation.foreign}" is not declared on "${relation.table}".`,
            `data.tables.${table.name}.relations.${relationName}.foreign`
          )
        );
      }
      if (relation.onDelete && !RELATION_ON_DELETE.has(relation.onDelete)) {
        diagnostics.push(
          diagnostic(
            'error',
            'MODULE_DATA_TABLE_RELATION_ON_DELETE_INVALID',
            `Relation "${relationName}" onDelete "${relation.onDelete}" is not supported.`,
            `data.tables.${table.name}.relations.${relationName}.onDelete`
          )
        );
      }
    }
  }

  const hasPhysicalDataDefinition =
    plan.tables.length > 0 ||
    plan.views.length > 0 ||
    plan.grants.length > 0 ||
    plan.checks.length > 0;
  if (hasPhysicalDataDefinition && !data.migrations) {
    diagnostics.push(
      diagnostic(
        'error',
        'MODULE_DATA_MIGRATIONS_REQUIRED',
        'Physical Data v2 definitions must declare an explicit migrations block.',
        'data.migrations',
        'Add migrations: { mode: "generated", dir: "./migrations" } or use mode: "sql".'
      )
    );
  }

  if (!DATA_MIGRATION_MODES.has(plan.migrations.mode)) {
    diagnostics.push(
      diagnostic(
        'error',
        'MODULE_DATA_MIGRATION_MODE_INVALID',
        `Data migration mode "${plan.migrations.mode}" is not supported.`,
        'data.migrations.mode',
        'Use "generated" or "sql".'
      )
    );
  }
  if (!LOCAL_DATA_PATH_PATTERN.test(plan.migrations.dir)) {
    diagnostics.push(
      diagnostic(
        'error',
        'MODULE_LOCAL_PATH_INVALID',
        `Data migrations directory "${plan.migrations.dir}" must be a local module path and must not escape the module root.`,
        'data.migrations.dir',
        'Use a path like "./migrations".'
      )
    );
  }

  const modelNames = dataModelNames(plan.documents, plan.tables, plan.views);
  for (const view of plan.views) {
    if (!view.definition?.source?.trim()) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_DATA_VIEW_SOURCE_REQUIRED',
          `View "${view.name}" must declare a source model.`,
          `data.views.${view.name}.source`
        )
      );
    }
    if (view.definition?.scope && !DATA_SCOPES.has(view.definition.scope)) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_DATA_SCOPE_INVALID',
          `View scope "${view.definition.scope}" is not supported.`,
          `data.views.${view.name}.scope`
        )
      );
    }
  }

  for (const grant of plan.grants) {
    if (!grant.definition?.model?.trim()) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_DATA_GRANT_MODEL_REQUIRED',
          `Grant "${grant.name}" must reference a model.`,
          `data.grants.${grant.name}.model`
        )
      );
    } else if (!modelNames.has(grant.definition.model)) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_DATA_GRANT_MODEL_UNKNOWN',
          `Grant "${grant.name}" references unknown model "${grant.definition.model}".`,
          `data.grants.${grant.name}.model`
        )
      );
    }
    if (!Array.isArray(grant.definition?.operations) || grant.definition.operations.length === 0) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_DATA_GRANT_OPERATIONS_REQUIRED',
          `Grant "${grant.name}" must declare at least one operation.`,
          `data.grants.${grant.name}.operations`
        )
      );
    }
  }

  for (const check of plan.checks) {
    if (!check.definition?.model?.trim()) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_DATA_CHECK_MODEL_REQUIRED',
          `Check "${check.name}" must reference a model.`,
          `data.checks.${check.name}.model`
        )
      );
    } else if (!modelNames.has(check.definition.model)) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_DATA_CHECK_MODEL_UNKNOWN',
          `Check "${check.name}" references unknown model "${check.definition.model}".`,
          `data.checks.${check.name}.model`
        )
      );
    }
  }
}

async function buildModulePlan(moduleRoot) {
  const moduleFile = path.join(moduleRoot, 'module.ts');
  const diagnostics = [];
  let definition;

  try {
    definition = await readModuleDefinition(moduleRoot);
  } catch (error) {
    return {
      moduleRoot: toProjectPath(moduleRoot),
      moduleId: path.basename(moduleRoot),
      hasData: false,
      diagnostics: [
        diagnostic(
          'error',
          'MODULE_DATA_CONTRACT_LOAD_FAILED',
          error instanceof Error ? error.message : String(error),
          toProjectPath(moduleFile),
          'Ensure module.ts exports defineModule(...) and compiles.'
        ),
      ],
      plan: null,
    };
  }

  const moduleId = typeof definition.id === 'string' ? definition.id : path.basename(moduleRoot);
  const data = definition.data;

  if (!data) {
    return {
      moduleRoot: toProjectPath(moduleRoot),
      moduleId,
      hasData: false,
      diagnostics,
      plan: null,
    };
  }

  const plan = {
    version: 1,
    moduleId,
    moduleRoot: toProjectPath(moduleRoot),
    dataVersion: Number.isInteger(data.version) ? data.version : data.version,
    documents: normalizeDocuments(data),
    tables: normalizeTables(data, moduleId),
    views: normalizeNamedDefinitions(data.views),
    grants: normalizeNamedDefinitions(data.grants),
    checks: normalizeNamedDefinitions(data.checks),
    migrations: normalizeMigrations(data),
  };
  validateNormalizedData(data, plan, diagnostics);

  return {
    moduleRoot: toProjectPath(moduleRoot),
    moduleId,
    hasData: true,
    diagnostics,
    plan: {
      ...plan,
      schemaHash: stableHash(plan),
    },
  };
}

async function buildPlans(options) {
  const roots = discoverModuleRoots(options.targetPath);
  const results = [];
  for (const root of roots) {
    const result = await buildModulePlan(root);
    if (options.moduleFilter.size === 0 || options.moduleFilter.has(result.moduleId)) {
      results.push(result);
    }
  }
  return results;
}

function quoteIdentifier(value) {
  return `"${value.replace(/"/g, '""')}"`;
}

function quoteString(value) {
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

function dbColumnType(column) {
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

function generateMetadataSql(modulePlan) {
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

function generateTableSql(modulePlan, table) {
  const tableName = quoteIdentifier(table.physicalName);
  const columnLines = STANDARD_COLUMNS.map(
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

function generateMigrationSql(modulePlan) {
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

  blocks.push(generateMetadataSql(modulePlan), '');

  for (const table of modulePlan.tables) {
    blocks.push(generateTableSql(modulePlan, table));
  }

  return `${blocks
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`;
}

function tsIdentifier(value, suffix = '') {
  const identifier = `${value
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part.replace(/[^A-Za-z0-9_$]/g, ''))
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join('')}${suffix}`;

  if (!identifier) {
    return `Module${suffix || 'Data'}`;
  }

  return /^[A-Za-z_$]/.test(identifier) ? identifier : `Module${identifier}`;
}

function documentFieldTs(field) {
  const nullable = field.type.endsWith('?') || field.required === false;
  const baseType = field.type.replace(/\?$/, '');
  const mapped =
    {
      string: 'string',
      text: 'string',
      number: 'number',
      integer: 'number',
      boolean: 'boolean',
      date: 'string',
      datetime: 'string',
      json: 'unknown',
    }[baseType] ?? 'unknown';
  return nullable ? `${mapped} | null` : mapped;
}

function tableColumnTs(column) {
  const mapped =
    {
      uuid: 'string',
      text: 'string',
      integer: 'number',
      number: 'number',
      boolean: 'boolean',
      jsonb: 'unknown',
      timestamp: 'string',
    }[column.kind] ?? 'unknown';
  return column.nullable === true ? `${mapped} | null` : mapped;
}

function generateTypes(modulePlan) {
  const lines = [
    '/**',
    ' * Generated by scripts/module-data.mjs.',
    ' * Do not edit by hand; change module.ts and run npm run data:types.',
    ' */',
    "import type { ModuleContext, ModuleDataDocument, ModuleDataTable } from '@ploykit/module-sdk';",
    '',
  ];

  for (const document of modulePlan.documents) {
    lines.push(`export interface ${tsIdentifier(document.name, 'Document')} {`);
    lines.push('  id: string;');
    for (const [fieldName, field] of Object.entries(document.fields)) {
      lines.push(`  ${fieldName}: ${documentFieldTs(field)};`);
    }
    lines.push('}', '');
  }

  for (const table of modulePlan.tables) {
    lines.push(`export interface ${tsIdentifier(table.name, 'Table')} {`);
    for (const column of STANDARD_COLUMNS) {
      lines.push(`  ${column.name}: ${column.ts};`);
    }
    for (const [columnName, column] of Object.entries(table.columns)) {
      lines.push(`  ${columnName}: ${tableColumnTs(column)};`);
    }
    lines.push('}', '');
  }

  lines.push(`export interface ${tsIdentifier(modulePlan.moduleId, 'Data')} {`);
  for (const document of modulePlan.documents) {
    lines.push(
      `  ${document.name}: ModuleDataDocument<${tsIdentifier(document.name, 'Document')}>;`
    );
  }
  for (const table of modulePlan.tables) {
    lines.push(`  ${table.name}: ModuleDataTable<${tsIdentifier(table.name, 'Table')}>;`);
  }
  lines.push('}', '');
  lines.push(
    `export function get${tsIdentifier(modulePlan.moduleId, 'Data')}(ctx: ModuleContext): ${tsIdentifier(modulePlan.moduleId, 'Data')} {`
  );
  lines.push('  return {');
  for (const document of modulePlan.documents) {
    lines.push(
      `    ${document.name}: ctx.data.document<${tsIdentifier(document.name, 'Document')}>(${quoteString(document.name)}),`
    );
  }
  for (const table of modulePlan.tables) {
    lines.push(
      `    ${table.name}: ctx.data.table<${tsIdentifier(table.name, 'Table')}>(${quoteString(table.name)}),`
    );
  }
  lines.push('  };');
  lines.push('}', '');

  return `${lines.join('\n')}`;
}

function resolveModuleLocalPath(moduleRoot, localPath) {
  if (!localPath.startsWith('./')) {
    throw new Error(`Module data path must be a local "./" path: ${localPath}`);
  }

  const moduleRootPath = path.resolve(moduleRoot);
  const relative = localPath.replace(/^\.\//, '');
  const resolved = path.resolve(moduleRootPath, relative);
  const inside = path.relative(moduleRootPath, resolved);
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) {
    throw new Error(`Module data path escapes module root: ${localPath}`);
  }
  return resolved;
}

function moduleGeneratedDir(moduleRoot) {
  return path.join(moduleRoot, '.ploykit', 'generated');
}

function modulePlanFile(moduleRoot) {
  return path.join(moduleGeneratedDir(moduleRoot), 'data-plan.json');
}

function moduleTypesFile(moduleRoot) {
  return path.join(moduleGeneratedDir(moduleRoot), 'data-types.ts');
}

function moduleMigrationFile(moduleRoot, modulePlan) {
  const migrationDir = resolveModuleLocalPath(moduleRoot, modulePlan.migrations.dir);
  return path.join(migrationDir, '0001_generated.sql');
}

function modulePlanContent(modulePlan) {
  return `${JSON.stringify(modulePlan, null, 2)}\n`;
}

function writeIfChanged(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (existing === content) {
    return false;
  }
  fs.writeFileSync(file, content, 'utf8');
  return true;
}

async function commandPlan(args) {
  const options = parseCommandArgs(args);
  const results = await buildPlans(options);
  const diagnostics = results.flatMap((result) => result.diagnostics);
  const success = !diagnostics.some((item) => item.severity === 'error');

  printJson({
    success,
    mode: 'static',
    count: results.length,
    modules: results.map((result) => result.plan ?? result),
    diagnostics,
  });

  if (!success) {
    process.exitCode = 1;
  }
}

async function commandGenerate(args) {
  const options = parseCommandArgs(args);
  const results = await buildPlans(options);
  const changed = [];
  const diagnostics = results.flatMap((result) => result.diagnostics);

  for (const result of results) {
    if (!result.plan || result.diagnostics.some((item) => item.severity === 'error')) {
      continue;
    }

    const moduleRoot = path.resolve(PROJECT_ROOT, result.plan.moduleRoot);
    if (writeIfChanged(modulePlanFile(moduleRoot), modulePlanContent(result.plan))) {
      changed.push(toProjectPath(modulePlanFile(moduleRoot)));
    }

    if (result.plan.migrations.mode === 'generated') {
      const migrationFile = moduleMigrationFile(moduleRoot, result.plan);
      if (writeIfChanged(migrationFile, generateMigrationSql(result.plan))) {
        changed.push(toProjectPath(migrationFile));
      }
    }
  }

  const success = !diagnostics.some((item) => item.severity === 'error');
  printJson({ success, mode: 'static', changed, diagnostics });
  if (!success) {
    process.exitCode = 1;
  }
}

async function commandTypes(args) {
  const options = parseCommandArgs(args);
  const results = await buildPlans(options);
  const changed = [];
  const diagnostics = results.flatMap((result) => result.diagnostics);

  for (const result of results) {
    if (!result.plan || result.diagnostics.some((item) => item.severity === 'error')) {
      continue;
    }

    const moduleRoot = path.resolve(PROJECT_ROOT, result.plan.moduleRoot);
    if (writeIfChanged(moduleTypesFile(moduleRoot), generateTypes(result.plan))) {
      changed.push(toProjectPath(moduleTypesFile(moduleRoot)));
    }
  }

  const success = !diagnostics.some((item) => item.severity === 'error');
  printJson({ success, mode: 'static', changed, diagnostics });
  if (!success) {
    process.exitCode = 1;
  }
}

function checkFile(file, expected, diagnostics, staleCode, missingCode, fix) {
  if (!fs.existsSync(file)) {
    diagnostics.push(
      diagnostic(
        'error',
        missingCode,
        `Expected generated file is missing: ${toProjectPath(file)}.`,
        toProjectPath(file),
        fix
      )
    );
    return;
  }

  const existing = fs.readFileSync(file, 'utf8');
  if (existing !== expected) {
    diagnostics.push(
      diagnostic(
        'error',
        staleCode,
        `Generated file is stale: ${toProjectPath(file)}.`,
        toProjectPath(file),
        fix
      )
    );
  }
}

function collectMigrationEntries(results, diagnostics) {
  const entries = [];

  for (const result of results) {
    if (!result.plan || result.diagnostics.some((item) => item.severity === 'error')) {
      continue;
    }

    const moduleRoot = path.resolve(PROJECT_ROOT, result.plan.moduleRoot);
    checkFile(
      modulePlanFile(moduleRoot),
      modulePlanContent(result.plan),
      diagnostics,
      'MODULE_DATA_PLAN_STALE',
      'MODULE_DATA_PLAN_MISSING',
      'Run npm run data:generate.'
    );

    if (result.plan.migrations.mode !== 'generated') {
      diagnostics.push(
        diagnostic(
          'warning',
          'MODULE_DATA_SQL_MIGRATION_MANUAL',
          `Module "${result.plan.moduleId}" uses manual SQL migrations; static runner will not apply generated SQL.`,
          result.plan.moduleRoot,
          'Apply the module migration directory through the project database migration system.'
        )
      );
      continue;
    }

    const expectedMigrationSql = generateMigrationSql(result.plan);
    const migrationFile = moduleMigrationFile(moduleRoot, result.plan);
    if (!fs.existsSync(migrationFile)) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_DATA_MIGRATION_MISSING',
          `Expected generated migration is missing: ${toProjectPath(migrationFile)}.`,
          toProjectPath(migrationFile),
          'Run npm run data:generate.'
        )
      );
      continue;
    }
    if (fs.readFileSync(migrationFile, 'utf8') !== expectedMigrationSql) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_DATA_MIGRATION_STALE',
          `Generated migration is stale: ${toProjectPath(migrationFile)}.`,
          toProjectPath(migrationFile),
          'Run npm run data:generate before applying migrations.'
        )
      );
    }

    entries.push({
      moduleId: result.plan.moduleId,
      schemaHash: result.plan.schemaHash,
      migrationFile,
      projectPath: toProjectPath(migrationFile),
      bytes: fs.statSync(migrationFile).size,
    });
  }

  return entries;
}

function databaseUrlFromOptions(options) {
  return (
    options.values.get('databaseUrl') ?? process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? ''
  );
}

function appDatabaseUrlFromOptions(options) {
  return options.values.get('appDatabaseUrl') ?? process.env.PLOYKIT_APP_DATABASE_URL ?? '';
}

async function createPgPool(databaseUrl) {
  const { Pool } = await import('pg');
  return new Pool({ connectionString: databaseUrl });
}

async function commandMigrate(args) {
  const options = parseCommandArgs(args);
  const results = await buildPlans(options);
  const diagnostics = results.flatMap((result) => result.diagnostics);
  const entries = collectMigrationEntries(results, diagnostics);
  const dryRun = options.flags.has('dry-run') || options.flags.has('plan');
  const databaseUrl = databaseUrlFromOptions(options);

  if (dryRun) {
    const success = !diagnostics.some((item) => item.severity === 'error');
    printJson({
      success,
      mode: 'dry-run',
      migrations: entries.map((entry) => ({
        moduleId: entry.moduleId,
        schemaHash: entry.schemaHash,
        path: entry.projectPath,
        bytes: entry.bytes,
      })),
      diagnostics,
    });
    if (!success) {
      process.exitCode = 1;
    }
    return;
  }

  if (!databaseUrl) {
    diagnostics.push(
      diagnostic(
        'error',
        'MODULE_DATA_MIGRATE_DATABASE_URL_REQUIRED',
        'data:migrate requires DATABASE_URL, POSTGRES_URL, or --database-url.',
        'DATABASE_URL',
        'Set DATABASE_URL or run npm run data:migrate -- --dry-run.'
      )
    );
  }

  if (diagnostics.some((item) => item.severity === 'error')) {
    printJson({
      success: false,
      mode: 'psql',
      applied: [],
      diagnostics,
    });
    process.exitCode = 1;
    return;
  }

  const applied = [];
  let pool;

  try {
    pool = await createPgPool(databaseUrl);
    for (const entry of entries) {
      const sql = fs.readFileSync(entry.migrationFile, 'utf8');
      await pool.query('begin');
      try {
        await pool.query(sql);
        await pool.query('commit');
      } catch (error) {
        await pool.query('rollback');
        throw error;
      }

      applied.push({
        moduleId: entry.moduleId,
        schemaHash: entry.schemaHash,
        path: entry.projectPath,
      });
    }
  } catch (error) {
    diagnostics.push(
      diagnostic(
        'error',
        'MODULE_DATA_MIGRATE_FAILED',
        error instanceof Error ? error.message : String(error),
        applied.length < entries.length ? entries[applied.length].projectPath : 'DATABASE_URL'
      )
    );
  } finally {
    if (pool) {
      await pool.end();
    }
  }

  if (applied.length !== entries.length && !diagnostics.some((item) => item.severity === 'error')) {
    diagnostics.push(
      diagnostic(
        'error',
        'MODULE_DATA_MIGRATE_FAILED',
        'Not all migrations were applied.',
        'DATABASE_URL'
      )
    );
  }

  const success = !diagnostics.some((item) => item.severity === 'error');
  printJson({
    success,
    mode: 'pg',
    applied,
    diagnostics,
  });

  if (!success) {
    process.exitCode = 1;
  }
}

function generateResetSql(modulePlan) {
  const blocks = [
    `-- Reset generated Data v2 objects for module ${modulePlan.moduleId}.`,
    `delete from public.module_documents where module_id = ${quoteString(modulePlan.moduleId)};`,
  ];

  for (const table of modulePlan.tables) {
    blocks.push(`drop table if exists public.${quoteIdentifier(table.physicalName)} cascade;`);
  }

  blocks.push(
    `delete from public.module_data_models where module_id = ${quoteString(modulePlan.moduleId)};`,
    `delete from public.module_data_migrations where module_id = ${quoteString(modulePlan.moduleId)};`,
    `delete from public.module_data_grants where module_id = ${quoteString(modulePlan.moduleId)};`,
    `delete from public.module_data_checks where module_id = ${quoteString(modulePlan.moduleId)};`
  );

  return `${blocks.join('\n')}\n`;
}

async function commandReset(args) {
  const options = parseCommandArgs(args);
  const results = await buildPlans(options);
  const diagnostics = results.flatMap((result) => result.diagnostics);
  const plans = results
    .filter((result) => result.plan && !result.diagnostics.some((item) => item.severity === 'error'))
    .map((result) => result.plan);
  const force = options.flags.has('force');
  const dryRun = options.flags.has('dry-run') || options.flags.has('plan') || !force;
  const databaseUrl = databaseUrlFromOptions(options);
  const resetPlans = plans.map((plan) => ({
    moduleId: plan.moduleId,
    sql: generateResetSql(plan),
  }));

  if (dryRun) {
    printJson({
      success: !diagnostics.some((item) => item.severity === 'error'),
      mode: 'dry-run',
      resetPlans,
      diagnostics,
      next: 'Pass --force with DATABASE_URL to apply the reset.',
    });
    return;
  }

  if (!databaseUrl) {
    diagnostics.push(
      diagnostic(
        'error',
        'MODULE_DATA_RESET_DATABASE_URL_REQUIRED',
        'data:reset --force requires DATABASE_URL, POSTGRES_URL, or --database-url.',
        'DATABASE_URL',
        'Run npm run data:reset -- --dry-run to inspect SQL first.'
      )
    );
  }

  if (diagnostics.some((item) => item.severity === 'error')) {
    printJson({ success: false, mode: 'pg', reset: [], diagnostics });
    process.exitCode = 1;
    return;
  }

  const reset = [];
  let pool;
  try {
    pool = await createPgPool(databaseUrl);
    for (const entry of resetPlans) {
      await pool.query('begin');
      try {
        await pool.query(entry.sql);
        await pool.query('commit');
      } catch (error) {
        await pool.query('rollback');
        throw error;
      }
      reset.push({ moduleId: entry.moduleId });
    }
  } catch (error) {
    diagnostics.push(
      diagnostic(
        'error',
        'MODULE_DATA_RESET_FAILED',
        error instanceof Error ? error.message : String(error),
        'DATABASE_URL'
      )
    );
  } finally {
    if (pool) {
      await pool.end();
    }
  }

  const success = !diagnostics.some((item) => item.severity === 'error');
  printJson({ success, mode: 'pg', reset, diagnostics });
  if (!success) {
    process.exitCode = 1;
  }
}

async function tableExists(pool, schema, tableName) {
  const result = await pool.query(`select to_regclass($1) is not null as exists`, [
    `${schema}.${quoteIdentifier(tableName)}`,
  ]);
  return Boolean(result.rows[0]?.exists);
}

async function readTableColumns(pool, schema, tableName) {
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

async function readRlsState(pool, schema, tableName) {
  const result = await pool.query(
    `select c.relrowsecurity, c.relforcerowsecurity
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = $1 and c.relname = $2`,
    [schema, tableName]
  );
  return result.rows[0] ?? null;
}

async function readRlsPolicies(pool, schema, tableName) {
  const result = await pool.query(
    `select policyname, cmd, qual, with_check
     from pg_policies
     where schemaname = $1 and tablename = $2`,
    [schema, tableName]
  );
  return result.rows;
}

async function readCurrentRoleSafety(pool, schema, tableNames) {
  const roleResult = await pool.query(
    `select r.rolname, r.rolsuper, r.rolbypassrls, r.rolcreatedb, r.rolcreaterole
     from pg_roles r
     where r.rolname = current_user`
  );
  const schemaPrivilegeResult = await pool.query(
    `select has_schema_privilege(current_user, $1, 'CREATE') as can_create`,
    [schema]
  );
  const ownerResult = tableNames.length > 0
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

function stripOuterParentheses(expression) {
  let value = expression.trim();
  while (value.startsWith('(') && value.endsWith(')')) {
    let depth = 0;
    let wrapped = true;
    for (let index = 0; index < value.length; index += 1) {
      const char = value[index];
      if (char === '(') {
        depth += 1;
      } else if (char === ')') {
        depth -= 1;
        if (depth === 0 && index < value.length - 1) {
          wrapped = false;
          break;
        }
      }
      if (depth < 0) {
        wrapped = false;
        break;
      }
    }
    if (!wrapped || depth !== 0) {
      break;
    }
    value = value.slice(1, -1).trim();
  }
  return value;
}

function normalizePolicyExpression(expression) {
  return stripOuterParentheses(
    String(expression ?? '').replace(/\s+/g, '').replace(/::text/g, '').toLowerCase()
  );
}

function policyExpressionHasAll(expression, fragments) {
  const normalized = normalizePolicyExpression(expression);
  return fragments.every((fragment) =>
    normalized.includes(normalizePolicyExpression(fragment))
  );
}

function expectedModuleDocumentScopePolicyFragments() {
  return {
    usingFragments: [
      `product_id = current_setting('ploykit.product_id', true)`,
      `module_id = current_setting('ploykit.module_id', true)`,
      `scope_type = 'public-read'`,
      `scope_type = current_setting('ploykit.scope_type', true)`,
      `scope_id = current_setting('ploykit.scope_id', true)`,
    ],
    withCheckFragments: [
      `product_id = current_setting('ploykit.product_id', true)`,
      `module_id = current_setting('ploykit.module_id', true)`,
      `scope_type = 'public-read'`,
      `scope_id is null`,
      `current_setting('ploykit.allow_public_write', true) = 'true'`,
      `scope_type = current_setting('ploykit.scope_type', true)`,
      `scope_id = current_setting('ploykit.scope_id', true)`,
    ],
  };
}

function expectedModuleTableScopePolicyFragments(moduleId) {
  return {
    usingFragments: [
      `product_id = current_setting('ploykit.product_id', true)`,
      `module_id = ${quoteString(moduleId)}`,
      `scope_type = 'public-read'`,
      `scope_type = current_setting('ploykit.scope_type', true)`,
      `scope_id = current_setting('ploykit.scope_id', true)`,
    ],
    withCheckFragments: [
      `product_id = current_setting('ploykit.product_id', true)`,
      `module_id = ${quoteString(moduleId)}`,
      `scope_type = 'public-read'`,
      `scope_id is null`,
      `current_setting('ploykit.allow_public_write', true) = 'true'`,
      `scope_type = current_setting('ploykit.scope_type', true)`,
      `scope_id = current_setting('ploykit.scope_id', true)`,
    ],
  };
}

async function metadataHash(pool, moduleId, kind, name) {
  const result = await pool.query(
    `select schema_hash
     from public.module_data_models
     where module_id = $1 and model_kind = $2 and model_name = $3`,
    [moduleId, kind, name]
  );
  return result.rows[0]?.schema_hash ?? null;
}

function pushDbError(diagnostics, code, message, path, fix, details) {
  pushDbDiagnostic(diagnostics, 'error', code, message, path, fix, details);
}

function pushDbDiagnostic(diagnostics, severity, code, message, path, fix, details) {
  diagnostics.push(diagnostic(severity, code, message, path, fix, details));
}

function expectedTableColumns(table) {
  const expected = new Map(Object.entries(STANDARD_DB_COLUMNS));

  for (const [name, column] of Object.entries(table.columns)) {
    expected.set(name, {
      type: dbColumnType(column),
      nullable: !(column.nullable === false || column.primaryKey),
    });
  }

  return expected;
}

function checkColumns(diagnostics, actual, expected, tablePath) {
  for (const [name, column] of expected.entries()) {
    const actualColumn = actual.get(name);
    if (!actualColumn) {
      pushDbError(
        diagnostics,
        'MODULE_DATA_DB_COLUMN_MISSING',
        `Expected database column "${name}" is missing.`,
        `${tablePath}.${name}`,
        'Run npm run data:migrate.'
      );
      continue;
    }

    if (actualColumn.type !== column.type) {
      pushDbError(
        diagnostics,
        'MODULE_DATA_DB_COLUMN_TYPE_MISMATCH',
        `Column "${name}" has database type "${actualColumn.type}", expected "${column.type}".`,
        `${tablePath}.${name}`,
        'Regenerate and apply the module migration.'
      );
    }

    if (actualColumn.nullable !== column.nullable) {
      pushDbError(
        diagnostics,
        'MODULE_DATA_DB_COLUMN_NULLABILITY_MISMATCH',
        `Column "${name}" nullable=${actualColumn.nullable}, expected ${column.nullable}.`,
        `${tablePath}.${name}`,
        'Regenerate and apply the module migration.'
      );
    }
  }
}

async function verifyRlsTable(
  pool,
  diagnostics,
  schema,
  tableName,
  policyName,
  pathValue,
  expectedExpressions
) {
  const rls = await readRlsState(pool, schema, tableName);
  if (!rls?.relrowsecurity || !rls?.relforcerowsecurity) {
    pushDbError(
      diagnostics,
      'MODULE_DATA_DB_RLS_DISABLED',
      `Table "${schema}.${tableName}" must have RLS enabled and forced.`,
      pathValue,
      'Run npm run data:migrate.'
    );
  }

  const policies = await readRlsPolicies(pool, schema, tableName);
  const policy = policies.find((row) => row.policyname === policyName);
  if (!policy) {
    pushDbError(
      diagnostics,
      'MODULE_DATA_DB_RLS_POLICY_MISSING',
      `RLS policy "${policyName}" is missing on "${schema}.${tableName}".`,
      pathValue,
      'Regenerate and apply the module migration.'
    );
    return;
  }

  const unexpectedPolicies = policies
    .filter((row) => row.policyname !== policyName)
    .map((row) => row.policyname);
  if (unexpectedPolicies.length > 0) {
    pushDbError(
      diagnostics,
      'MODULE_DATA_DB_RLS_POLICY_EXTRA',
      `Unexpected RLS policies exist on "${schema}.${tableName}": ${unexpectedPolicies.join(', ')}.`,
      pathValue,
      'Remove the extra policy or regenerate the module migration.',
      { expected: [policyName], actual: policies.map((row) => row.policyname) }
    );
  }

  if (String(policy.cmd ?? '').toUpperCase() !== 'ALL') {
    pushDbError(
      diagnostics,
      'MODULE_DATA_DB_RLS_POLICY_COMMAND_MISMATCH',
      `RLS policy "${policyName}" on "${schema}.${tableName}" must apply to ALL commands.`,
      pathValue,
      'Regenerate and apply the module migration.',
      { expected: 'ALL', actual: policy.cmd }
    );
  }

  const actualUsing = normalizePolicyExpression(policy.qual);
  const actualWithCheck = normalizePolicyExpression(policy.with_check);

  if (!policyExpressionHasAll(policy.qual, expectedExpressions.usingFragments)) {
    pushDbError(
      diagnostics,
      'MODULE_DATA_DB_RLS_POLICY_USING_MISMATCH',
      `RLS policy "${policyName}" on "${schema}.${tableName}" has an unexpected USING expression.`,
      pathValue,
      'Regenerate and apply the module migration.',
      { expected: expectedExpressions.usingFragments, actual: actualUsing }
    );
  }

  if (!policyExpressionHasAll(policy.with_check, expectedExpressions.withCheckFragments)) {
    pushDbError(
      diagnostics,
      'MODULE_DATA_DB_RLS_POLICY_WITH_CHECK_MISMATCH',
      `RLS policy "${policyName}" on "${schema}.${tableName}" has an unexpected WITH CHECK expression.`,
      pathValue,
      'Regenerate and apply the module migration.',
      { expected: expectedExpressions.withCheckFragments, actual: actualWithCheck }
    );
  }
}

function collectRlsTableNames(results) {
  const tableNames = new Set();
  for (const result of results) {
    if (!result.plan) {
      continue;
    }
    if (result.plan.documents.length > 0) {
      tableNames.add('module_documents');
    }
    for (const table of result.plan.tables) {
      tableNames.add(table.physicalName);
    }
  }
  return [...tableNames].sort();
}

async function verifyDatabaseRoleSafety(pool, diagnostics, schema, tableNames, input) {
  const severity = input.severity ?? 'warning';
  let safety;
  try {
    safety = await readCurrentRoleSafety(pool, schema, tableNames);
  } catch (error) {
    pushDbDiagnostic(
      diagnostics,
      severity,
      'MODULE_DATA_DB_ROLE_SAFETY_CHECK_FAILED',
      error instanceof Error ? error.message : String(error),
      input.path,
      'Run data:verify-db with a database role that can inspect pg_roles and pg_class.'
    );
    return;
  }

  const role = safety.role;
  if (!role) {
    pushDbDiagnostic(
      diagnostics,
      severity,
      'MODULE_DATA_DB_ROLE_NOT_FOUND',
      'Current database role was not found in pg_roles.',
      input.path,
      'Verify the runtime database role configuration.'
    );
    return;
  }

  const details = {
    role: role.rolname,
    source: input.source,
  };

  if (role.rolsuper || role.rolbypassrls) {
    pushDbDiagnostic(
      diagnostics,
      severity,
      'MODULE_DATA_DB_ROLE_BYPASS_RLS',
      `Database role "${role.rolname}" must not be superuser or BYPASSRLS for runtime Data v2 access.`,
      `${input.path}.bypassRls`,
      'Use a dedicated app role without SUPERUSER or BYPASSRLS.',
      {
        ...details,
        rolsuper: Boolean(role.rolsuper),
        rolbypassrls: Boolean(role.rolbypassrls),
      }
    );
  }

  if (role.rolcreatedb || role.rolcreaterole || safety.canCreateInSchema) {
    pushDbDiagnostic(
      diagnostics,
      severity,
      'MODULE_DATA_DB_ROLE_DDL_PRIVILEGES',
      `Database role "${role.rolname}" should not have DDL privileges for runtime Data v2 access.`,
      `${input.path}.ddl`,
      'Use a migration role for DDL and an app role for DML through RLS.',
      {
        ...details,
        rolcreatedb: Boolean(role.rolcreatedb),
        rolcreaterole: Boolean(role.rolcreaterole),
        canCreateInSchema: safety.canCreateInSchema,
      }
    );
  }

  if (safety.ownedTables.length > 0) {
    pushDbDiagnostic(
      diagnostics,
      severity,
      'MODULE_DATA_DB_ROLE_OWNS_RLS_TABLES',
      `Database role "${role.rolname}" owns RLS-protected table(s): ${safety.ownedTables.join(', ')}.`,
      `${input.path}.owner`,
      'Run modules with an app role that does not own Data v2 tables.',
      {
        ...details,
        ownedTables: safety.ownedTables,
      }
    );
  }
}

async function verifyModulePlanInDatabase(pool, diagnostics, modulePlan, schema) {
  if (modulePlan.documents.length > 0) {
    const tableName = 'module_documents';
    const pathValue = `${modulePlan.moduleRoot}:documents`;
    if (!(await tableExists(pool, schema, tableName))) {
      pushDbError(
        diagnostics,
        'MODULE_DATA_DB_TABLE_MISSING',
        `Expected database table "${schema}.${tableName}" is missing.`,
        pathValue,
        'Run npm run data:migrate.'
      );
    } else {
      checkColumns(
        diagnostics,
        await readTableColumns(pool, schema, tableName),
        new Map([
          ...Object.entries(STANDARD_DB_COLUMNS),
          ['document_name', { type: 'text', nullable: false }],
          ['data', { type: 'jsonb', nullable: false }],
        ]),
        `${pathValue}.module_documents`
      );
      await verifyRlsTable(
        pool,
        diagnostics,
        schema,
        tableName,
        'module_documents__module_scope_policy',
        pathValue,
        expectedModuleDocumentScopePolicyFragments()
      );
    }
  }

  for (const metadataTable of [
    'module_data_models',
    'module_data_migrations',
    'module_data_grants',
    'module_data_checks',
  ]) {
    if (!(await tableExists(pool, schema, metadataTable))) {
      pushDbError(
        diagnostics,
        'MODULE_DATA_DB_METADATA_TABLE_MISSING',
        `Expected database table "${schema}.${metadataTable}" is missing.`,
        `${modulePlan.moduleRoot}:metadata`,
        'Run npm run data:migrate.'
      );
    }
  }

  for (const document of modulePlan.documents) {
    const expectedHash = stableHash(document);
    const actualHash = await metadataHash(pool, modulePlan.moduleId, 'document', document.name);
    if (actualHash !== expectedHash) {
      pushDbError(
        diagnostics,
        'MODULE_DATA_DB_METADATA_HASH_MISMATCH',
        `Document "${document.name}" metadata hash is "${actualHash}", expected "${expectedHash}".`,
        `${modulePlan.moduleRoot}:documents.${document.name}`,
        'Run npm run data:migrate.'
      );
    }
  }

  for (const table of modulePlan.tables) {
    const pathValue = `${modulePlan.moduleRoot}:tables.${table.name}`;
    if (!(await tableExists(pool, schema, table.physicalName))) {
      pushDbError(
        diagnostics,
        'MODULE_DATA_DB_TABLE_MISSING',
        `Expected database table "${schema}.${table.physicalName}" is missing.`,
        pathValue,
        'Run npm run data:migrate.'
      );
      continue;
    }

    checkColumns(
      diagnostics,
      await readTableColumns(pool, schema, table.physicalName),
      expectedTableColumns(table),
      pathValue
    );
    await verifyRlsTable(
      pool,
      diagnostics,
      schema,
      table.physicalName,
      `${table.physicalName}__module_scope_policy`,
      pathValue,
      expectedModuleTableScopePolicyFragments(modulePlan.moduleId)
    );

    const expectedHash = stableHash(table);
    const actualHash = await metadataHash(pool, modulePlan.moduleId, 'table', table.name);
    if (actualHash !== expectedHash) {
      pushDbError(
        diagnostics,
        'MODULE_DATA_DB_METADATA_HASH_MISMATCH',
        `Table "${table.name}" metadata hash is "${actualHash}", expected "${expectedHash}".`,
        pathValue,
        'Run npm run data:migrate.'
      );
    }
  }
}

async function commandVerifyDb(args) {
  const options = parseCommandArgs(args);
  const results = await buildPlans(options);
  const diagnostics = results.flatMap((result) => result.diagnostics);
  const databaseUrl = databaseUrlFromOptions(options);
  const appDatabaseUrl = appDatabaseUrlFromOptions(options);
  const requireAppRoleSafety =
    options.flags.has('require-app-role-safety') ||
    process.env.PLOYKIT_DATA_VERIFY_APP_ROLE_REQUIRED === 'true';
  const schema = options.values.get('schema') ?? 'public';
  const rlsTableNames = collectRlsTableNames(results);

  if (!databaseUrl) {
    diagnostics.push(
      diagnostic(
        'error',
        'MODULE_DATA_VERIFY_DB_DATABASE_URL_REQUIRED',
        'data:verify-db requires DATABASE_URL, POSTGRES_URL, or --database-url.',
        'DATABASE_URL',
        'Start Docker Postgres and pass --database-url or set DATABASE_URL.'
      )
    );
  }

  let pool;
  if (!diagnostics.some((item) => item.severity === 'error')) {
    try {
      pool = await createPgPool(databaseUrl);
      for (const result of results) {
        if (!result.plan || result.diagnostics.some((item) => item.severity === 'error')) {
          continue;
        }
        await verifyModulePlanInDatabase(pool, diagnostics, result.plan, schema);
      }
      await verifyDatabaseRoleSafety(pool, diagnostics, schema, rlsTableNames, {
        source: 'verify-db',
        severity: 'warning',
        path: 'DATABASE_URL.role',
      });
    } catch (error) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_DATA_VERIFY_DB_FAILED',
          error instanceof Error ? error.message : String(error),
          'DATABASE_URL'
        )
      );
    } finally {
      if (pool) {
        await pool.end();
      }
    }
  }

  if (appDatabaseUrl) {
    let appPool;
    try {
      appPool = await createPgPool(appDatabaseUrl);
      await verifyDatabaseRoleSafety(appPool, diagnostics, schema, rlsTableNames, {
        source: 'app-runtime',
        severity: 'error',
        path: 'PLOYKIT_APP_DATABASE_URL.role',
      });
    } catch (error) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_DATA_DB_APP_ROLE_SAFETY_FAILED',
          error instanceof Error ? error.message : String(error),
          'PLOYKIT_APP_DATABASE_URL',
          'Verify PLOYKIT_APP_DATABASE_URL points to the runtime app role.'
        )
      );
    } finally {
      if (appPool) {
        await appPool.end();
      }
    }
  } else if (requireAppRoleSafety) {
    diagnostics.push(
      diagnostic(
        'error',
        'MODULE_DATA_DB_APP_ROLE_URL_REQUIRED',
        'App-role RLS safety verification requires PLOYKIT_APP_DATABASE_URL or --app-database-url.',
        'PLOYKIT_APP_DATABASE_URL',
        'Set PLOYKIT_APP_DATABASE_URL to the runtime app role connection string.'
      )
    );
  } else {
    diagnostics.push(
      diagnostic(
        'warning',
        'MODULE_DATA_DB_APP_ROLE_SAFETY_SKIPPED',
        'App-role RLS safety verification was skipped because no PLOYKIT_APP_DATABASE_URL was configured.',
        'PLOYKIT_APP_DATABASE_URL',
        'Set PLOYKIT_APP_DATABASE_URL or pass --app-database-url to verify app role superuser, BYPASSRLS, owner, and DDL risks.'
      )
    );
  }

  const success = !diagnostics.some((item) => item.severity === 'error');
  printJson({
    success,
    mode: 'database',
    checkedModules: results.filter((result) => result.plan).length,
    diagnostics,
  });

  if (!success) {
    process.exitCode = 1;
  }
}

async function commandVerify(args) {
  const options = parseCommandArgs(args);
  const results = await buildPlans(options);
  const diagnostics = results.flatMap((result) => result.diagnostics);

  for (const result of results) {
    if (!result.plan || result.diagnostics.some((item) => item.severity === 'error')) {
      continue;
    }

    const moduleRoot = path.resolve(PROJECT_ROOT, result.plan.moduleRoot);
    checkFile(
      modulePlanFile(moduleRoot),
      modulePlanContent(result.plan),
      diagnostics,
      'MODULE_DATA_PLAN_STALE',
      'MODULE_DATA_PLAN_MISSING',
      'Run npm run data:generate.'
    );
    checkFile(
      moduleTypesFile(moduleRoot),
      generateTypes(result.plan),
      diagnostics,
      'MODULE_DATA_TYPES_STALE',
      'MODULE_DATA_TYPES_MISSING',
      'Run npm run data:types.'
    );

    if (result.plan.migrations.mode === 'generated') {
      checkFile(
        moduleMigrationFile(moduleRoot, result.plan),
        generateMigrationSql(result.plan),
        diagnostics,
        'MODULE_DATA_MIGRATION_STALE',
        'MODULE_DATA_MIGRATION_MISSING',
        'Run npm run data:generate.'
      );
    }
  }

  const success = !diagnostics.some((item) => item.severity === 'error');
  printJson({
    success,
    mode: 'static',
    checkedModules: results.filter((result) => result.plan).length,
    diagnostics,
  });

  if (!success) {
    process.exitCode = 1;
  }
}

async function main() {
  const [, , command, ...args] = process.argv;

  try {
    switch (command) {
      case 'plan':
        await commandPlan(args);
        return;
      case 'generate':
        await commandGenerate(args);
        return;
      case 'types':
        await commandTypes(args);
        return;
      case 'migrate':
        await commandMigrate(args);
        return;
      case 'verify':
        await commandVerify(args);
        return;
      case 'verify-db':
        await commandVerifyDb(args);
        return;
      case 'reset':
        await commandReset(args);
        return;
      default:
        console.error(
          'Usage: module-data <plan|generate|migrate|types|verify|verify-db|reset> [...args] [--app-database-url <url>] [--require-app-role-safety]'
        );
        process.exitCode = 1;
    }
  } catch (error) {
    printJson({
      success: false,
      diagnostics: [
        diagnostic(
          'error',
          'MODULE_DATA_CLI_ERROR',
          error instanceof Error ? error.message : String(error)
        ),
      ],
    });
    process.exitCode = 1;
  }
}

try {
  await main();
} finally {
  await tsx.unregister();
}

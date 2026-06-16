import crypto from 'node:crypto';

export const STANDARD_COLUMNS = [
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
const DATA_SCOPES = new Set(['user', 'workspace', 'product', 'public-read', 'system']);
const DATA_MIGRATION_MODES = new Set(['generated', 'sql']);
const RELATION_ON_DELETE = new Set(['cascade', 'restrict', 'set-null']);
const LOCAL_DATA_PATH_PATTERN = /^\.\/(?!\.)(?!.*(?:^|\/)\.\.(?:\/|$))/;

export function moduleDataPhysicalTableName(moduleId, tableName) {
  return `mod_${moduleId.replace(/-/g, '_')}__${tableName}`;
}

export function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
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

export function normalizeDocumentField(field) {
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

export function normalizeDocuments(data) {
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

export function normalizeColumn(column) {
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

export function normalizeTables(data, moduleId) {
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

export function normalizeNamedDefinitions(definitions) {
  return Object.entries(definitions ?? {}).map(([name, definition]) => ({
    name,
    definition: cloneJson(definition ?? {}),
  }));
}

export function normalizeMigrations(data) {
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

export function createModuleDataPlanHelpers(input) {
  const { diagnostic, toProjectPath } = input;

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
      if (
        !Array.isArray(grant.definition?.operations) ||
        grant.definition.operations.length === 0
      ) {
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

  function createModuleDataPlan(moduleRoot, moduleId, data) {
    const diagnostics = [];
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
      diagnostics,
      plan: {
        ...plan,
        schemaHash: stableHash(plan),
      },
    };
  }

  return {
    createModuleDataPlan,
    validateNormalizedData,
  };
}

import { createModuleDiagnostic, type ModuleDiagnostic } from './diagnostics';
import type { ModuleDataDefinition } from './data';

const MODULE_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
const LOCAL_PATH_PATTERN = /^\.\/(?!\.)(?!.*(?:^|\/)\.\.(?:\/|$))/;
const DATA_MIGRATION_MODES = new Set(['generated', 'sql']);
const DATA_SCOPES = new Set(['user', 'workspace', 'product', 'public-read', 'system']);
const DOCUMENT_FIELD_TYPES = new Set([
  'string',
  'string?',
  'text',
  'text?',
  'number',
  'number?',
  'integer',
  'integer?',
  'boolean',
  'boolean?',
  'date',
  'date?',
  'datetime',
  'datetime?',
  'json',
  'json?',
]);
const COLUMN_KINDS = new Set([
  'uuid',
  'text',
  'integer',
  'number',
  'boolean',
  'jsonb',
  'timestamp',
]);
const DATA_STANDARD_COLUMNS = new Set([
  'id',
  'product_id',
  'module_id',
  'scope_type',
  'scope_id',
  'created_at',
  'updated_at',
  'deleted_at',
  'created_by',
  'updated_by',
]);
const DATA_RELATION_ON_DELETE = new Set(['cascade', 'restrict', 'set-null']);

function addError(
  diagnostics: ModuleDiagnostic[],
  code: string,
  message: string,
  path: string,
  fix?: string
): void {
  diagnostics.push(createModuleDiagnostic({ code, severity: 'error', message, path, fix }));
}

function validateKey(
  diagnostics: ModuleDiagnostic[],
  key: string,
  path: string,
  label: string
): void {
  if (!MODULE_KEY_PATTERN.test(key)) {
    addError(
      diagnostics,
      'MODULE_KEY_INVALID',
      `${label} "${key}" must use snake_case and start with a letter.`,
      path,
      'Use a key like "orders", "blog_posts", or "create_order".'
    );
  }
}

function validateLocalModulePath(
  diagnostics: ModuleDiagnostic[],
  value: string | undefined,
  path: string,
  label: string,
  required = true
): void {
  if (!value) {
    if (required) {
      addError(diagnostics, 'MODULE_LOCAL_PATH_REQUIRED', `${label} path is required.`, path);
    }
    return;
  }

  if (!LOCAL_PATH_PATTERN.test(value)) {
    addError(
      diagnostics,
      'MODULE_LOCAL_PATH_INVALID',
      `${label} path "${value}" must be a local module path and must not escape the module root.`,
      path,
      'Use a path like "./api/run" or "./pages/HomePage".'
    );
  }
}

export function validateData(
  diagnostics: ModuleDiagnostic[],
  data: ModuleDataDefinition | undefined
): void {
  if (!data) {
    return;
  }

  if (!Number.isInteger(data.version) || data.version < 1) {
    addError(
      diagnostics,
      'MODULE_DATA_VERSION_INVALID',
      'Data definition version must be a positive integer.',
      'data.version'
    );
  }

  for (const [documentName, document] of Object.entries(data.documents ?? {})) {
    validateKey(diagnostics, documentName, `data.documents.${documentName}`, 'Document');

    if (document.scope && !DATA_SCOPES.has(document.scope)) {
      addError(
        diagnostics,
        'MODULE_DATA_SCOPE_INVALID',
        `Document scope "${document.scope}" is not supported.`,
        `data.documents.${documentName}.scope`
      );
    }

    if (Object.keys(document.fields ?? {}).length === 0) {
      addError(
        diagnostics,
        'MODULE_DATA_DOCUMENT_FIELDS_REQUIRED',
        `Document "${documentName}" must declare at least one field.`,
        `data.documents.${documentName}.fields`
      );
    }

    for (const [fieldName, field] of Object.entries(document.fields ?? {})) {
      validateKey(
        diagnostics,
        fieldName,
        `data.documents.${documentName}.fields.${fieldName}`,
        'Document field'
      );
      const fieldType = typeof field === 'string' ? field : field.type;
      if (!DOCUMENT_FIELD_TYPES.has(fieldType)) {
        addError(
          diagnostics,
          'MODULE_DATA_DOCUMENT_FIELD_TYPE_INVALID',
          `Document field type "${fieldType}" is not supported.`,
          `data.documents.${documentName}.fields.${fieldName}.type`
        );
      }
    }
  }

  for (const [tableName, table] of Object.entries(data.tables ?? {})) {
    validateKey(diagnostics, tableName, `data.tables.${tableName}`, 'Table');

    if (table.$$type !== 'ploykit.data.table') {
      addError(
        diagnostics,
        'MODULE_DATA_TABLE_DSL_REQUIRED',
        `Table "${tableName}" must be created with table(...).`,
        `data.tables.${tableName}`,
        'Use table({ scope, columns, indexes, unique }).'
      );
    }

    if (!DATA_SCOPES.has(table.scope)) {
      addError(
        diagnostics,
        'MODULE_DATA_SCOPE_INVALID',
        `Table scope "${table.scope}" is not supported.`,
        `data.tables.${tableName}.scope`
      );
    }

    if (Object.keys(table.columns ?? {}).length === 0) {
      addError(
        diagnostics,
        'MODULE_DATA_TABLE_COLUMNS_REQUIRED',
        `Table "${tableName}" must declare at least one column.`,
        `data.tables.${tableName}.columns`
      );
    }

    for (const [columnName, column] of Object.entries(table.columns ?? {})) {
      validateKey(
        diagnostics,
        columnName,
        `data.tables.${tableName}.columns.${columnName}`,
        'Table column'
      );
      if (!COLUMN_KINDS.has(column.kind)) {
        addError(
          diagnostics,
          'MODULE_DATA_TABLE_COLUMN_KIND_INVALID',
          `Table column kind "${column.kind}" is not supported.`,
          `data.tables.${tableName}.columns.${columnName}.kind`
        );
      }
    }

    const columnNames = new Set(Object.keys(table.columns ?? {}));
    const addressableColumnNames = new Set([...DATA_STANDARD_COLUMNS, ...columnNames]);
    for (const [kind, groups] of [
      ['unique', table.unique ?? []],
      ['indexes', table.indexes ?? []],
    ] as const) {
      for (const [groupIndex, fields] of groups.entries()) {
        for (const [fieldIndex, field] of fields.entries()) {
          if (!columnNames.has(field)) {
            addError(
              diagnostics,
              'MODULE_DATA_TABLE_INDEX_FIELD_UNKNOWN',
              `Table "${tableName}" ${kind} field "${field}" is not declared as a column.`,
              `data.tables.${tableName}.${kind}.${groupIndex}.${fieldIndex}`
            );
          }
        }
      }
    }

    for (const [relationName, relation] of Object.entries(table.relations ?? {})) {
      validateKey(
        diagnostics,
        relationName,
        `data.tables.${tableName}.relations.${relationName}`,
        'Table relation'
      );

      const targetTable = data.tables?.[relation.table];
      if (!targetTable) {
        addError(
          diagnostics,
          'MODULE_DATA_TABLE_RELATION_TARGET_UNKNOWN',
          `Relation "${relationName}" references unknown table "${relation.table}".`,
          `data.tables.${tableName}.relations.${relationName}.table`
        );
      }

      if (!addressableColumnNames.has(relation.local)) {
        addError(
          diagnostics,
          'MODULE_DATA_TABLE_RELATION_LOCAL_FIELD_UNKNOWN',
          `Relation "${relationName}" local field "${relation.local}" is not declared.`,
          `data.tables.${tableName}.relations.${relationName}.local`
        );
      }

      const targetColumnNames = new Set([
        ...DATA_STANDARD_COLUMNS,
        ...Object.keys(targetTable?.columns ?? {}),
      ]);
      if (targetTable && !targetColumnNames.has(relation.foreign)) {
        addError(
          diagnostics,
          'MODULE_DATA_TABLE_RELATION_FOREIGN_FIELD_UNKNOWN',
          `Relation "${relationName}" foreign field "${relation.foreign}" is not declared on "${relation.table}".`,
          `data.tables.${tableName}.relations.${relationName}.foreign`
        );
      }

      if (relation.onDelete && !DATA_RELATION_ON_DELETE.has(relation.onDelete)) {
        addError(
          diagnostics,
          'MODULE_DATA_TABLE_RELATION_ON_DELETE_INVALID',
          `Relation "${relationName}" onDelete "${relation.onDelete}" is not supported.`,
          `data.tables.${tableName}.relations.${relationName}.onDelete`
        );
      }
    }
  }

  for (const [viewName, view] of Object.entries(data.views ?? {})) {
    validateKey(diagnostics, viewName, `data.views.${viewName}`, 'View');
    if (!view.source?.trim()) {
      addError(
        diagnostics,
        'MODULE_DATA_VIEW_SOURCE_REQUIRED',
        `View "${viewName}" must declare a source model.`,
        `data.views.${viewName}.source`
      );
    }
    if (view.scope && !DATA_SCOPES.has(view.scope)) {
      addError(
        diagnostics,
        'MODULE_DATA_SCOPE_INVALID',
        `View scope "${view.scope}" is not supported.`,
        `data.views.${viewName}.scope`
      );
    }
  }

  const modelNames = new Set([
    ...Object.keys(data.documents ?? {}),
    ...Object.keys(data.tables ?? {}),
    ...Object.keys(data.views ?? {}),
  ]);

  for (const [grantName, grant] of Object.entries(data.grants ?? {})) {
    validateKey(diagnostics, grantName, `data.grants.${grantName}`, 'Grant');
    if (!grant.model?.trim()) {
      addError(
        diagnostics,
        'MODULE_DATA_GRANT_MODEL_REQUIRED',
        `Grant "${grantName}" must reference a model.`,
        `data.grants.${grantName}.model`
      );
    } else if (!modelNames.has(grant.model)) {
      addError(
        diagnostics,
        'MODULE_DATA_GRANT_MODEL_UNKNOWN',
        `Grant "${grantName}" references unknown model "${grant.model}".`,
        `data.grants.${grantName}.model`
      );
    }
    if ((grant.operations ?? []).length === 0) {
      addError(
        diagnostics,
        'MODULE_DATA_GRANT_OPERATIONS_REQUIRED',
        `Grant "${grantName}" must declare at least one operation.`,
        `data.grants.${grantName}.operations`
      );
    }
  }

  for (const [checkName, check] of Object.entries(data.checks ?? {})) {
    validateKey(diagnostics, checkName, `data.checks.${checkName}`, 'Check');
    if (!check.model?.trim()) {
      addError(
        diagnostics,
        'MODULE_DATA_CHECK_MODEL_REQUIRED',
        `Check "${checkName}" must reference a model.`,
        `data.checks.${checkName}.model`
      );
    } else if (!modelNames.has(check.model)) {
      addError(
        diagnostics,
        'MODULE_DATA_CHECK_MODEL_UNKNOWN',
        `Check "${checkName}" references unknown model "${check.model}".`,
        `data.checks.${checkName}.model`
      );
    }
  }

  const hasPhysicalDataDefinition =
    Object.keys(data.tables ?? {}).length > 0 ||
    Object.keys(data.views ?? {}).length > 0 ||
    Object.keys(data.grants ?? {}).length > 0 ||
    Object.keys(data.checks ?? {}).length > 0;

  if (hasPhysicalDataDefinition && !data.migrations) {
    addError(
      diagnostics,
      'MODULE_DATA_MIGRATIONS_REQUIRED',
      'Physical Data v2 definitions must declare an explicit migrations block.',
      'data.migrations',
      'Add migrations: { mode: "generated", dir: "./migrations" } or use mode: "sql".'
    );
  }

  if (data.migrations) {
    if (!DATA_MIGRATION_MODES.has(data.migrations.mode)) {
      addError(
        diagnostics,
        'MODULE_DATA_MIGRATION_MODE_INVALID',
        `Data migration mode "${data.migrations.mode}" is not supported.`,
        'data.migrations.mode',
        'Use "generated" or "sql".'
      );
    }

    validateLocalModulePath(
      diagnostics,
      data.migrations.dir,
      'data.migrations.dir',
      'Data migrations directory'
    );
  }
}

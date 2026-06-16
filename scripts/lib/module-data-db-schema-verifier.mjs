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

export function createModuleDataDbSchemaVerifier(input) {
  const { dbColumnType, metadataHash, pushDbError, readTableColumns, stableHash, tableExists } =
    input;

  const rlsVerifier = input.rlsVerifier;

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
        await rlsVerifier.verifyRlsTable(
          pool,
          diagnostics,
          schema,
          tableName,
          'module_documents__module_scope_policy',
          pathValue,
          rlsVerifier.expectedModuleDocumentScopePolicyFragments()
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
      await rlsVerifier.verifyRlsTable(
        pool,
        diagnostics,
        schema,
        table.physicalName,
        `${table.physicalName}__module_scope_policy`,
        pathValue,
        rlsVerifier.expectedModuleTableScopePolicyFragments(modulePlan.moduleId)
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

  return {
    checkColumns,
    expectedTableColumns,
    verifyModulePlanInDatabase,
  };
}

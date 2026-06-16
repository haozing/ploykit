import { createModuleDataDbSchemaVerifier } from './module-data-db-schema-verifier.mjs';
import { createModuleDataRlsVerifier } from './module-data-db-rls.mjs';
import { createModuleDataRoleSafetyVerifier } from './module-data-db-role-safety.mjs';
import { createModuleDataVerifyDbCommand } from './module-data-verify-db-command.mjs';

export function createModuleDataDbVerifier(input) {
  const {
    appDatabaseUrlFromOptions,
    createPgPool,
    databaseUrlFromOptions,
    dbColumnType,
    diagnostic,
    metadataHash,
    printJson,
    quoteString,
    readCurrentRoleSafety,
    readRlsPolicies,
    readRlsState,
    readTableColumns,
    stableHash,
    tableExists,
  } = input;

  function pushDbError(diagnostics, code, message, path, fix, details) {
    pushDbDiagnostic(diagnostics, 'error', code, message, path, fix, details);
  }

  function pushDbDiagnostic(diagnostics, severity, code, message, path, fix, details) {
    diagnostics.push(diagnostic(severity, code, message, path, fix, details));
  }

  const roleSafetyVerifier = createModuleDataRoleSafetyVerifier({
    diagnostic,
    readCurrentRoleSafety,
  });

  const rlsVerifier = createModuleDataRlsVerifier({
    pushDbError,
    quoteString,
    readRlsPolicies,
    readRlsState,
  });

  const schemaVerifier = createModuleDataDbSchemaVerifier({
    dbColumnType,
    metadataHash,
    pushDbError,
    readTableColumns,
    rlsVerifier,
    stableHash,
    tableExists,
  });

  return createModuleDataVerifyDbCommand({
    appDatabaseUrlFromOptions,
    createPgPool,
    databaseUrlFromOptions,
    diagnostic,
    printJson,
    roleSafetyVerifier,
    schemaVerifier,
  });
}

export function createModuleDataRoleSafetyVerifier(input) {
  const { diagnostic, readCurrentRoleSafety } = input;

  function pushDiagnostic(diagnostics, severity, code, message, path, fix, details) {
    diagnostics.push(diagnostic(severity, code, message, path, fix, details));
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

  async function verifyDatabaseRoleSafety(pool, diagnostics, schema, tableNames, verifyInput) {
    const severity = verifyInput.severity ?? 'warning';
    let safety;
    try {
      safety = await readCurrentRoleSafety(pool, schema, tableNames);
    } catch (error) {
      pushDiagnostic(
        diagnostics,
        severity,
        'MODULE_DATA_DB_ROLE_SAFETY_CHECK_FAILED',
        error instanceof Error ? error.message : String(error),
        verifyInput.path,
        'Run data:verify-db with a database role that can inspect pg_roles and pg_class.'
      );
      return;
    }

    const role = safety.role;
    if (!role) {
      pushDiagnostic(
        diagnostics,
        severity,
        'MODULE_DATA_DB_ROLE_NOT_FOUND',
        'Current database role was not found in pg_roles.',
        verifyInput.path,
        'Verify the runtime database role configuration.'
      );
      return;
    }

    const details = {
      role: role.rolname,
      source: verifyInput.source,
    };

    if (role.rolsuper || role.rolbypassrls) {
      pushDiagnostic(
        diagnostics,
        severity,
        'MODULE_DATA_DB_ROLE_BYPASS_RLS',
        `Database role "${role.rolname}" must not be superuser or BYPASSRLS for runtime Data v2 access.`,
        `${verifyInput.path}.bypassRls`,
        'Use a dedicated app role without SUPERUSER or BYPASSRLS.',
        {
          ...details,
          rolsuper: Boolean(role.rolsuper),
          rolbypassrls: Boolean(role.rolbypassrls),
        }
      );
    }

    if (role.rolcreatedb || role.rolcreaterole || safety.canCreateInSchema) {
      pushDiagnostic(
        diagnostics,
        severity,
        'MODULE_DATA_DB_ROLE_DDL_PRIVILEGES',
        `Database role "${role.rolname}" should not have DDL privileges for runtime Data v2 access.`,
        `${verifyInput.path}.ddl`,
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
      pushDiagnostic(
        diagnostics,
        severity,
        'MODULE_DATA_DB_ROLE_OWNS_RLS_TABLES',
        `Database role "${role.rolname}" owns RLS-protected table(s): ${safety.ownedTables.join(', ')}.`,
        `${verifyInput.path}.owner`,
        'Run modules with an app role that does not own Data v2 tables.',
        {
          ...details,
          ownedTables: safety.ownedTables,
        }
      );
    }
  }

  function pushAppRoleUrlRequired(diagnostics) {
    pushDiagnostic(
      diagnostics,
      'error',
      'MODULE_DATA_DB_APP_ROLE_URL_REQUIRED',
      'App-role RLS safety verification requires PLOYKIT_APP_DATABASE_URL or --app-database-url.',
      'PLOYKIT_APP_DATABASE_URL',
      'Set PLOYKIT_APP_DATABASE_URL to the runtime app role connection string.'
    );
  }

  function pushAppRoleSafetySkipped(diagnostics) {
    pushDiagnostic(
      diagnostics,
      'warning',
      'MODULE_DATA_DB_APP_ROLE_SAFETY_SKIPPED',
      'App-role RLS safety verification was skipped because no PLOYKIT_APP_DATABASE_URL was configured.',
      'PLOYKIT_APP_DATABASE_URL',
      'Set PLOYKIT_APP_DATABASE_URL or pass --app-database-url to verify app role superuser, BYPASSRLS, owner, and DDL risks.'
    );
  }

  return {
    collectRlsTableNames,
    pushAppRoleSafetySkipped,
    pushAppRoleUrlRequired,
    verifyDatabaseRoleSafety,
  };
}

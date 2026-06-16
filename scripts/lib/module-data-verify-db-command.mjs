export function createModuleDataVerifyDbCommand(input) {
  const {
    appDatabaseUrlFromOptions,
    createPgPool,
    databaseUrlFromOptions,
    diagnostic,
    printJson,
    roleSafetyVerifier,
    schemaVerifier,
  } = input;

  function hasErrors(diagnostics) {
    return diagnostics.some((item) => item.severity === 'error');
  }

  function pushDatabaseUrlRequired(diagnostics) {
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

  async function withPool(databaseUrl, callback) {
    const pool = await createPgPool(databaseUrl);
    try {
      return await callback(pool);
    } finally {
      await pool.end();
    }
  }

  async function verifyPrimaryDatabase(databaseUrl, diagnostics, results, schema, rlsTableNames) {
    if (hasErrors(diagnostics)) {
      return;
    }

    try {
      await withPool(databaseUrl, async (pool) => {
        for (const result of results) {
          if (!result.plan || result.diagnostics.some((item) => item.severity === 'error')) {
            continue;
          }
          await schemaVerifier.verifyModulePlanInDatabase(pool, diagnostics, result.plan, schema);
        }
        await roleSafetyVerifier.verifyDatabaseRoleSafety(
          pool,
          diagnostics,
          schema,
          rlsTableNames,
          {
            source: 'verify-db',
            severity: 'warning',
            path: 'DATABASE_URL.role',
          }
        );
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
    }
  }

  async function verifyAppRoleDatabase(appDatabaseUrl, diagnostics, schema, rlsTableNames) {
    try {
      await withPool(appDatabaseUrl, async (pool) => {
        await roleSafetyVerifier.verifyDatabaseRoleSafety(
          pool,
          diagnostics,
          schema,
          rlsTableNames,
          {
            source: 'app-runtime',
            severity: 'error',
            path: 'PLOYKIT_APP_DATABASE_URL.role',
          }
        );
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
    }
  }

  async function commandVerifyDb(args, context) {
    const options = context.parseCommandArgs(args);
    const results = await context.buildPlans(options);
    const diagnostics = results.flatMap((result) => result.diagnostics);
    const databaseUrl = databaseUrlFromOptions(options);
    const appDatabaseUrl = appDatabaseUrlFromOptions(options);
    const requireAppRoleSafety =
      options.flags.has('require-app-role-safety') ||
      process.env.PLOYKIT_DATA_VERIFY_APP_ROLE_REQUIRED === 'true';
    const schema = options.values.get('schema') ?? 'public';
    const rlsTableNames = roleSafetyVerifier.collectRlsTableNames(results);

    if (!databaseUrl) {
      pushDatabaseUrlRequired(diagnostics);
    }

    await verifyPrimaryDatabase(databaseUrl, diagnostics, results, schema, rlsTableNames);

    if (appDatabaseUrl) {
      await verifyAppRoleDatabase(appDatabaseUrl, diagnostics, schema, rlsTableNames);
    } else if (requireAppRoleSafety) {
      roleSafetyVerifier.pushAppRoleUrlRequired(diagnostics);
    } else {
      roleSafetyVerifier.pushAppRoleSafetySkipped(diagnostics);
    }

    const success = !hasErrors(diagnostics);
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

  return {
    commandVerifyDb,
    hasErrors,
    pushDatabaseUrlRequired,
    verifyAppRoleDatabase,
    verifyPrimaryDatabase,
  };
}

export function createModuleDataDbMutationRunner(input) {
  const { createPgPool, diagnostic, readMigrationSql } = input;

  function hasErrors(diagnostics) {
    return diagnostics.some((item) => item.severity === 'error');
  }

  function pushMigrateDatabaseUrlRequired(diagnostics) {
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

  function pushResetDatabaseUrlRequired(diagnostics) {
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

  async function runTransaction(pool, sql) {
    await pool.query('begin');
    try {
      await pool.query(sql);
      await pool.query('commit');
    } catch (error) {
      await pool.query('rollback');
      throw error;
    }
  }

  async function applyMigrationEntries(databaseUrl, entries, diagnostics) {
    const applied = [];
    let pool;

    try {
      pool = await createPgPool(databaseUrl);
      for (const entry of entries) {
        await runTransaction(pool, readMigrationSql(entry.migrationFile));
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

    if (applied.length !== entries.length && !hasErrors(diagnostics)) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_DATA_MIGRATE_FAILED',
          'Not all migrations were applied.',
          'DATABASE_URL'
        )
      );
    }

    return applied;
  }

  async function applyResetPlans(databaseUrl, resetPlans, diagnostics) {
    const reset = [];
    let pool;

    try {
      pool = await createPgPool(databaseUrl);
      for (const entry of resetPlans) {
        await runTransaction(pool, entry.sql);
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

    return reset;
  }

  return {
    applyMigrationEntries,
    applyResetPlans,
    hasErrors,
    pushMigrateDatabaseUrlRequired,
    pushResetDatabaseUrlRequired,
    runTransaction,
  };
}

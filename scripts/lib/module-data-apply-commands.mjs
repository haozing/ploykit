export function createModuleDataApplyCommands(input) {
  const {
    artifacts,
    buildPlans,
    createMigrationDryRunPayload,
    createResetDryRunPayload,
    databaseUrlFromOptions,
    dbMutations,
    generateResetSql,
    parseCommandArgs,
    printJson,
  } = input;

  async function loadApplyContext(args) {
    const options = parseCommandArgs(args);
    const results = await buildPlans(options);
    const diagnostics = results.flatMap((result) => result.diagnostics);
    return { diagnostics, options, results };
  }

  async function commandMigrate(args) {
    const { diagnostics, options, results } = await loadApplyContext(args);
    const entries = artifacts.collectMigrationEntries(results, diagnostics);
    const dryRun = options.flags.has('dry-run') || options.flags.has('plan');
    const databaseUrl = databaseUrlFromOptions(options);

    if (dryRun) {
      const payload = createMigrationDryRunPayload(entries, diagnostics);
      printJson(payload);
      if (!payload.success) {
        process.exitCode = 1;
      }
      return;
    }

    if (!databaseUrl) {
      dbMutations.pushMigrateDatabaseUrlRequired(diagnostics);
    }

    if (dbMutations.hasErrors(diagnostics)) {
      printJson({
        success: false,
        mode: 'psql',
        applied: [],
        diagnostics,
      });
      process.exitCode = 1;
      return;
    }

    const applied = await dbMutations.applyMigrationEntries(databaseUrl, entries, diagnostics);
    const success = !dbMutations.hasErrors(diagnostics);
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

  async function commandReset(args) {
    const { diagnostics, options, results } = await loadApplyContext(args);
    const plans = results
      .filter(
        (result) => result.plan && !result.diagnostics.some((item) => item.severity === 'error')
      )
      .map((result) => result.plan);
    const force = options.flags.has('force');
    const dryRun = options.flags.has('dry-run') || options.flags.has('plan') || !force;
    const databaseUrl = databaseUrlFromOptions(options);
    const resetPlans = plans.map((plan) => ({
      moduleId: plan.moduleId,
      sql: generateResetSql(plan),
    }));

    if (dryRun) {
      printJson(createResetDryRunPayload(resetPlans, diagnostics));
      return;
    }

    if (!databaseUrl) {
      dbMutations.pushResetDatabaseUrlRequired(diagnostics);
    }

    if (dbMutations.hasErrors(diagnostics)) {
      printJson({ success: false, mode: 'pg', reset: [], diagnostics });
      process.exitCode = 1;
      return;
    }

    const reset = await dbMutations.applyResetPlans(databaseUrl, resetPlans, diagnostics);
    const success = !dbMutations.hasErrors(diagnostics);
    printJson({ success, mode: 'pg', reset, diagnostics });
    if (!success) {
      process.exitCode = 1;
    }
  }

  return {
    commandMigrate,
    commandReset,
    loadApplyContext,
  };
}

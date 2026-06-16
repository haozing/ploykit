import path from 'node:path';

export function createModuleDataStaticCommands(input) {
  const {
    artifacts,
    buildPlans,
    generateMigrationSql,
    generateTypes,
    parseCommandArgs,
    printJson,
    projectRoot,
    toProjectPath,
  } = input;

  function hasErrors(diagnostics) {
    return diagnostics.some((item) => item.severity === 'error');
  }

  function completeWithPayload(payload, diagnostics) {
    const success = !hasErrors(diagnostics);
    printJson({ success, ...payload, diagnostics });
    if (!success) {
      process.exitCode = 1;
    }
  }

  async function loadStaticContext(args) {
    const options = parseCommandArgs(args);
    const results = await buildPlans(options);
    const diagnostics = results.flatMap((result) => result.diagnostics);
    return { diagnostics, options, results };
  }

  async function commandPlan(args) {
    const { diagnostics, results } = await loadStaticContext(args);
    completeWithPayload(
      {
        mode: 'static',
        count: results.length,
        modules: results.map((result) => result.plan ?? result),
      },
      diagnostics
    );
  }

  async function commandGenerate(args) {
    const { diagnostics, results } = await loadStaticContext(args);
    const changed = [];

    for (const result of results) {
      if (!result.plan || hasErrors(result.diagnostics)) {
        continue;
      }

      const moduleRoot = path.resolve(projectRoot, result.plan.moduleRoot);
      if (
        artifacts.writeIfChanged(
          artifacts.modulePlanFile(moduleRoot),
          artifacts.modulePlanContent(result.plan)
        )
      ) {
        changed.push(toProjectPath(artifacts.modulePlanFile(moduleRoot)));
      }

      if (result.plan.migrations.mode === 'generated') {
        const migrationFile = artifacts.moduleMigrationFile(moduleRoot, result.plan);
        if (artifacts.writeIfChanged(migrationFile, generateMigrationSql(result.plan))) {
          changed.push(toProjectPath(migrationFile));
        }
      }
    }

    completeWithPayload({ mode: 'static', changed }, diagnostics);
  }

  async function commandTypes(args) {
    const { diagnostics, results } = await loadStaticContext(args);
    const changed = [];

    for (const result of results) {
      if (!result.plan || hasErrors(result.diagnostics)) {
        continue;
      }

      const moduleRoot = path.resolve(projectRoot, result.plan.moduleRoot);
      if (
        artifacts.writeIfChanged(artifacts.moduleTypesFile(moduleRoot), generateTypes(result.plan))
      ) {
        changed.push(toProjectPath(artifacts.moduleTypesFile(moduleRoot)));
      }
    }

    completeWithPayload({ mode: 'static', changed }, diagnostics);
  }

  async function commandVerify(args) {
    const { diagnostics, results } = await loadStaticContext(args);
    artifacts.verifyGeneratedArtifacts(results, diagnostics);
    completeWithPayload(
      {
        mode: 'static',
        checkedModules: results.filter((result) => result.plan).length,
      },
      diagnostics
    );
  }

  return {
    commandGenerate,
    commandPlan,
    commandTypes,
    commandVerify,
    completeWithPayload,
    hasErrors,
    loadStaticContext,
  };
}

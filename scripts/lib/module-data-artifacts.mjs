import fs from 'node:fs';
import path from 'node:path';

export function createModuleDataArtifactHelpers(input) {
  const {
    diagnostic,
    generateMigrationSql,
    generateOpenApi,
    generateTypes,
    projectRoot,
    resolveModuleLocalPath,
    toProjectPath,
  } = input;

  function moduleGeneratedDir(moduleRoot) {
    return path.join(moduleRoot, '.ploykit', 'generated');
  }

  function modulePlanFile(moduleRoot) {
    return path.join(moduleGeneratedDir(moduleRoot), 'data-plan.json');
  }

  function moduleTypesFile(moduleRoot) {
    return path.join(moduleGeneratedDir(moduleRoot), 'data-types.ts');
  }

  function moduleOpenApiFile(moduleRoot) {
    return path.join(moduleGeneratedDir(moduleRoot), 'openapi.json');
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

      const moduleRoot = path.resolve(projectRoot, result.plan.moduleRoot);
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

  function verifyGeneratedArtifacts(results, diagnostics) {
    for (const result of results) {
      if (!result.plan || result.diagnostics.some((item) => item.severity === 'error')) {
        continue;
      }

      const moduleRoot = path.resolve(projectRoot, result.plan.moduleRoot);
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
      checkFile(
        moduleOpenApiFile(moduleRoot),
        generateOpenApi(result.plan),
        diagnostics,
        'MODULE_OPENAPI_STALE',
        'MODULE_OPENAPI_MISSING',
        'Run npm run data:generate.'
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
  }

  return {
    collectMigrationEntries,
    moduleMigrationFile,
    modulePlanContent,
    modulePlanFile,
    moduleOpenApiFile,
    moduleTypesFile,
    verifyGeneratedArtifacts,
    writeIfChanged,
  };
}

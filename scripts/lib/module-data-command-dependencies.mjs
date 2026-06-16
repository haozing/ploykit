import fs from 'node:fs';
import path from 'node:path';
import {
  discoverModuleRoots as discoverConfiguredModuleRoots,
  findModuleRootsInSource,
  getModuleSources,
  slash,
} from './module-sources.mjs';
import {
  dbColumnType,
  generateMigrationSql as generateMigrationSqlFromPlan,
  quoteString,
} from './module-data-sql.mjs';
import { createModuleDataArtifactHelpers } from './module-data-artifacts.mjs';
import {
  appDatabaseUrlFromOptions,
  createPgPool,
  databaseUrlFromOptions,
  metadataHash,
  readCurrentRoleSafety,
  readRlsPolicies,
  readRlsState,
  readTableColumns,
  tableExists,
} from './module-data-db-introspection.mjs';
import { createModuleDataDbMutationRunner } from './module-data-db-mutate-command.mjs';
import { createModuleDataDbVerifier } from './module-data-db-verifier.mjs';
import { createModuleDataStaticCommands } from './module-data-static-commands.mjs';
import { generateResetSql } from './module-data-reset-sql.mjs';
import { generateTypes as generateDataTypes } from './module-data-types.mjs';
import { STANDARD_COLUMNS, createModuleDataPlanHelpers, stableHash } from './module-data-plan.mjs';
import { createMigrationDryRunPayload, createResetDryRunPayload } from './module-data-dry-run.mjs';
import { createModuleDataLoader } from './module-data-loader.mjs';
import { createModuleDataApplyCommands } from './module-data-apply-commands.mjs';
import { resolveModuleLocalPath } from './module-data-paths.mjs';
import { parseCommandArgs } from './module-data-args.mjs';

export function createModuleDataCommandDependencies(input) {
  const { diagnostic, importModule, parentUrl, printJson, projectRoot = process.cwd() } = input;

  function toProjectPath(file) {
    return slash(path.relative(projectRoot, file));
  }

  function discoverModuleRoots(targetPath) {
    if (!targetPath || targetPath === 'all') {
      return getModuleSources(projectRoot).sources.flatMap(findModuleRootsInSource);
    }
    return discoverConfiguredModuleRoots(projectRoot, targetPath);
  }

  const moduleDataLoader = createModuleDataLoader({
    diagnostic,
    importModule,
    parentUrl,
    toProjectPath,
  });

  const dataPlanHelpers = createModuleDataPlanHelpers({
    diagnostic,
    toProjectPath,
  });

  async function buildModulePlan(moduleRoot) {
    const diagnostics = [];
    const loaded = await moduleDataLoader.loadModuleDefinition(moduleRoot);

    if (!loaded.ok) {
      return loaded.result;
    }

    const { definition } = loaded;
    const moduleId = typeof definition.id === 'string' ? definition.id : path.basename(moduleRoot);
    const data = definition.data;

    if (!data) {
      return {
        moduleRoot: toProjectPath(moduleRoot),
        moduleId,
        hasData: false,
        diagnostics,
        plan: null,
      };
    }

    const result = dataPlanHelpers.createModuleDataPlan(moduleRoot, moduleId, data);
    diagnostics.push(...result.diagnostics);

    return {
      moduleRoot: toProjectPath(moduleRoot),
      moduleId,
      hasData: true,
      diagnostics,
      plan: result.plan,
    };
  }

  async function buildPlans(options) {
    const roots = discoverModuleRoots(options.targetPath);
    const results = [];
    for (const root of roots) {
      const result = await buildModulePlan(root);
      if (options.moduleFilter.size === 0 || options.moduleFilter.has(result.moduleId)) {
        results.push(result);
      }
    }
    return results;
  }

  function generateMigrationSql(modulePlan) {
    return generateMigrationSqlFromPlan(modulePlan, {
      stableHash,
      standardColumns: STANDARD_COLUMNS,
    });
  }

  function generateTypes(modulePlan) {
    return generateDataTypes(modulePlan, { standardColumns: STANDARD_COLUMNS });
  }

  const dataArtifacts = createModuleDataArtifactHelpers({
    diagnostic,
    generateMigrationSql,
    generateTypes,
    projectRoot,
    resolveModuleLocalPath,
    toProjectPath,
  });

  const dataDbMutations = createModuleDataDbMutationRunner({
    createPgPool,
    diagnostic,
    readMigrationSql: (file) => fs.readFileSync(file, 'utf8'),
  });

  const dataStaticCommands = createModuleDataStaticCommands({
    artifacts: dataArtifacts,
    buildPlans,
    generateMigrationSql,
    generateTypes,
    parseCommandArgs,
    printJson,
    projectRoot,
    toProjectPath,
  });

  const dataApplyCommands = createModuleDataApplyCommands({
    artifacts: dataArtifacts,
    buildPlans,
    createMigrationDryRunPayload,
    createResetDryRunPayload,
    databaseUrlFromOptions,
    dbMutations: dataDbMutations,
    generateResetSql,
    parseCommandArgs,
    printJson,
  });

  const dataVerifyDbCommand = createModuleDataDbVerifier({
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
  });

  const commands = {
    plan: dataStaticCommands.commandPlan,
    generate: dataStaticCommands.commandGenerate,
    types: dataStaticCommands.commandTypes,
    migrate: dataApplyCommands.commandMigrate,
    verify: dataStaticCommands.commandVerify,
    'verify-db': (args) =>
      dataVerifyDbCommand.commandVerifyDb(args, {
        buildPlans,
        parseCommandArgs,
      }),
    reset: dataApplyCommands.commandReset,
  };

  return {
    buildModulePlan,
    buildPlans,
    commands,
    dataApplyCommands,
    dataArtifacts,
    dataStaticCommands,
    dataVerifyDbCommand,
    discoverModuleRoots,
    generateMigrationSql,
    generateTypes,
    parseCommandArgs,
    toProjectPath,
  };
}

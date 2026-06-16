import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type {
  ModuleDataApplyCommandsModule,
  ModuleDataArgsModule,
  ModuleDataCliRunnerModule,
  ModuleDataCommandDependenciesModule,
  ModuleDataDbIntrospectionModule,
  ModuleDataDbMutationModule,
  ModuleDataDbSchemaVerifierModule,
  ModuleDataDbVerifierModule,
  ModuleDataDryRunModule,
  ModuleDataLoaderModule,
  ModuleDataPathsModule,
  ModuleDataPlanModule,
  ModuleDataResetSqlModule,
  ModuleDataRlsModule,
  ModuleDataRoleSafetyModule,
  ModuleDataStaticCommandsModule,
  ModuleDataTypesModule,
  ModuleDataVerifyDbCommandModule,
} from './advanced-runtime-data-helpers';

function moduleDataScriptUrl(file: string): string {
  return pathToFileURL(path.join(process.cwd(), 'scripts', 'lib', file)).href;
}

export function importModuleDataRls(): Promise<ModuleDataRlsModule> {
  return import(moduleDataScriptUrl('module-data-db-rls.mjs')) as Promise<ModuleDataRlsModule>;
}

export function importModuleDataDbIntrospection(): Promise<ModuleDataDbIntrospectionModule> {
  return import(
    moduleDataScriptUrl('module-data-db-introspection.mjs')
  ) as Promise<ModuleDataDbIntrospectionModule>;
}

export function importModuleDataRoleSafety(): Promise<ModuleDataRoleSafetyModule> {
  return import(
    moduleDataScriptUrl('module-data-db-role-safety.mjs')
  ) as Promise<ModuleDataRoleSafetyModule>;
}

export function importModuleDataDbSchemaVerifier(): Promise<ModuleDataDbSchemaVerifierModule> {
  return import(
    moduleDataScriptUrl('module-data-db-schema-verifier.mjs')
  ) as Promise<ModuleDataDbSchemaVerifierModule>;
}

export function importModuleDataVerifyDbCommand(): Promise<ModuleDataVerifyDbCommandModule> {
  return import(
    moduleDataScriptUrl('module-data-verify-db-command.mjs')
  ) as Promise<ModuleDataVerifyDbCommandModule>;
}

export function importModuleDataDbVerifier(): Promise<ModuleDataDbVerifierModule> {
  return import(
    moduleDataScriptUrl('module-data-db-verifier.mjs')
  ) as Promise<ModuleDataDbVerifierModule>;
}

export function importModuleDataDbMutation(): Promise<ModuleDataDbMutationModule> {
  return import(
    moduleDataScriptUrl('module-data-db-mutate-command.mjs')
  ) as Promise<ModuleDataDbMutationModule>;
}

export function importModuleDataStaticCommands(): Promise<ModuleDataStaticCommandsModule> {
  return import(
    moduleDataScriptUrl('module-data-static-commands.mjs')
  ) as Promise<ModuleDataStaticCommandsModule>;
}

export function importModuleDataResetSql(): Promise<ModuleDataResetSqlModule> {
  return import(
    moduleDataScriptUrl('module-data-reset-sql.mjs')
  ) as Promise<ModuleDataResetSqlModule>;
}

export function importModuleDataCliRunner(): Promise<ModuleDataCliRunnerModule> {
  return import(
    moduleDataScriptUrl('module-data-cli-runner.mjs')
  ) as Promise<ModuleDataCliRunnerModule>;
}

export function importModuleDataTypes(): Promise<ModuleDataTypesModule> {
  return import(moduleDataScriptUrl('module-data-types.mjs')) as Promise<ModuleDataTypesModule>;
}

export function importModuleDataPlan(): Promise<ModuleDataPlanModule> {
  return import(moduleDataScriptUrl('module-data-plan.mjs')) as Promise<ModuleDataPlanModule>;
}

export function importModuleDataDryRun(): Promise<ModuleDataDryRunModule> {
  return import(moduleDataScriptUrl('module-data-dry-run.mjs')) as Promise<ModuleDataDryRunModule>;
}

export function importModuleDataLoader(): Promise<ModuleDataLoaderModule> {
  return import(moduleDataScriptUrl('module-data-loader.mjs')) as Promise<ModuleDataLoaderModule>;
}

export function importModuleDataApplyCommands(): Promise<ModuleDataApplyCommandsModule> {
  return import(
    moduleDataScriptUrl('module-data-apply-commands.mjs')
  ) as Promise<ModuleDataApplyCommandsModule>;
}

export function importModuleDataPaths(): Promise<ModuleDataPathsModule> {
  return import(moduleDataScriptUrl('module-data-paths.mjs')) as Promise<ModuleDataPathsModule>;
}

export function importModuleDataArgs(): Promise<ModuleDataArgsModule> {
  return import(moduleDataScriptUrl('module-data-args.mjs')) as Promise<ModuleDataArgsModule>;
}

export function importModuleDataCommandDependencies(): Promise<ModuleDataCommandDependenciesModule> {
  return import(
    moduleDataScriptUrl('module-data-command-dependencies.mjs')
  ) as Promise<ModuleDataCommandDependenciesModule>;
}

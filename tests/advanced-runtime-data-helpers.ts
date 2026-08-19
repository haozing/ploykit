export { writeDataDiffFixture } from './advanced-runtime-data-fixtures';
export {
  importModuleDataApplyCommands,
  importModuleDataArgs,
  importModuleDataCliRunner,
  importModuleDataCommandDependencies,
  importModuleDataDbIntrospection,
  importModuleDataDbMutation,
  importModuleDataDbSchemaVerifier,
  importModuleDataDbVerifier,
  importModuleDataDryRun,
  importModuleDataLoader,
  importModuleDataPaths,
  importModuleDataPlan,
  importModuleDataResetSql,
  importModuleDataRls,
  importModuleDataRoleSafety,
  importModuleDataStaticCommands,
  importModuleDataTypes,
  importModuleDataVerifyDbCommand,
} from './advanced-runtime-data-module-imports';

export type ModuleDataRlsModule = {
  createModuleDataRlsVerifier(input: {
    quoteString(value: string): string;
    readRlsPolicies(): Promise<
      {
        policyname: string;
        cmd: string;
        qual: string | null;
        with_check: string | null;
      }[]
    >;
    readRlsState(): Promise<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>;
    pushDbError(
      diagnostics: { code: string }[],
      code: string,
      message: string,
      path: string,
      fix?: string,
      details?: unknown
    ): void;
  }): {
    expectedModuleTableScopePolicyFragments(moduleId: string): {
      usingFragments: string[];
      withCheckFragments: string[];
    };
    verifyRlsTable(
      pool: unknown,
      diagnostics: { code: string }[],
      schema: string,
      tableName: string,
      policyName: string,
      path: string,
      expectedExpressions: { usingFragments: string[]; withCheckFragments: string[] }
    ): Promise<void>;
  };
};

export type QueryPool = {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
};

export type ModuleDataDbIntrospectionModule = {
  tableExists(pool: QueryPool, schema: string, tableName: string): Promise<boolean>;
  readTableColumns(
    pool: QueryPool,
    schema: string,
    tableName: string
  ): Promise<Map<string, { type: string; nullable: boolean }>>;
  readCurrentRoleSafety(
    pool: QueryPool,
    schema: string,
    tableNames: string[]
  ): Promise<{
    role: Record<string, unknown> | null;
    canCreateInSchema: boolean;
    ownedTables: string[];
  }>;
  metadataHash(
    pool: QueryPool,
    moduleId: string,
    kind: string,
    name: string
  ): Promise<string | null>;
};

export type RoleSafetyDiagnostic = {
  severity: string;
  code: string;
  message: string;
  path?: string;
  fix?: string;
  details?: unknown;
};

export type ModuleDataRoleSafetyModule = {
  createModuleDataRoleSafetyVerifier(input: {
    diagnostic(
      severity: string,
      code: string,
      message: string,
      path?: string,
      fix?: string,
      details?: unknown
    ): RoleSafetyDiagnostic;
    readCurrentRoleSafety(): Promise<{
      role: {
        rolname: string;
        rolsuper: boolean;
        rolbypassrls: boolean;
        rolcreatedb: boolean;
        rolcreaterole: boolean;
      } | null;
      canCreateInSchema: boolean;
      ownedTables: string[];
    }>;
  }): {
    collectRlsTableNames(results: unknown[]): string[];
    pushAppRoleSafetySkipped(diagnostics: RoleSafetyDiagnostic[]): void;
    pushAppRoleUrlRequired(diagnostics: RoleSafetyDiagnostic[]): void;
    verifyDatabaseRoleSafety(
      pool: unknown,
      diagnostics: RoleSafetyDiagnostic[],
      schema: string,
      tableNames: string[],
      input: { source: string; severity?: string; path: string }
    ): Promise<void>;
  };
};

export type DbSchemaDiagnostic = { code: string; path?: string };

export type ModuleDataDbSchemaVerifierModule = {
  createModuleDataDbSchemaVerifier(input: {
    dbColumnType(column: { kind: string }): string;
    metadataHash(
      pool: unknown,
      moduleId: string,
      kind: string,
      name: string
    ): Promise<string | null>;
    pushDbError(
      diagnostics: DbSchemaDiagnostic[],
      code: string,
      message: string,
      path: string,
      fix?: string,
      details?: unknown
    ): void;
    readTableColumns(
      pool: unknown,
      schema: string,
      tableName: string
    ): Promise<Map<string, { type: string; nullable: boolean }>>;
    rlsVerifier: {
      expectedModuleDocumentScopePolicyFragments(): {
        usingFragments: string[];
        withCheckFragments: string[];
      };
      expectedModuleTableScopePolicyFragments(moduleId: string): {
        usingFragments: string[];
        withCheckFragments: string[];
      };
      verifyRlsTable(
        pool: unknown,
        diagnostics: DbSchemaDiagnostic[],
        schema: string,
        tableName: string,
        policyName: string,
        path: string,
        expectedExpressions: { usingFragments: string[]; withCheckFragments: string[] }
      ): Promise<void>;
    };
    stableHash(value: unknown): string;
    tableExists(pool: unknown, schema: string, tableName: string): Promise<boolean>;
  }): {
    verifyModulePlanInDatabase(
      pool: unknown,
      diagnostics: DbSchemaDiagnostic[],
      modulePlan: {
        moduleId: string;
        moduleRoot: string;
        documents: { name: string }[];
        tables: {
          name: string;
          physicalName: string;
          columns: Record<string, { kind: string; nullable?: boolean; primaryKey?: boolean }>;
        }[];
      },
      schema: string
    ): Promise<void>;
  };
};

export type VerifyDbDiagnostic = {
  severity: string;
  code: string;
  message: string;
  path?: string;
  fix?: string;
};

export type ModuleDataVerifyDbCommandModule = {
  createModuleDataVerifyDbCommand(input: {
    appDatabaseUrlFromOptions(options: { values: Map<string, string>; flags: Set<string> }): string;
    createPgPool(databaseUrl: string): Promise<{ url: string; end(): Promise<void> }>;
    databaseUrlFromOptions(options: { values: Map<string, string>; flags: Set<string> }): string;
    diagnostic(
      severity: string,
      code: string,
      message: string,
      path?: string,
      fix?: string
    ): VerifyDbDiagnostic;
    printJson(value: unknown): void;
    roleSafetyVerifier: {
      collectRlsTableNames(results: unknown[]): string[];
      pushAppRoleSafetySkipped(diagnostics: VerifyDbDiagnostic[]): void;
      pushAppRoleUrlRequired(diagnostics: VerifyDbDiagnostic[]): void;
      verifyDatabaseRoleSafety(
        pool: { url: string },
        diagnostics: VerifyDbDiagnostic[],
        schema: string,
        tableNames: string[],
        input: { source: string; severity?: string; path: string }
      ): Promise<void>;
    };
    schemaVerifier: {
      verifyModulePlanInDatabase(
        pool: { url: string },
        diagnostics: VerifyDbDiagnostic[],
        plan: { moduleId: string },
        schema: string
      ): Promise<void>;
    };
  }): {
    commandVerifyDb(
      args: string[],
      context: {
        parseCommandArgs(args: string[]): { values: Map<string, string>; flags: Set<string> };
        buildPlans(options: { values: Map<string, string>; flags: Set<string> }): Promise<
          {
            plan?: { moduleId: string };
            diagnostics: VerifyDbDiagnostic[];
          }[]
        >;
      }
    ): Promise<void>;
  };
};

export type ModuleDataDbVerifierModule = {
  createModuleDataDbVerifier(input: {
    appDatabaseUrlFromOptions(options: { values: Map<string, string>; flags: Set<string> }): string;
    createPgPool(databaseUrl: string): Promise<{ url: string; end(): Promise<void> }>;
    databaseUrlFromOptions(options: { values: Map<string, string>; flags: Set<string> }): string;
    dbColumnType(column: { kind: string }): string;
    diagnostic(
      severity: string,
      code: string,
      message: string,
      path?: string,
      fix?: string,
      details?: unknown
    ): VerifyDbDiagnostic & { details?: unknown };
    metadataHash(
      pool: { url: string },
      moduleId: string,
      kind: string,
      name: string
    ): Promise<string | null>;
    printJson(value: unknown): void;
    quoteString(value: string): string;
    readCurrentRoleSafety(
      pool: { url: string },
      schema: string,
      tableNames: string[]
    ): Promise<{
      role: {
        rolname: string;
        rolsuper: boolean;
        rolbypassrls: boolean;
        rolcreatedb: boolean;
        rolcreaterole: boolean;
      } | null;
      canCreateInSchema: boolean;
      ownedTables: string[];
    }>;
    readRlsPolicies(
      pool: { url: string },
      schema: string,
      tableName: string
    ): Promise<
      {
        policyname: string;
        cmd: string;
        qual: string | null;
        with_check: string | null;
      }[]
    >;
    readRlsState(
      pool: { url: string },
      schema: string,
      tableName: string
    ): Promise<{ relrowsecurity: boolean; relforcerowsecurity: boolean } | null>;
    readTableColumns(
      pool: { url: string },
      schema: string,
      tableName: string
    ): Promise<Map<string, { type: string; nullable: boolean }>>;
    stableHash(value: unknown): string;
    tableExists(pool: { url: string }, schema: string, tableName: string): Promise<boolean>;
  }): {
    commandVerifyDb(
      args: string[],
      context: {
        parseCommandArgs(args: string[]): { values: Map<string, string>; flags: Set<string> };
        buildPlans(options: { values: Map<string, string>; flags: Set<string> }): Promise<
          {
            plan?: {
              moduleId: string;
              moduleRoot: string;
              documents: { name: string }[];
              tables: {
                name: string;
                physicalName: string;
                columns: Record<string, { kind: string; nullable?: boolean }>;
              }[];
            };
            diagnostics: VerifyDbDiagnostic[];
          }[]
        >;
      }
    ): Promise<void>;
  };
};

export type MutationDiagnostic = {
  severity: string;
  code: string;
  message: string;
  path?: string;
  fix?: string;
};

export type MutationPool = {
  query(sql: string): Promise<void>;
  end(): Promise<void>;
};

export type ModuleDataDbMutationModule = {
  createModuleDataDbMutationRunner(input: {
    createPgPool(databaseUrl: string): Promise<MutationPool>;
    diagnostic(
      severity: string,
      code: string,
      message: string,
      path?: string,
      fix?: string
    ): MutationDiagnostic;
    readMigrationSql(file: string): string;
  }): {
    applyMigrationEntries(
      databaseUrl: string,
      entries: {
        moduleId: string;
        schemaHash: string;
        projectPath: string;
        migrationFile: string;
      }[],
      diagnostics: MutationDiagnostic[]
    ): Promise<{ moduleId: string; schemaHash: string; path: string }[]>;
    applyResetPlans(
      databaseUrl: string,
      resetPlans: { moduleId: string; sql: string }[],
      diagnostics: MutationDiagnostic[]
    ): Promise<{ moduleId: string }[]>;
    pushMigrateDatabaseUrlRequired(diagnostics: MutationDiagnostic[]): void;
    pushResetDatabaseUrlRequired(diagnostics: MutationDiagnostic[]): void;
  };
};

export type StaticDiagnostic = {
  severity: string;
  code: string;
  message: string;
};

export type StaticPlan = {
  moduleId: string;
  moduleRoot: string;
  migrations: { mode: string };
};

export type ModuleDataStaticCommandsModule = {
  createModuleDataStaticCommands(input: {
    artifacts: {
      moduleMigrationFile(moduleRoot: string, plan: StaticPlan): string;
      modulePlanContent(plan: StaticPlan): string;
      modulePlanFile(moduleRoot: string): string;
      moduleOpenApiFile(moduleRoot: string): string;
      moduleTypesFile(moduleRoot: string): string;
      verifyGeneratedArtifacts(
        results: { plan?: StaticPlan; diagnostics: StaticDiagnostic[] }[],
        diagnostics: StaticDiagnostic[]
      ): void;
      writeIfChanged(file: string, content: string): boolean;
    };
    buildPlans(options: { values: Map<string, string>; flags: Set<string> }): Promise<
      {
        plan?: StaticPlan;
        diagnostics: StaticDiagnostic[];
      }[]
    >;
    generateMigrationSql(plan: StaticPlan): string;
    generateOpenApi(plan: StaticPlan): string;
    generateTypes(plan: StaticPlan): string;
    parseCommandArgs(args: string[]): { values: Map<string, string>; flags: Set<string> };
    printJson(value: unknown): void;
    projectRoot: string;
    toProjectPath(file: string): string;
  }): {
    commandGenerate(args: string[]): Promise<void>;
    commandPlan(args: string[]): Promise<void>;
    commandTypes(args: string[]): Promise<void>;
    commandVerify(args: string[]): Promise<void>;
  };
};

export type ModuleDataResetSqlModule = {
  generateResetSql(modulePlan: { moduleId: string; tables: { physicalName: string }[] }): string;
};

export type ModuleDataCliRunnerDiagnostic = {
  severity: string;
  code: string;
  message: string;
};

export type ModuleDataCliRunnerModule = {
  runModuleDataCliCommand(input: {
    argv: string[];
    commands: Record<string, (args: string[]) => Promise<void> | void>;
    createErrorDiagnostic(error: unknown): ModuleDataCliRunnerDiagnostic;
    onFinally?(): Promise<void> | void;
    printJson(value: unknown): void;
    printUsage?(usage: string): void;
    usage?: string;
  }): Promise<void>;
};

export type ModuleDataTypesModule = {
  documentFieldTs(field: { type: string; required?: boolean }): string;
  generateTypes(
    modulePlan: {
      moduleId: string;
      documents: {
        name: string;
        fields: Record<string, { type: string; required?: boolean }>;
      }[];
      tables: {
        name: string;
        columns: Record<string, { kind: string; nullable?: boolean }>;
      }[];
    },
    input?: { standardColumns?: { name: string; ts: string }[] }
  ): string;
  tableColumnTs(column: { kind: string; nullable?: boolean }): string;
  tsIdentifier(value: string, suffix?: string): string;
};

export type PlanDiagnostic = {
  severity: string;
  code: string;
  message: string;
  path?: string;
  fix?: string;
  details?: unknown;
};

export type ModuleDataPlanModule = {
  STANDARD_COLUMNS: { name: string; sql: string; ts: string }[];
  createModuleDataPlanHelpers(input: {
    diagnostic(
      severity: string,
      code: string,
      message: string,
      path?: string,
      fix?: string,
      details?: unknown
    ): PlanDiagnostic;
    toProjectPath(file: string): string;
  }): {
    createModuleDataPlan(
      moduleRoot: string,
      moduleId: string,
      data: Record<string, unknown>
    ): {
      diagnostics: PlanDiagnostic[];
      plan: {
        moduleId: string;
        moduleRoot: string;
        schemaHash: string;
        documents: { name: string; scope: string; fields: Record<string, unknown> }[];
        tables: {
          name: string;
          physicalName: string;
          scope: string;
          columns: Record<string, unknown>;
          unique: string[][];
          indexes: string[][];
          relations?: Record<string, unknown>;
        }[];
        views: { name: string; definition: Record<string, unknown> }[];
        grants: { name: string; definition: Record<string, unknown> }[];
        checks: { name: string; definition: Record<string, unknown> }[];
        migrations: { mode: string; dir: string; owns?: string[] };
      };
    };
  };
  moduleDataPhysicalTableName(moduleId: string, tableName: string): string;
  normalizeColumn(column: Record<string, unknown>): Record<string, unknown>;
  normalizeDocumentField(field: string | Record<string, unknown>): Record<string, unknown>;
  normalizeTables(data: Record<string, unknown>, moduleId: string): { physicalName: string }[];
  stableHash(value: unknown): string;
};

export type ModuleDataDryRunModule = {
  createMigrationDryRunPayload(
    entries: {
      moduleId: string;
      schemaHash: string;
      projectPath: string;
      bytes: number;
    }[],
    diagnostics: { severity: string; code: string; message: string }[]
  ): {
    success: boolean;
    mode: string;
    migrations: {
      moduleId: string;
      schemaHash: string;
      path: string;
      bytes: number;
    }[];
    diagnostics: { severity: string; code: string; message: string }[];
  };
  createResetDryRunPayload(
    resetPlans: { moduleId: string; sql: string }[],
    diagnostics: { severity: string; code: string; message: string }[]
  ): {
    success: boolean;
    mode: string;
    resetPlans: { moduleId: string; sql: string }[];
    diagnostics: { severity: string; code: string; message: string }[];
    next: string;
  };
};

export type ModuleDataLoaderModule = {
  createModuleDataLoader(input: {
    diagnostic(
      severity: string,
      code: string,
      message: string,
      path?: string,
      fix?: string
    ): PlanDiagnostic;
    importModule(url: string, parentUrl?: string): Promise<unknown>;
    parentUrl?: string;
    toProjectPath(file: string): string;
  }): {
    loadModuleDefinition(moduleRoot: string): Promise<
      | { ok: true; definition: Record<string, unknown> }
      | {
          ok: false;
          result: {
            moduleRoot: string;
            moduleId: string;
            hasData: false;
            diagnostics: PlanDiagnostic[];
            plan: null;
          };
        }
    >;
    readModuleDefinition(moduleRoot: string): Promise<Record<string, unknown>>;
  };
  moduleDefinitionUrl(moduleRoot: string): string;
  readDefaultExport(value: unknown): unknown;
};

export type ModuleDataApplyCommandsModule = {
  createModuleDataApplyCommands(input: {
    artifacts: {
      collectMigrationEntries(
        results: { plan?: StaticPlan; diagnostics: StaticDiagnostic[] }[],
        diagnostics: StaticDiagnostic[]
      ): {
        moduleId: string;
        schemaHash: string;
        projectPath: string;
        bytes?: number;
        migrationFile?: string;
      }[];
    };
    buildPlans(options: { values: Map<string, string>; flags: Set<string> }): Promise<
      {
        plan?: StaticPlan & { tables?: { physicalName: string }[] };
        diagnostics: StaticDiagnostic[];
      }[]
    >;
    createMigrationDryRunPayload(
      entries: unknown[],
      diagnostics: StaticDiagnostic[]
    ): { success: boolean; diagnostics: StaticDiagnostic[]; mode: string; migrations: unknown[] };
    createResetDryRunPayload(
      resetPlans: { moduleId: string; sql: string }[],
      diagnostics: StaticDiagnostic[]
    ): {
      success: boolean;
      diagnostics: StaticDiagnostic[];
      mode: string;
      resetPlans: { moduleId: string; sql: string }[];
    };
    databaseUrlFromOptions(options: { values: Map<string, string> }): string;
    dbMutations: {
      applyMigrationEntries(
        databaseUrl: string,
        entries: unknown[],
        diagnostics: StaticDiagnostic[]
      ): Promise<{ moduleId: string; schemaHash: string; path: string }[]>;
      applyResetPlans(
        databaseUrl: string,
        resetPlans: { moduleId: string; sql: string }[],
        diagnostics: StaticDiagnostic[]
      ): Promise<{ moduleId: string }[]>;
      hasErrors(diagnostics: StaticDiagnostic[]): boolean;
      pushMigrateDatabaseUrlRequired(diagnostics: StaticDiagnostic[]): void;
      pushResetDatabaseUrlRequired(diagnostics: StaticDiagnostic[]): void;
    };
    generateResetSql(plan: { moduleId: string }): string;
    parseCommandArgs(args: string[]): { values: Map<string, string>; flags: Set<string> };
    printJson(value: unknown): void;
  }): {
    commandMigrate(args: string[]): Promise<void>;
    commandReset(args: string[]): Promise<void>;
    loadApplyContext(args: string[]): Promise<{
      diagnostics: StaticDiagnostic[];
      options: { values: Map<string, string>; flags: Set<string> };
      results: { plan?: StaticPlan; diagnostics: StaticDiagnostic[] }[];
    }>;
  };
};

export type ModuleDataPathsModule = {
  resolveModuleLocalPath(moduleRoot: string, localPath: string): string;
};

export type ModuleDataArgsModule = {
  parseCommandArgs(args: string[]): {
    targetPath?: string;
    moduleFilter: Set<string>;
    flags: Set<string>;
    values: Map<string, string>;
  };
};

export type ModuleDataCommandDependenciesModule = {
  createModuleDataCommandDependencies(input: {
    diagnostic(
      severity: string,
      code: string,
      message: string,
      path?: string,
      fix?: string,
      details?: unknown
    ): PlanDiagnostic;
    importModule(url: string, parentUrl?: string): Promise<unknown>;
    parentUrl?: string;
    printJson(value: unknown): void;
    projectRoot?: string;
  }): {
    buildPlans(options: {
      targetPath?: string;
      moduleFilter: Set<string>;
      flags: Set<string>;
      values: Map<string, string>;
    }): Promise<
      {
        plan?: {
          moduleId: string;
          moduleRoot: string;
          tables: unknown[];
          documents: unknown[];
        } | null;
        diagnostics: PlanDiagnostic[];
        moduleId: string;
      }[]
    >;
    commands: Record<string, (args: string[]) => Promise<void> | void>;
    parseCommandArgs(args: string[]): {
      targetPath?: string;
      moduleFilter: Set<string>;
      flags: Set<string>;
      values: Map<string, string>;
    };
    toProjectPath(file: string): string;
  };
};

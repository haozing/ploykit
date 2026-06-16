import fs from 'node:fs';
import path from 'node:path';
import { validateModuleDefinition, type ModuleDiagnostic } from '@ploykit/module-sdk';
import { diagnoseModuleCatalog } from '@/lib/module-runtime/catalog';
import {
  createDeveloperPlatformReport,
  type DeveloperPlatformReport,
} from '@/lib/module-runtime/dev-console/developer-platform';
import {
  createModuleDevConsoleSnapshot,
  type ModuleDevConsoleSnapshot,
} from '@/lib/module-runtime/dev-console/dev-console';
import type { ModuleMapArtifact } from '@/lib/module-runtime/loader/module-map-types';
import {
  createModuleBundleManifest,
  type ModuleBundleManifest,
} from '@/lib/module-runtime/packaging/module-bundle';
import { MODULE_MAP_ARTIFACT } from '@/lib/module-map';
import { ensureAdminStoreSeeded } from './admin-store-seed';
import { getHostRuntime } from './create-host';
import { DEFAULT_HOST_PRODUCT_ID } from './default-scope';

export interface AdminModuleTestReport {
  moduleId: string;
  moduleRoot: string;
  success: boolean;
  mode: string;
  checkedAt: string;
  reportFile: string;
  steps: {
    name: string;
    ok: boolean;
    command: string;
    files?: string[];
  }[];
}

export interface AdminModuleDevEnvironmentView {
  currentEnvironment: string;
  nodeEnvironment: string;
  targetEnvironment: string;
  moduleMapKind: ModuleMapArtifact['kind'];
  moduleMapGeneratedAt: string | null;
  moduleMapBuildId: string | null;
}

export interface AdminModuleDevConsoleView {
  snapshot: ModuleDevConsoleSnapshot;
  report: DeveloperPlatformReport;
  bundle: ModuleBundleManifest;
  environment: AdminModuleDevEnvironmentView;
  diagnosticsByModule: Record<string, readonly ModuleDiagnostic[]>;
  testReports: AdminModuleTestReport[];
}

function addDiagnostic(
  target: Record<string, ModuleDiagnostic[]>,
  moduleId: string,
  diagnostic: ModuleDiagnostic
) {
  target[moduleId] ??= [];
  target[moduleId].push(diagnostic);
}

function readModuleTestReports(): AdminModuleTestReport[] {
  const reportsDir = path.join(process.cwd(), '.runtime', 'module-test-reports');
  if (!fs.existsSync(reportsDir)) {
    return [];
  }

  return fs
    .readdirSync(reportsDir)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => {
      const reportFile = path.join(reportsDir, entry);
      const parsed = JSON.parse(fs.readFileSync(reportFile, 'utf8')) as Omit<
        AdminModuleTestReport,
        'moduleId'
      > & { moduleId?: string };
      return {
        moduleId: parsed.moduleId ?? path.basename(entry, '.json'),
        moduleRoot: parsed.moduleRoot,
        success: Boolean(parsed.success),
        mode: parsed.mode,
        checkedAt: parsed.checkedAt,
        reportFile: parsed.reportFile ?? reportFile,
        steps: parsed.steps ?? [],
      };
    })
    .sort((left, right) => left.moduleId.localeCompare(right.moduleId));
}

export async function getAdminModuleDevConsoleView(): Promise<AdminModuleDevConsoleView> {
  const hostRuntime = await getHostRuntime();
  await ensureAdminStoreSeeded(
    hostRuntime.runtimeStore.store,
    hostRuntime.moduleHost.runtime.contracts.map((contract) => contract.id)
  );
  const catalogStates = await hostRuntime.runtimeStore.store.listCatalogStates({
    productId: DEFAULT_HOST_PRODUCT_ID,
  });
  const diagnosticsByModule: Record<string, ModuleDiagnostic[]> = {};

  for (const contract of hostRuntime.moduleHost.runtime.contracts) {
    for (const diagnostic of validateModuleDefinition(contract.definition)) {
      addDiagnostic(diagnosticsByModule, contract.id, diagnostic);
    }
  }

  for (const diagnostic of diagnoseModuleCatalog({
    artifact: MODULE_MAP_ARTIFACT,
    contracts: hostRuntime.moduleHost.runtime.contracts,
    moduleStates: catalogStates,
  })) {
    const matched =
      hostRuntime.moduleHost.runtime.contracts.find(
        (contract) =>
          diagnostic.message.includes(contract.id) || (diagnostic.path ?? '').includes(contract.id)
      )?.id ?? '__catalog__';
    addDiagnostic(diagnosticsByModule, matched, diagnostic);
  }

  const snapshot = createModuleDevConsoleSnapshot({
    artifact: MODULE_MAP_ARTIFACT,
    contracts: hostRuntime.moduleHost.runtime.contracts,
    diagnosticsByModule,
  });
  const report = createDeveloperPlatformReport({
    snapshot,
    diagnosticsByModule,
  });
  const bundle = createModuleBundleManifest({
    artifact: MODULE_MAP_ARTIFACT,
    contracts: hostRuntime.moduleHost.runtime.contracts,
  });

  return {
    snapshot,
    report,
    bundle,
    environment: {
      currentEnvironment: process.env.PLOYKIT_ENV ?? process.env.NODE_ENV ?? 'development',
      nodeEnvironment: process.env.NODE_ENV ?? 'development',
      targetEnvironment: process.env.PLOYKIT_TARGET_ENV ?? 'production',
      moduleMapKind: MODULE_MAP_ARTIFACT.kind,
      moduleMapGeneratedAt: MODULE_MAP_ARTIFACT.generatedAt ?? null,
      moduleMapBuildId: MODULE_MAP_ARTIFACT.buildId ?? null,
    },
    diagnosticsByModule,
    testReports: readModuleTestReports(),
  };
}

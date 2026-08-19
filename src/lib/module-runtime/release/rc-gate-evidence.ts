import fs from 'node:fs';
import path from 'node:path';

import type {
  CommercialDomainEvidence,
  ModuleTestReport,
  ProductPresentationManifest,
  ProviderInvocationEvidence,
  ProviderMatrixReport,
  RuntimeEvidenceReport,
  RuntimeStorePostgresReport,
  WorkerSoakReport,
} from './rc-gate-types';

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function numberFromRecord(record: Record<string, unknown> | undefined, key: string): number {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function booleanFromRecord(record: Record<string, unknown> | undefined, key: string): boolean {
  return record?.[key] === true;
}

export function commercialDomainEvidenceFromReport(
  report: RuntimeEvidenceReport | undefined
): CommercialDomainEvidence | undefined {
  const direct = asRecord(report?.domainEvidence?.commercialDomain);
  if (direct) {
    return {
      orders: numberFromRecord(direct, 'orders'),
      paidOrders: numberFromRecord(direct, 'paidOrders'),
      invoices: numberFromRecord(direct, 'invoices'),
      subscriptions: numberFromRecord(direct, 'subscriptions'),
      catalogItems: numberFromRecord(direct, 'catalogItems'),
      billingAccount: booleanFromRecord(direct, 'billingAccount'),
      revenueBuckets: numberFromRecord(direct, 'revenueBuckets'),
    };
  }

  const checks = report?.checks ?? [];
  for (const check of checks) {
    const detail = asRecord((check as { detail?: unknown }).detail);
    const nested =
      asRecord(detail?.commercialDomain) ??
      asRecord(asRecord(detail?.domainEvidence)?.commercialDomain);
    if (nested) {
      return {
        orders: numberFromRecord(nested, 'orders'),
        paidOrders: numberFromRecord(nested, 'paidOrders'),
        invoices: numberFromRecord(nested, 'invoices'),
        subscriptions: numberFromRecord(nested, 'subscriptions'),
        catalogItems: numberFromRecord(nested, 'catalogItems'),
        billingAccount: booleanFromRecord(nested, 'billingAccount'),
        revenueBuckets: numberFromRecord(nested, 'revenueBuckets'),
      };
    }
  }
  return undefined;
}

export function providerInvocationEvidenceFromReport(
  report: RuntimeEvidenceReport | ProviderMatrixReport | undefined
): ProviderInvocationEvidence | undefined {
  const direct = asRecord(
    (report as RuntimeEvidenceReport | undefined)?.domainEvidence
  )?.providerInvocationLedger;
  const directRecord = asRecord(direct);
  if (directRecord) {
    const operations = directRecord.operations;
    return {
      invocations: numberFromRecord(directRecord, 'invocations'),
      successful: numberFromRecord(directRecord, 'successful'),
      failed: numberFromRecord(directRecord, 'failed'),
      operations: Array.isArray(operations) ? operations.map(String) : [],
      kinds: Array.isArray(directRecord.kinds) ? directRecord.kinds.map(String) : [],
      ragSources: numberFromRecord(directRecord, 'ragSources'),
      ragChunks: numberFromRecord(directRecord, 'ragChunks'),
      connectorInvocations: numberFromRecord(directRecord, 'connectorInvocations'),
    };
  }

  const checks = report?.checks ?? [];
  for (const check of checks) {
    const detail = asRecord((check as { detail?: unknown }).detail);
    const nested =
      asRecord(detail?.providerInvocationLedger) ??
      asRecord(asRecord(detail?.domainEvidence)?.providerInvocationLedger);
    if (nested) {
      const operations = nested.operations;
      return {
        invocations: numberFromRecord(nested, 'invocations'),
        successful: numberFromRecord(nested, 'successful'),
        failed: numberFromRecord(nested, 'failed'),
        operations: Array.isArray(operations) ? operations.map(String) : [],
        kinds: Array.isArray(nested.kinds) ? nested.kinds.map(String) : [],
        ragSources: numberFromRecord(nested, 'ragSources'),
        ragChunks: numberFromRecord(nested, 'ragChunks'),
        connectorInvocations: numberFromRecord(nested, 'connectorInvocations'),
      };
    }
  }
  return undefined;
}

export function readProviderMatrixReport(projectRoot: string): {
  report?: ProviderMatrixReport;
  path: string;
  error?: string;
} {
  const reportPath = path.join(projectRoot, '.runtime', 'provider-matrix', 'latest.json');
  if (!fs.existsSync(reportPath)) {
    return { path: reportPath, error: 'Provider matrix evidence is missing.' };
  }
  try {
    return {
      path: reportPath,
      report: JSON.parse(fs.readFileSync(reportPath, 'utf8')) as ProviderMatrixReport,
    };
  } catch (error) {
    return {
      path: reportPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function readWorkerSoakReport(projectRoot: string): {
  report?: WorkerSoakReport;
  path: string;
  error?: string;
} {
  const reportPath = path.join(projectRoot, '.runtime', 'worker-soak', 'latest.json');
  if (!fs.existsSync(reportPath)) {
    return { path: reportPath, error: 'Worker soak evidence is missing.' };
  }
  try {
    return {
      path: reportPath,
      report: JSON.parse(fs.readFileSync(reportPath, 'utf8')) as WorkerSoakReport,
    };
  } catch (error) {
    return {
      path: reportPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function readRuntimeStorePostgresReport(projectRoot: string): {
  report?: RuntimeStorePostgresReport;
  path: string;
  error?: string;
} {
  const reportPath = path.join(projectRoot, '.runtime', 'runtime-store-postgres', 'latest.json');
  if (!fs.existsSync(reportPath)) {
    return { path: reportPath, error: 'Runtime store Postgres evidence is missing.' };
  }
  try {
    return {
      path: reportPath,
      report: JSON.parse(fs.readFileSync(reportPath, 'utf8')) as RuntimeStorePostgresReport,
    };
  } catch (error) {
    return {
      path: reportPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function readRuntimeEvidenceReport(
  projectRoot: string,
  runtimeDir: string
): {
  report?: RuntimeEvidenceReport;
  path: string;
  error?: string;
} {
  const reportPath = path.join(projectRoot, '.runtime', runtimeDir, 'latest.json');
  if (!fs.existsSync(reportPath)) {
    return { path: reportPath, error: `${runtimeDir} evidence is missing.` };
  }
  try {
    return {
      path: reportPath,
      report: JSON.parse(fs.readFileSync(reportPath, 'utf8')) as RuntimeEvidenceReport,
    };
  } catch (error) {
    return {
      path: reportPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function readProductPresentationManifest(projectRoot: string): {
  manifest?: ProductPresentationManifest;
  path: string;
  error?: string;
} {
  const reportPath = [
    path.join(projectRoot, '.ploykit', 'generated', 'product-presentation.manifest.json'),
    path.join(projectRoot, '.runtime', 'product-presentation-manifest.json'),
  ].find((candidate) => fs.existsSync(candidate));
  if (!reportPath) {
    return {
      path: path.join(projectRoot, '.ploykit', 'generated', 'product-presentation.manifest.json'),
      error: 'Product Presentation manifest is missing.',
    };
  }
  try {
    return {
      path: reportPath,
      manifest: JSON.parse(fs.readFileSync(reportPath, 'utf8')) as ProductPresentationManifest,
    };
  } catch (error) {
    return {
      path: reportPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function readModuleTestReports(projectRoot: string): {
  reports: { moduleId: string; path: string; report?: ModuleTestReport; error?: string }[];
  missing: string[];
} {
  const modulesRoot = path.join(projectRoot, 'modules');
  const reportsRoot = path.join(projectRoot, '.runtime', 'module-test-reports');
  const moduleIds = fs.existsSync(modulesRoot)
    ? fs
        .readdirSync(modulesRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    : [];
  const reports = moduleIds.map((moduleId) => {
    const reportPath = path.join(reportsRoot, `${moduleId}.json`);
    if (!fs.existsSync(reportPath)) {
      return { moduleId, path: reportPath, error: 'Module test report is missing.' };
    }
    try {
      return {
        moduleId,
        path: reportPath,
        report: JSON.parse(fs.readFileSync(reportPath, 'utf8')) as ModuleTestReport,
      };
    } catch (error) {
      return {
        moduleId,
        path: reportPath,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
  return {
    reports,
    missing: reports
      .filter((item) => !item.report || item.report.success !== true)
      .map((item) => item.moduleId),
  };
}

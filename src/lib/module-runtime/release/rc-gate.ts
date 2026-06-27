import fs from 'node:fs';
import path from 'node:path';

import {
  collectReleaseCandidateScan,
  DEFAULT_RELEASE_CANDIDATE_SCAN_TARGETS,
} from './rc-gate-legacy-scan';
import {
  asRecord,
  collectModuleDashboardTransitionRequirements,
  collectModuleQualityEvidenceRequirements,
  collectModuleQualityRouteRequirements,
  commercialDomainEvidenceFromReport,
  dashboardTransitionRoutePath,
  missingModuleQualityRouteChecks,
  missingDashboardTransitionRoutes,
  providerInvocationEvidenceFromReport,
  readModuleTestReports,
  readProductPresentationManifest,
  readProviderMatrixReport,
  readRuntimeEvidenceReport,
  readRuntimeStorePostgresReport,
  readWorkerSoakReport,
} from './rc-gate-evidence';
import type {
  DriftCheckReport,
  FilesCleanupReport,
  FilesReconcileReport,
  ModuleDashboardTransitionRequirement,
  ReleaseCandidateCheck,
  ReleaseCandidateCheckStatus,
  ReleaseCandidateDiagnostic,
  ReleaseCandidateGateProfile,
  ReleaseCandidateGateResult,
  ResolvedCheckEvidence,
  RunReleaseCandidateGateInput,
  RuntimeEvidenceReport,
} from './rc-gate-types';

export type {
  ReleaseCandidateCheck,
  ReleaseCandidateCheckStatus,
  ReleaseCandidateDiagnostic,
  ReleaseCandidateGateProfile,
  ReleaseCandidateGateResult,
  RunReleaseCandidateGateInput,
} from './rc-gate-types';

const REQUIRED_CHECKS: readonly Omit<ReleaseCandidateCheck, 'status' | 'evidence'>[] = [
  {
    id: 'module-contract',
    title: 'Module contract, module map, doctor, and templates use module-first APIs.',
    required: true,
  },
  {
    id: 'web-shell',
    title: 'Web Shell loads modules through the current module host without removed runtime dependencies.',
    required: true,
  },
  {
    id: 'host-product-smoke',
    title: 'Product host smoke covers site, auth, dashboard, admin, and public tools.',
    required: true,
  },
  {
    id: 'dashboard-transition-smoke',
    title:
      'Dashboard transition smoke proves hydrated route changes avoid document navigation regressions.',
    required: true,
  },
  {
    id: 'runtime-stores',
    title: 'Runtime stores and governed module data pass the Postgres verification loop.',
    required: true,
  },
  {
    id: 'production-adapters',
    title: 'Billing, files, jobs, webhooks, and provider adapters have production-grade tests.',
    required: true,
  },
  {
    id: 'security-operations',
    title: 'Security matrix, runtime checks, and operational diagnostics pass.',
    required: true,
  },
  {
    id: 'demo-products',
    title:
      'Demo products start from a clean checkout and cover public routes, jobs, billing, files, and AI.',
    required: true,
  },
  {
    id: 'provider-live-matrix',
    title:
      'S3-compatible storage, Stripe, Email, and AI/RAG provider smoke matrix has current evidence.',
    required: true,
  },
  {
    id: 'worker-soak',
    title: 'Worker soak evidence proves queue drain, heartbeat, and dead-letter status.',
    required: true,
  },
  {
    id: 'delivery-ledger',
    title:
      'Delivery ledger and worker registry record worker, job, webhook, event, and email delivery evidence.',
    required: true,
  },
  {
    id: 'browser-matrix',
    title:
      'Desktop/mobile browser matrix covers site, auth, dashboard, admin, demo, files, billing, and declared module routes.',
    required: true,
  },
  {
    id: 'accessibility-smoke',
    title:
      'Accessibility smoke covers named controls, headings, overflow, console errors, and declared module routes.',
    required: true,
  },
  {
    id: 'module-quality',
    title: 'Module-declared quality evidence passes without host-specific module exceptions.',
    required: true,
  },
  {
    id: 'product-presentation-kernel',
    title:
      'Product Presentation manifest proves typed product config, clean i18n paths, and theme token readiness.',
    required: true,
  },
  {
    id: 'white-label-presentation',
    title:
      'White-label presentation smoke covers public pages, auth, workspace theme, admin boundary, and hreflang.',
    required: true,
  },
  {
    id: 'data-safety-matrix',
    title:
      'Auth secrets, store durability, route security, files, worker, and removed-entry scans are checked.',
    required: true,
  },
  {
    id: 'drift-check-matrix',
    title: 'Unified drift check covers module map, catalog, runtime, data, files, and providers.',
    required: true,
  },
  {
    id: 'backup-restore-matrix',
    title: 'Runtime store backup/restore semantic snapshot evidence passes.',
    required: true,
  },
  {
    id: 'postgres-physical-restore-matrix',
    title: 'Postgres physical pg_dump/pg_restore evidence restores runtime store data.',
    required: true,
  },
  {
    id: 'upgrade-migration-matrix',
    title:
      'Runtime store upgrade migrations are ordered, covered, idempotent, and non-destructive.',
    required: true,
  },
  {
    id: 'chaos-matrix',
    title:
      'Queue chaos evidence covers concurrency, backoff, lease reclaim, and dead-letter replay.',
    required: true,
  },
  {
    id: 'commercial-domain',
    title:
      'Commercial domain evidence records catalog, billing account, invoices, subscriptions, and revenue buckets.',
    required: true,
  },
  {
    id: 'files-storage-domain',
    title: 'Files cleanup and reconcile evidence proves metadata/object-store consistency checks.',
    required: true,
  },
  {
    id: 'provider-invocation-ledger',
    title:
      'Provider invocation ledger records AI/RAG/connectors with operation, status, usage, cost, and latency.',
    required: true,
  },
  {
    id: 'ai-rag-policy',
    title:
      'AI/RAG policy evidence proves budget guards, quota accounting, and anonymous route fail-closed behavior.',
    required: true,
  },
  {
    id: 'documentation',
    title:
      'Quickstart, deployment, module authoring, operations, security, upgrade policy, and checklist are present.',
    required: true,
  },
];

const PROFILE_REQUIRED_CHECKS: Record<ReleaseCandidateGateProfile, readonly string[]> = {
  local: ['module-contract', 'web-shell', 'security-operations', 'demo-products', 'documentation'],
  integration: [
    'module-contract',
    'web-shell',
    'host-product-smoke',
    'dashboard-transition-smoke',
    'runtime-stores',
    'production-adapters',
    'security-operations',
    'demo-products',
    'browser-matrix',
    'accessibility-smoke',
    'module-quality',
    'product-presentation-kernel',
    'white-label-presentation',
    'documentation',
  ],
  maintainer: REQUIRED_CHECKS.map((check) => check.id),
};

function normalizeCheckStatus(
  value: ReleaseCandidateCheckStatus | boolean | undefined
): ReleaseCandidateCheckStatus {
  if (value === true) {
    return 'passed';
  }
  if (value === false) {
    return 'failed';
  }
  return value ?? 'pending';
}

function resolveHostProductSmokeCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  if (requestedStatus === 'failed') {
    return {
      status: 'failed',
      evidence: 'Host product smoke was marked failed by the release gate caller.',
    };
  }
  const smoke = readRuntimeEvidenceReport(projectRoot, 'host-smoke');
  if (!smoke.report) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${smoke.error} Run npm run host:smoke. (${smoke.path})`,
    };
  }
  if (smoke.report.ok === true) {
    return {
      status: 'passed',
      evidence: `Host product smoke passed at ${smoke.report.checkedAt ?? 'unknown time'} with ${smoke.report.checks?.length ?? 0} checks against ${smoke.report.baseUrl ?? 'unknown base URL'}. (${smoke.path})`,
    };
  }
  const failedChecks = (smoke.report.checks ?? [])
    .filter((check) => check.ok === false)
    .map((check) => check.id ?? 'unknown');
  return {
    status: requestedStatus === 'passed' ? 'failed' : 'pending',
    evidence: `Host product smoke did not pass. Failed checks: ${failedChecks.join(', ') || 'unknown'}. (${smoke.path})`,
  };
}

function resolveBrowserMatrixCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  if (requestedStatus === 'failed') {
    return {
      status: 'failed',
      evidence: 'Browser matrix was marked failed by the release gate caller.',
    };
  }
  const matrix = readRuntimeEvidenceReport(projectRoot, 'browser-matrix');
  if (!matrix.report) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${matrix.error} Run npm run host:browser-matrix. (${matrix.path})`,
    };
  }
  if (requestedStatus === 'passed' && matrix.report.required !== true) {
    return {
      status: 'failed',
      evidence: `Browser matrix strict evidence must be generated with npm run host:browser-matrix -- --required. (${matrix.path})`,
    };
  }
  const moduleRoutes = collectModuleQualityRouteRequirements(projectRoot, 'browser');
  if (moduleRoutes.error) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${moduleRoutes.error} (${moduleRoutes.manifestPath})`,
    };
  }
  const missingModuleRoutes = missingModuleQualityRouteChecks(
    matrix.report,
    moduleRoutes.requirements
  );
  if (missingModuleRoutes.length > 0) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `Browser matrix is missing module-declared route evidence: ${missingModuleRoutes.join(', ')}. (${matrix.path}; declared in ${moduleRoutes.manifestPath})`,
    };
  }
  if (matrix.report.ok === true && matrix.report.skipped !== true) {
    return {
      status: 'passed',
      evidence: `Browser matrix passed at ${matrix.report.checkedAt ?? 'unknown time'} with ${matrix.report.checks?.length ?? 0} checks. (${matrix.path})`,
    };
  }
  return {
    status: requestedStatus === 'passed' ? 'failed' : 'pending',
    evidence: `Browser matrix did not pass or was skipped. (${matrix.path})`,
  };
}

function resolveAccessibilitySmokeCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  if (requestedStatus === 'failed') {
    return {
      status: 'failed',
      evidence: 'Accessibility smoke was marked failed by the release gate caller.',
    };
  }
  const smoke = readRuntimeEvidenceReport(projectRoot, 'accessibility-smoke');
  if (!smoke.report) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${smoke.error} Run npm run host:accessibility-smoke. (${smoke.path})`,
    };
  }
  if (requestedStatus === 'passed' && smoke.report.required !== true) {
    return {
      status: 'failed',
      evidence: `Accessibility smoke strict evidence must be generated with npm run host:accessibility-smoke -- --required. (${smoke.path})`,
    };
  }
  const moduleRoutes = collectModuleQualityRouteRequirements(projectRoot, 'accessibility');
  if (moduleRoutes.error) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${moduleRoutes.error} (${moduleRoutes.manifestPath})`,
    };
  }
  const missingModuleRoutes = missingModuleQualityRouteChecks(
    smoke.report,
    moduleRoutes.requirements
  );
  if (missingModuleRoutes.length > 0) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `Accessibility smoke is missing module-declared route evidence: ${missingModuleRoutes.join(', ')}. (${smoke.path}; declared in ${moduleRoutes.manifestPath})`,
    };
  }
  if (smoke.report.ok === true && smoke.report.skipped !== true) {
    return {
      status: 'passed',
      evidence: `Accessibility smoke passed at ${smoke.report.checkedAt ?? 'unknown time'} with ${smoke.report.checks?.length ?? 0} checks. (${smoke.path})`,
    };
  }
  const failedChecks = (smoke.report.checks ?? [])
    .filter((check) => check.ok === false)
    .map((check) => check.id ?? 'unknown');
  return {
    status: requestedStatus === 'passed' ? 'failed' : 'pending',
    evidence: `Accessibility smoke did not pass or was skipped. Failed checks: ${failedChecks.join(', ') || 'unknown'}. (${smoke.path})`,
  };
}

function dashboardTransitionCheckPassed(report: RuntimeEvidenceReport, checkId: string): boolean {
  return (report.checks ?? []).some((check) => check.id === checkId && check.ok === true);
}

function runtimeMetricNumber(metric: Record<string, unknown>, key: string): number | undefined {
  const value = metric[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function dashboardTransitionRouteMetrics(
  report: RuntimeEvidenceReport
): Map<string, Record<string, unknown>> {
  const summary = asRecord(report.summary);
  const metrics = Array.isArray(summary?.routeMetrics) ? summary.routeMetrics : [];
  return new Map(
    metrics.flatMap((item) => {
      const metric = asRecord(item);
      const route =
        typeof metric?.route === 'string' ? dashboardTransitionRoutePath(metric.route) : '';
      return metric && route ? [[route, metric] as const] : [];
    })
  );
}

function dashboardTransitionRouteBudgetFailures(
  report: RuntimeEvidenceReport,
  requirements: readonly ModuleDashboardTransitionRequirement[]
): string[] {
  const metrics = dashboardTransitionRouteMetrics(report);
  return requirements.flatMap((requirement) => {
    const route = dashboardTransitionRoutePath(requirement.route);
    const metric = metrics.get(route);
    if (!metric) {
      return [`routeMetrics missing for ${requirement.moduleId}:${route}`];
    }

    const failures: string[] = [];
    const maxDocumentNavigations = requirement.maxDocumentNavigations ?? 0;
    const maxHydrationErrors = requirement.maxHydrationErrors ?? 0;
    const documentNavigations = runtimeMetricNumber(metric, 'maxDocumentNavigations');
    const hydrationErrors = runtimeMetricNumber(metric, 'maxHydrationErrors');
    const p95Ms = runtimeMetricNumber(metric, 'p95Ms');
    const rscTransferP95Bytes = runtimeMetricNumber(metric, 'rscTransferP95Bytes');

    if ((documentNavigations ?? Number.POSITIVE_INFINITY) > maxDocumentNavigations) {
      failures.push(
        `${requirement.moduleId}:${route} maxDocumentNavigations=${documentNavigations ?? 'missing'} exceeded declared budget ${maxDocumentNavigations}`
      );
    }
    if ((hydrationErrors ?? Number.POSITIVE_INFINITY) > maxHydrationErrors) {
      failures.push(
        `${requirement.moduleId}:${route} maxHydrationErrors=${hydrationErrors ?? 'missing'} exceeded declared budget ${maxHydrationErrors}`
      );
    }
    if (
      requirement.maxP95Ms !== undefined &&
      (p95Ms ?? Number.POSITIVE_INFINITY) > requirement.maxP95Ms
    ) {
      failures.push(
        `${requirement.moduleId}:${route} p95Ms=${p95Ms ?? 'missing'} exceeded declared budget ${requirement.maxP95Ms}`
      );
    }
    if (
      requirement.maxRscTransferBytes !== undefined &&
      (rscTransferP95Bytes ?? Number.POSITIVE_INFINITY) > requirement.maxRscTransferBytes
    ) {
      failures.push(
        `${requirement.moduleId}:${route} rscTransferP95Bytes=${rscTransferP95Bytes ?? 'missing'} exceeded declared budget ${requirement.maxRscTransferBytes}`
      );
    }
    return failures;
  });
}

function resolveDashboardTransitionSmokeCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  if (requestedStatus === 'failed') {
    return {
      status: 'failed',
      evidence: 'Dashboard transition smoke was marked failed by the release gate caller.',
    };
  }

  const smoke = readRuntimeEvidenceReport(projectRoot, 'dashboard-transition-smoke');
  if (!smoke.report) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${smoke.error} Run npm run host:dashboard-transition-smoke. (${smoke.path})`,
    };
  }

  if (requestedStatus === 'passed' && smoke.report.required !== true) {
    return {
      status: 'failed',
      evidence: `Dashboard transition smoke strict evidence must be generated with npm run host:dashboard-transition-smoke -- --required --repeat 3 --inject-anchor. (${smoke.path})`,
    };
  }

  const summary = asRecord(smoke.report.summary);
  const repeat = typeof summary?.repeat === 'number' ? summary.repeat : undefined;
  const injectAnchor = summary?.injectAnchor === true;
  const transitions = typeof summary?.transitions === 'number' ? summary.transitions : undefined;
  const resetTransitions =
    typeof summary?.resetTransitions === 'number' ? summary.resetTransitions : undefined;
  const transitionDocumentNavigations =
    typeof summary?.transitionDocumentNavigations === 'number'
      ? summary.transitionDocumentNavigations
      : undefined;
  const hydrationErrors =
    typeof summary?.hydrationErrors === 'number' ? summary.hydrationErrors : undefined;
  const p95Ms = typeof summary?.p95Ms === 'number' ? summary.p95Ms : undefined;
  const rscTransferP95Bytes =
    typeof summary?.rscTransferP95Bytes === 'number' ? summary.rscTransferP95Bytes : undefined;
  const dashboardTimingReports =
    typeof summary?.dashboardTimingReports === 'number' ? summary.dashboardTimingReports : undefined;
  const appFramePresent = summary?.appFramePresent === true;
  const clientTransitionMarkerPresent = summary?.clientTransitionMarkerPresent === true;
  const injectedAnchorInAppFrame = !injectAnchor || summary?.injectedAnchorInAppFrame === true;
  const failedChecks = (smoke.report.checks ?? [])
    .filter((check) => check.ok === false)
    .map((check) => check.id ?? 'unknown');
  const declaredDashboardTransitions = collectModuleDashboardTransitionRequirements(projectRoot);
  const missingDeclaredDashboardRoutes = declaredDashboardTransitions.error
    ? []
    : missingDashboardTransitionRoutes(smoke.report, declaredDashboardTransitions.requirements);
  const declaredTransitionBudgetFailures = declaredDashboardTransitions.error
    ? []
    : dashboardTransitionRouteBudgetFailures(
        smoke.report,
        declaredDashboardTransitions.requirements
      );
  const missingSignals = [
    declaredDashboardTransitions.error
      ? `${declaredDashboardTransitions.error} (${declaredDashboardTransitions.manifestPath})`
      : undefined,
    smoke.report.ok === true ? undefined : 'report did not pass',
    smoke.report.skipped === true ? 'report was skipped' : undefined,
    (repeat ?? 0) >= 3 ? undefined : `repeat>=3 required, actual=${repeat ?? 'missing'}`,
    injectAnchor ? undefined : 'injectAnchor=true required',
    (transitions ?? 0) >= 3
      ? undefined
      : `at least 3 transitions required, actual=${transitions ?? 'missing'}`,
    (resetTransitions ?? 0) >= 2
      ? undefined
      : `at least 2 reset transitions required, actual=${resetTransitions ?? 'missing'}`,
    declaredTransitionBudgetFailures.length === 0
      ? undefined
      : `module dashboard transition budget failures: ${declaredTransitionBudgetFailures.join(', ')}`,
    appFramePresent ? undefined : 'appFramePresent=true required',
    clientTransitionMarkerPresent ? undefined : 'clientTransitionMarkerPresent=true required',
    injectedAnchorInAppFrame ? undefined : 'injectedAnchorInAppFrame=true required',
    dashboardTransitionCheckPassed(smoke.report, 'shell:app-frame')
      ? undefined
      : 'shell:app-frame check missing or failed',
    dashboardTransitionCheckPassed(smoke.report, 'shell:client-transition-marker')
      ? undefined
      : 'shell:client-transition-marker check missing or failed',
    !injectAnchor || dashboardTransitionCheckPassed(smoke.report, 'shell:injected-anchor-frame')
      ? undefined
      : 'shell:injected-anchor-frame check missing or failed',
    dashboardTransitionCheckPassed(smoke.report, 'transition:document-navigation')
      ? undefined
      : 'transition:document-navigation check missing or failed',
    dashboardTransitionCheckPassed(smoke.report, 'transition:hydration')
      ? undefined
      : 'transition:hydration check missing or failed',
    dashboardTransitionCheckPassed(smoke.report, 'transition:p95')
      ? undefined
      : 'transition:p95 check missing or failed',
    dashboardTransitionCheckPassed(smoke.report, 'transition:rsc-transfer')
      ? undefined
      : 'transition:rsc-transfer check missing or failed',
    dashboardTransitionCheckPassed(smoke.report, 'dashboard:timing-evidence')
      ? undefined
      : 'dashboard:timing-evidence check missing or failed',
    missingDeclaredDashboardRoutes.length === 0
      ? undefined
      : `missing module dashboard transition routes: ${missingDeclaredDashboardRoutes.join(', ')}`,
  ].filter(Boolean);

  if (missingSignals.length === 0) {
    return {
      status: 'passed',
      evidence: `Dashboard transition smoke passed at ${smoke.report.checkedAt ?? 'unknown time'} with repeat=${repeat}, injectAnchor=${injectAnchor}, appFramePresent=${appFramePresent}, clientTransitionMarkerPresent=${clientTransitionMarkerPresent}, injectedAnchorInAppFrame=${injectedAnchorInAppFrame}, transitions=${transitions}, resetTransitions=${resetTransitions}, transition document navigations=${transitionDocumentNavigations}, hydration errors=${hydrationErrors}, P95 ${p95Ms ?? 'unknown'}ms, RSC transfer P95 ${rscTransferP95Bytes ?? 'unknown'} bytes, and dashboard timing reports=${dashboardTimingReports ?? 'unknown'}. (${smoke.path})`,
    };
  }

  return {
    status: requestedStatus === 'passed' ? 'failed' : 'pending',
    evidence: `Dashboard transition smoke evidence is incomplete: ${missingSignals.join('; ')}. Failed checks: ${failedChecks.join(', ') || 'none'}. (${smoke.path})`,
  };
}

function resolveModuleQualityCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  if (requestedStatus === 'failed') {
    return {
      status: 'failed',
      evidence: 'Module quality was marked failed by the release gate caller.',
    };
  }

  const declared = collectModuleQualityEvidenceRequirements(projectRoot);
  if (declared.error) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${declared.error} (${declared.manifestPath})`,
    };
  }

  if (declared.requirements.length === 0) {
    return {
      status: 'passed',
      evidence: `No required module-declared quality evidence was found in ${declared.manifestPath}.`,
    };
  }

  const results = declared.requirements.map((requirement) => {
    const evidence = readRuntimeEvidenceReport(projectRoot, requirement.runtimeDir);
    if (!evidence.report) {
      return {
        requirement,
        status: requestedStatus === 'passed' ? 'failed' : 'pending',
        evidence: `${evidence.error} Run ${
          requirement.command?.script
            ? `npm run ${requirement.command.script}`
            : 'the declared module quality command'
        } -- --required. (${evidence.path})`,
      };
    }
    if (evidence.report.required !== true) {
      return {
        requirement,
        status: requestedStatus === 'passed' ? 'failed' : 'pending',
        evidence: `${requirement.id} strict evidence must be generated with --required. (${evidence.path})`,
      };
    }
    if (evidence.report.skipped === true) {
      return {
        requirement,
        status: requestedStatus === 'passed' ? 'failed' : 'pending',
        evidence: `${requirement.id} evidence was skipped. (${evidence.path})`,
      };
    }

    const passedIds = new Set(
      (evidence.report.checks ?? [])
        .filter((check) => check.ok === true)
        .map((check) => check.id)
        .filter((id): id is string => typeof id === 'string')
    );
    const missing = requirement.checks.filter((id) => !passedIds.has(id));
    if (missing.length > 0) {
      return {
        requirement,
        status: requestedStatus === 'passed' ? 'failed' : 'pending',
        evidence: `${requirement.id} is missing required checks: ${missing.join(', ')}. (${evidence.path})`,
      };
    }

    const failedChecks = (evidence.report.checks ?? [])
      .filter((check) => check.ok === false)
      .map((check) => check.id ?? 'unknown');
    if (evidence.report.ok === true) {
      return {
        requirement,
        status: 'passed' as const,
        evidence: `${requirement.id} passed at ${evidence.report.checkedAt ?? 'unknown time'} with ${evidence.report.checks?.length ?? 0} checks. (${evidence.path})`,
      };
    }

    return {
      requirement,
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${requirement.id} did not pass. Failed checks: ${failedChecks.join(', ') || 'unknown'}. (${evidence.path})`,
    };
  });

  const failed = results.filter((item) => item.status === 'failed');
  if (failed.length > 0) {
    return {
      status: 'failed',
      evidence: failed.map((item) => item.evidence).join(' '),
    };
  }
  const pending = results.filter((item) => item.status === 'pending');
  if (pending.length > 0) {
    return {
      status: 'pending',
      evidence: pending.map((item) => item.evidence).join(' '),
    };
  }

  return {
    status: 'passed',
    evidence: `Module quality evidence passed for ${results.length} required declaration(s): ${results
      .map((item) => `${item.requirement.moduleId}:${item.requirement.id}`)
      .join(', ')}.`,
  };
}

function resolveProductPresentationCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  if (requestedStatus === 'failed') {
    return {
      status: 'failed',
      evidence: 'Product Presentation manifest was marked failed by the release gate caller.',
    };
  }
  const manifest = readProductPresentationManifest(projectRoot);
  if (!manifest.manifest) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${manifest.error} Run npm run presentation:check. (${manifest.path})`,
    };
  }
  const errors = (manifest.manifest.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.severity === 'error'
  );
  if (errors.length > 0) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `Product Presentation manifest has ${errors.length} error diagnostics: ${errors
        .map((item) => item.code ?? item.path ?? 'unknown')
        .join(', ')}. (${manifest.path})`,
    };
  }
  if (manifest.manifest.kind !== 'ploykit.product-presentation.manifest') {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `Product Presentation manifest kind is invalid. (${manifest.path})`,
    };
  }
  return {
    status: 'passed',
    evidence: `Product Presentation manifest passed at ${manifest.manifest.checkedAt ?? 'unknown time'} for ${manifest.manifest.product?.id ?? 'unknown product'} with ${Object.keys(manifest.manifest.pages ?? {}).length} page overrides. (${manifest.path})`,
  };
}

function resolveWhiteLabelPresentationCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  if (requestedStatus === 'failed') {
    return {
      status: 'failed',
      evidence: 'White-label presentation smoke was marked failed by the release gate caller.',
    };
  }
  const smoke = readRuntimeEvidenceReport(projectRoot, 'white-label-smoke');
  if (!smoke.report) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${smoke.error} Run npm run white-label:smoke. (${smoke.path})`,
    };
  }
  if (requestedStatus === 'passed' && smoke.report.required !== true) {
    return {
      status: 'failed',
      evidence: `White-label smoke strict evidence must be generated with npm run white-label:smoke. (${smoke.path})`,
    };
  }
  if (smoke.report.ok === true) {
    return {
      status: 'passed',
      evidence: `White-label presentation smoke passed at ${smoke.report.checkedAt ?? 'unknown time'}. (${smoke.path})`,
    };
  }
  return {
    status: requestedStatus === 'passed' ? 'failed' : 'pending',
    evidence: `White-label presentation smoke did not pass. (${smoke.path})`,
  };
}

function resolveDataSafetyCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  if (requestedStatus === 'failed') {
    return {
      status: 'failed',
      evidence: 'Data safety matrix was marked failed by the release gate caller.',
    };
  }
  const safety = readRuntimeEvidenceReport(projectRoot, 'data-safety');
  if (!safety.report) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${safety.error} Run npm run host:data-safety. (${safety.path})`,
    };
  }
  if (requestedStatus === 'passed' && safety.report.required !== true) {
    return {
      status: 'failed',
      evidence: `Data safety strict evidence must be generated with npm run host:data-safety -- --required. (${safety.path})`,
    };
  }
  if (safety.report.ok === true) {
    return {
      status: 'passed',
      evidence: `Data safety matrix passed at ${safety.report.checkedAt ?? 'unknown time'} with ${safety.report.checks?.length ?? 0} checks. (${safety.path})`,
    };
  }
  const failedChecks = (safety.report.checks ?? [])
    .filter((check) => check.ok === false)
    .map((check) => check.id ?? 'unknown');
  return {
    status: requestedStatus === 'passed' ? 'failed' : 'pending',
    evidence: `Data safety matrix did not pass. Failed checks: ${failedChecks.join(', ') || 'unknown'}. (${safety.path})`,
  };
}

function resolveDriftCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  if (requestedStatus === 'failed') {
    return {
      status: 'failed',
      evidence: 'Unified drift evidence was marked failed by the release gate caller.',
    };
  }

  const drift = readRuntimeEvidenceReport(projectRoot, 'drift-check') as {
    report?: DriftCheckReport;
    path: string;
    error?: string;
  };
  if (!drift.report) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${drift.error} Run npm run drift:check. (${drift.path})`,
    };
  }

  if (requestedStatus === 'passed' && drift.report.required !== true) {
    return {
      status: 'failed',
      evidence: `Unified drift strict evidence must be generated with npm run drift:check -- --required. (${drift.path})`,
    };
  }

  const blockedFindings = (drift.report.findings ?? []).filter(
    (finding) => finding.blocking === true
  );
  if (drift.report.ok === true) {
    return {
      status: 'passed',
      evidence: `Unified drift check passed at ${drift.report.checkedAt ?? 'unknown time'} with ${drift.report.summary?.total ?? drift.report.findings?.length ?? 0} findings across ${drift.report.summary?.domains?.length ?? 0} domains. (${drift.path})`,
    };
  }

  return {
    status: requestedStatus === 'passed' ? 'failed' : 'pending',
    evidence: `Unified drift check did not pass. Blocking findings: ${
      blockedFindings.map((finding) => finding.id ?? finding.message ?? 'unknown').join(', ') ||
      'unknown'
    }. (${drift.path})`,
  };
}

function resolveRuntimeEvidenceCheck(input: {
  projectRoot: string;
  requestedStatus: ReleaseCandidateCheckStatus;
  runtimeDir: string;
  displayName: string;
  command: string;
  strictCommand: string;
  markedFailedEvidence: string;
  validate?: (report: RuntimeEvidenceReport) => { ok: boolean; detail?: string };
}): ResolvedCheckEvidence {
  if (input.requestedStatus === 'failed') {
    return {
      status: 'failed',
      evidence: input.markedFailedEvidence,
    };
  }

  const evidence = readRuntimeEvidenceReport(input.projectRoot, input.runtimeDir);
  if (!evidence.report) {
    return {
      status: input.requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${evidence.error} Run ${input.command}. (${evidence.path})`,
    };
  }

  if (input.requestedStatus === 'passed' && evidence.report.required !== true) {
    return {
      status: 'failed',
      evidence: `${input.displayName} strict evidence must be generated with ${input.strictCommand}. (${evidence.path})`,
    };
  }

  const failedChecks = (evidence.report.checks ?? [])
    .filter((check) => check.ok === false)
    .map((check) => check.id ?? 'unknown');
  const validation = input.validate?.(evidence.report);
  if (validation && !validation.ok) {
    return {
      status: input.requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${input.displayName} evidence is incomplete. ${validation.detail ?? 'Custom validation did not pass.'}. (${evidence.path})`,
    };
  }
  if (evidence.report.ok === true) {
    return {
      status: 'passed',
      evidence: `${input.displayName} passed at ${evidence.report.checkedAt ?? 'unknown time'} in ${evidence.report.mode ?? 'unknown'} mode with ${evidence.report.checks?.length ?? 0} checks${validation?.detail ? `; ${validation.detail}` : ''}. (${evidence.path})`,
    };
  }

  return {
    status: input.requestedStatus === 'passed' ? 'failed' : 'pending',
    evidence: `${input.displayName} did not pass. Failed checks: ${failedChecks.join(', ') || 'unknown'}. (${evidence.path})`,
  };
}

function resolveBackupRestoreCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  return resolveRuntimeEvidenceCheck({
    projectRoot,
    requestedStatus,
    runtimeDir: 'backup-restore',
    displayName: 'Backup/restore smoke',
    command: 'npm run host:backup-restore-smoke',
    strictCommand: 'npm run host:backup-restore-smoke -- --required',
    markedFailedEvidence: 'Backup/restore evidence was marked failed by the release gate caller.',
  });
}

function resolvePostgresPhysicalRestoreCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  return resolveRuntimeEvidenceCheck({
    projectRoot,
    requestedStatus,
    runtimeDir: 'postgres-physical-restore',
    displayName: 'Postgres physical restore smoke',
    command: 'npm run host:postgres-physical-restore-smoke',
    strictCommand: 'npm run host:postgres-physical-restore-smoke -- --required',
    markedFailedEvidence:
      'Postgres physical restore evidence was marked failed by the release gate caller.',
  });
}

function resolveUpgradeMigrationCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  return resolveRuntimeEvidenceCheck({
    projectRoot,
    requestedStatus,
    runtimeDir: 'upgrade-migration',
    displayName: 'Upgrade migration smoke',
    command: 'npm run host:upgrade-migration-smoke',
    strictCommand: 'npm run host:upgrade-migration-smoke -- --required',
    markedFailedEvidence:
      'Upgrade migration evidence was marked failed by the release gate caller.',
  });
}

function resolveChaosCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  if (requestedStatus === 'failed') {
    return {
      status: 'failed',
      evidence: 'Chaos evidence was marked failed by the release gate caller.',
    };
  }

  const chaos = readRuntimeEvidenceReport(projectRoot, 'chaos');
  if (!chaos.report) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${chaos.error} Run npm run host:chaos-smoke. (${chaos.path})`,
    };
  }

  if (requestedStatus === 'passed' && chaos.report.required !== true) {
    return {
      status: 'failed',
      evidence: `Chaos strict evidence must be generated with npm run host:chaos-smoke -- --required. (${chaos.path})`,
    };
  }

  const failedChecks = (chaos.report.checks ?? [])
    .filter((check) => check.ok === false)
    .map((check) => check.id ?? 'unknown');
  if (chaos.report.ok === true) {
    return {
      status: 'passed',
      evidence: `Chaos smoke passed at ${chaos.report.checkedAt ?? 'unknown time'} in ${chaos.report.mode ?? 'unknown'} mode with ${chaos.report.checks?.length ?? 0} checks. (${chaos.path})`,
    };
  }

  return {
    status: requestedStatus === 'passed' ? 'failed' : 'pending',
    evidence: `Chaos smoke did not pass. Failed checks: ${failedChecks.join(', ') || 'unknown'}. (${chaos.path})`,
  };
}

function resolveSecurityOperationsCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  const safety = resolveDataSafetyCheck(projectRoot, requestedStatus);
  if (safety.status !== 'passed') {
    return {
      status: safety.status,
      evidence: safety.evidence?.replace('Data safety matrix', 'Security operations'),
    };
  }
  return {
    status: 'passed',
    evidence: `Security operations passed through data-safety route security, config doctor, removed-entry scan, and redaction evidence. ${safety.evidence}`,
  };
}

function resolveWebShellCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  if (requestedStatus === 'failed') {
    return {
      status: 'failed',
      evidence: 'Web shell evidence was marked failed by the release gate caller.',
    };
  }
  const report = readRuntimeEvidenceReport(projectRoot, 'web-shell');
  if (!report.report) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${report.error} Run npm run host:web-shell-evidence. (${report.path})`,
    };
  }
  if (requestedStatus === 'passed' && report.report.required !== true) {
    return {
      status: 'failed',
      evidence: `Web shell strict evidence must be generated with npm run host:web-shell-evidence -- --required. (${report.path})`,
    };
  }
  if (report.report.ok === true) {
    return {
      status: 'passed',
      evidence: `Web shell evidence passed at ${report.report.checkedAt ?? 'unknown time'} with ${report.report.summary?.tests ?? 0} tests. (${report.path})`,
    };
  }
  return {
    status: requestedStatus === 'passed' ? 'failed' : 'pending',
    evidence: `Web shell evidence did not pass. (${report.path})`,
  };
}

function resolveProductionAdaptersCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  if (requestedStatus === 'failed') {
    return {
      status: 'failed',
      evidence: 'Production adapters were marked failed by the release gate caller.',
    };
  }

  const provider = resolveProviderMatrixCheck(projectRoot, requestedStatus);
  if (provider.status !== 'passed') {
    return {
      status: provider.status,
      evidence: provider.evidence?.replace('Provider matrix', 'Production adapters'),
    };
  }

  const runtime = resolveRuntimeStoresCheck(projectRoot, requestedStatus);
  if (runtime.status !== 'passed') {
    return {
      status: runtime.status,
      evidence: runtime.evidence?.replace('Runtime store Postgres smoke', 'Production adapters'),
    };
  }

  const worker = resolveWorkerSoakCheck(projectRoot, requestedStatus);
  if (worker.status !== 'passed') {
    return {
      status: worker.status,
      evidence: worker.evidence?.replace('Worker soak', 'Production adapters'),
    };
  }

  const delivery = resolveDeliveryLedgerCheck(projectRoot, requestedStatus);
  if (delivery.status !== 'passed') {
    return {
      status: delivery.status,
      evidence: delivery.evidence?.replace('Delivery ledger', 'Production adapters'),
    };
  }

  return {
    status: 'passed',
    evidence: `Production adapters passed with provider matrix, runtime store, worker soak, and delivery ledger evidence. ${provider.evidence} ${runtime.evidence} ${worker.evidence} ${delivery.evidence}`,
  };
}

function resolveModuleReportsCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus,
  label: string
): ResolvedCheckEvidence {
  if (requestedStatus === 'failed') {
    return {
      status: 'failed',
      evidence: `${label} was marked failed by the release gate caller.`,
    };
  }
  const moduleReports = readModuleTestReports(projectRoot);
  if (moduleReports.reports.length === 0) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: 'No modules were found under modules/.',
    };
  }
  if (moduleReports.missing.length === 0) {
    return {
      status: 'passed',
      evidence: `${label} passed with ${moduleReports.reports.length} module:test reports in .runtime/module-test-reports.`,
    };
  }
  return {
    status: requestedStatus === 'passed' ? 'failed' : 'pending',
    evidence: `${label} is missing passing module:test reports for: ${moduleReports.missing.join(', ')}.`,
  };
}

function resolveDocumentationCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  if (requestedStatus === 'failed') {
    return {
      status: 'failed',
      evidence: 'Documentation was marked failed by the release gate caller.',
    };
  }
  const requiredDocs = [
    'README.md',
    'docs/README.zh-CN.md',
    'docs/deployment.zh-CN.md',
    'docs/module-development.zh-CN.md',
    'docs/operations.zh-CN.md',
    'docs/security-model.zh-CN.md',
    'docs/release-candidate-checklist.zh-CN.md',
  ];
  const missing = requiredDocs.filter((docPath) => !fs.existsSync(path.join(projectRoot, docPath)));
  if (missing.length === 0) {
    return {
      status: 'passed',
      evidence: `Documentation index and release docs are present: ${requiredDocs.join(', ')}.`,
    };
  }
  return {
    status: requestedStatus === 'passed' ? 'failed' : 'pending',
    evidence: `Documentation is missing required files: ${missing.join(', ')}.`,
  };
}

function resolveProviderMatrixCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  if (requestedStatus === 'failed') {
    return {
      status: 'failed',
      evidence: 'Provider matrix was marked failed by the release gate caller.',
    };
  }

  const matrix = readProviderMatrixReport(projectRoot);
  if (!matrix.report) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${matrix.error} Run npm run host:provider-matrix. (${matrix.path})`,
    };
  }

  const failedChecks = (matrix.report.checks ?? [])
    .filter((check) => check.ok === false)
    .map((check) => check.id ?? 'unknown');
  const localDepth = (matrix.report.checks ?? []).find(
    (check) => check.id === 'local-provider-depth'
  );
  const aiRagLocal = (matrix.report.checks ?? []).find((check) => check.id === 'ai-rag-local');
  const invocationEvidence = providerInvocationEvidenceFromReport(matrix.report);

  if (requestedStatus === 'passed' && matrix.report.required !== true) {
    return {
      status: 'failed',
      evidence: `Provider matrix strict evidence must be generated with npm run host:provider-matrix -- --required. (${matrix.path})`,
    };
  }

  if (
    matrix.report.ok &&
    localDepth?.ok === true &&
    aiRagLocal?.ok === true &&
    (requestedStatus !== 'passed' ||
      ((invocationEvidence?.invocations ?? 0) >= 2 &&
        (invocationEvidence?.successful ?? 0) >= 2 &&
        (invocationEvidence?.failed ?? 0) === 0 &&
        (invocationEvidence?.ragSources ?? 0) >= 1 &&
        (invocationEvidence?.ragChunks ?? 0) >= 1))
  ) {
    return {
      status: 'passed',
      evidence: `Provider matrix passed at ${matrix.report.checkedAt ?? 'unknown time'} with local-provider-depth, ai-rag-local, ${invocationEvidence?.invocations ?? 0} provider invocation ledger records, and ${invocationEvidence?.ragSources ?? 0}/${invocationEvidence?.ragChunks ?? 0} RAG source/chunk records. (${matrix.path})`,
    };
  }

  const missingRequiredChecks = [
    localDepth?.ok === true ? undefined : 'local-provider-depth evidence is missing',
    aiRagLocal?.ok === true ? undefined : 'ai-rag-local evidence is missing',
    requestedStatus !== 'passed' ||
    ((invocationEvidence?.invocations ?? 0) >= 2 &&
      (invocationEvidence?.successful ?? 0) >= 2 &&
      (invocationEvidence?.failed ?? 0) === 0 &&
      (invocationEvidence?.ragSources ?? 0) >= 1 &&
      (invocationEvidence?.ragChunks ?? 0) >= 1)
      ? undefined
      : 'provider/RAG invocation ledger evidence is missing',
  ].filter(Boolean);
  const reason = matrix.report.ok
    ? `Provider matrix passed but ${missingRequiredChecks.join('; ')}.`
    : `Provider matrix did not pass. Failed checks: ${failedChecks.join(', ') || 'unknown'}.`;
  return {
    status: requestedStatus === 'passed' ? 'failed' : 'pending',
    evidence: `${reason} (${matrix.path})`,
  };
}

function resolveDeliveryLedgerCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  if (requestedStatus === 'failed') {
    return {
      status: 'failed',
      evidence: 'Delivery ledger was marked failed by the release gate caller.',
    };
  }

  const soak = readWorkerSoakReport(projectRoot);
  if (!soak.report) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${soak.error} Run npm run host:worker-soak -- --required. (${soak.path})`,
    };
  }

  if (requestedStatus === 'passed' && soak.report.required !== true) {
    return {
      status: 'failed',
      evidence: `Delivery ledger strict evidence must be generated with npm run host:worker-soak -- --required. (${soak.path})`,
    };
  }

  const ledger = soak.report.deliveryLedger;
  const registry = soak.report.workerRegistry;
  const hasLedger =
    (ledger?.records ?? 0) >= Math.max(1, (soak.report.enqueued ?? 0) + 1) &&
    (ledger?.failed ?? 0) === 0 &&
    (ledger?.deadLettered ?? 0) === 0 &&
    (ledger?.workerRecords ?? 0) >= 1;
  const hasRegistry = (registry?.workers ?? 0) >= 1 && (registry?.errorWorkers ?? 0) === 0;

  if (soak.report.ok === true && hasLedger && hasRegistry) {
    return {
      status: 'passed',
      evidence: `Delivery ledger passed with ${ledger?.records ?? 0} records, ${ledger?.workerRecords ?? 0} worker records, and ${registry?.workers ?? 0} worker registry row(s). (${soak.path})`,
    };
  }

  return {
    status: requestedStatus === 'passed' ? 'failed' : 'pending',
    evidence: `Delivery ledger evidence is incomplete. records=${ledger?.records ?? 0}, workerRecords=${ledger?.workerRecords ?? 0}, workers=${registry?.workers ?? 0}, failed=${ledger?.failed ?? 0}, deadLettered=${ledger?.deadLettered ?? 0}. (${soak.path})`,
  };
}

function resolveCommercialDomainCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  if (requestedStatus === 'failed') {
    return {
      status: 'failed',
      evidence: 'Commercial domain evidence was marked failed by the release gate caller.',
    };
  }

  const billing = readRuntimeEvidenceReport(projectRoot, 'billing-reconcile');
  if (!billing.report) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${billing.error} Run npm run host:billing-reconcile-smoke. (${billing.path})`,
    };
  }

  if (requestedStatus === 'passed' && billing.report.required !== true) {
    return {
      status: 'failed',
      evidence: `Commercial domain strict evidence must be generated with npm run host:billing-reconcile-smoke. (${billing.path})`,
    };
  }

  const evidence = commercialDomainEvidenceFromReport(billing.report);
  const ok =
    billing.report.ok === true &&
    (evidence?.paidOrders ?? 0) >= 1 &&
    (evidence?.catalogItems ?? 0) >= 2 &&
    evidence?.billingAccount === true &&
    (evidence?.invoices ?? 0) >= 1 &&
    (evidence?.subscriptions ?? 0) >= 1 &&
    (evidence?.revenueBuckets ?? 0) >= 1;
  if (ok) {
    return {
      status: 'passed',
      evidence: `Commercial domain evidence passed with ${evidence?.catalogItems ?? 0} catalog items, ${evidence?.invoices ?? 0} invoices, ${evidence?.subscriptions ?? 0} subscriptions, and ${evidence?.revenueBuckets ?? 0} revenue buckets. (${billing.path})`,
    };
  }

  return {
    status: requestedStatus === 'passed' ? 'failed' : 'pending',
    evidence: `Commercial domain evidence is incomplete. paidOrders=${evidence?.paidOrders ?? 0}, catalogItems=${evidence?.catalogItems ?? 0}, billingAccount=${evidence?.billingAccount === true}, invoices=${evidence?.invoices ?? 0}, subscriptions=${evidence?.subscriptions ?? 0}, revenueBuckets=${evidence?.revenueBuckets ?? 0}. (${billing.path})`,
  };
}

function resolveFilesStorageDomainCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  if (requestedStatus === 'failed') {
    return {
      status: 'failed',
      evidence: 'Files storage domain evidence was marked failed by the release gate caller.',
    };
  }

  const cleanup = readRuntimeEvidenceReport(projectRoot, 'files-cleanup');
  const reconcile = readRuntimeEvidenceReport(projectRoot, 'files-reconcile');
  const cleanupReport = cleanup.report as FilesCleanupReport | undefined;
  const reconcileReport = reconcile.report as FilesReconcileReport | undefined;
  if (!cleanupReport || !reconcileReport) {
    const missing = [
      cleanupReport ? null : `cleanup: ${cleanup.error}`,
      reconcileReport ? null : `reconcile: ${reconcile.error}`,
    ]
      .filter(Boolean)
      .join('; ');
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${missing} Run npm run host:files-cleanup-smoke and npm run host:files-reconcile-smoke. (${cleanup.path}; ${reconcile.path})`,
    };
  }

  const cleanupOk =
    cleanupReport.ok === true &&
    cleanupReport.file?.status === 'deleted' &&
    cleanupReport.file.objectDeleted === true &&
    (cleanupReport.cleanup?.matched ?? 0) >= 1 &&
    Boolean(cleanupReport.cleanup?.auditId);
  const reconcileChecks = new Map(
    (reconcileReport.checks ?? []).map((check) => [check.id, check.ok === true])
  );
  const reconcileOk =
    reconcileReport.ok === true &&
    reconcileChecks.get('ready-object-present') === true &&
    reconcileChecks.get('deleted-object-present-detected') === true &&
    reconcileChecks.get('missing-active-object-detected') === true &&
    reconcileChecks.get('orphan-object-detected') === true &&
    (reconcileReport.report?.checkedFiles ?? 0) >= 3 &&
    (reconcileReport.report?.deletedObjectsPresent ?? 0) >= 1 &&
    (reconcileReport.report?.missingActiveObjects ?? 0) >= 1 &&
    (reconcileReport.report?.orphanObjects ?? 0) >= 1;

  if (cleanupOk && reconcileOk) {
    return {
      status: 'passed',
      evidence: `Files storage evidence passed: cleanup deleted ${cleanupReport.cleanup?.matched ?? 0} object(s) with audit ${cleanupReport.cleanup?.auditId}, reconcile checked ${reconcileReport.report?.checkedFiles ?? 0} files and detected deleted-object, missing-object, and orphan-object cases. (${cleanup.path}; ${reconcile.path})`,
    };
  }

  return {
    status: requestedStatus === 'passed' ? 'failed' : 'pending',
    evidence: `Files storage evidence is incomplete. cleanupOk=${cleanupOk}, cleanupStatus=${cleanupReport.file?.status ?? 'unknown'}, objectDeleted=${cleanupReport.file?.objectDeleted === true}, reconcileOk=${reconcileOk}, checkedFiles=${reconcileReport.report?.checkedFiles ?? 0}, deletedObjectsPresent=${reconcileReport.report?.deletedObjectsPresent ?? 0}, missingActiveObjects=${reconcileReport.report?.missingActiveObjects ?? 0}, orphanObjects=${reconcileReport.report?.orphanObjects ?? 0}. (${cleanup.path}; ${reconcile.path})`,
  };
}

function resolveProviderInvocationLedgerCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  if (requestedStatus === 'failed') {
    return {
      status: 'failed',
      evidence: 'Provider invocation ledger was marked failed by the release gate caller.',
    };
  }

  const aiRag = readRuntimeEvidenceReport(projectRoot, 'ai-rag-local');
  const providerMatrix = readProviderMatrixReport(projectRoot);
  const report = aiRag.report ?? providerMatrix.report;
  const reportPath = aiRag.report ? aiRag.path : providerMatrix.path;
  const reportError = aiRag.error ?? providerMatrix.error;
  if (!report) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${reportError ?? 'Provider invocation ledger evidence is missing.'} Run npm run host:ai-rag-local-smoke or npm run host:provider-matrix. (${reportPath})`,
    };
  }

  if (requestedStatus === 'passed' && (report as RuntimeEvidenceReport).required !== true) {
    return {
      status: 'failed',
      evidence: `Provider invocation ledger strict evidence must be generated by a required provider smoke. (${reportPath})`,
    };
  }

  const evidence = providerInvocationEvidenceFromReport(report);
  const operations = new Set(evidence?.operations ?? []);
  const kinds = new Set(evidence?.kinds ?? []);
  const ok =
    (evidence?.invocations ?? 0) >= 2 &&
    (evidence?.successful ?? 0) >= 2 &&
    (evidence?.failed ?? 0) === 0 &&
    operations.has('generateText') &&
    operations.has('embedText') &&
    (evidence?.ragSources ?? 0) >= 1 &&
    (evidence?.ragChunks ?? 0) >= 1 &&
    (kinds.size === 0 || kinds.has('ai')) &&
    (kinds.size === 0 || kinds.has('rag'));
  if (ok) {
    return {
      status: 'passed',
      evidence: `Provider invocation ledger passed with ${evidence?.invocations ?? 0} records for ${[...operations].join(', ')}, ${evidence?.ragSources ?? 0} RAG sources and ${evidence?.ragChunks ?? 0} RAG chunks. (${reportPath})`,
    };
  }

  return {
    status: requestedStatus === 'passed' ? 'failed' : 'pending',
    evidence: `Provider invocation ledger evidence is incomplete. invocations=${evidence?.invocations ?? 0}, successful=${evidence?.successful ?? 0}, failed=${evidence?.failed ?? 0}, operations=${(evidence?.operations ?? []).join(', ') || 'none'}, ragSources=${evidence?.ragSources ?? 0}, ragChunks=${evidence?.ragChunks ?? 0}, connectorInvocations=${evidence?.connectorInvocations ?? 0}. (${reportPath})`,
  };
}

function resolveAiRagPolicyCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  return resolveRuntimeEvidenceCheck({
    projectRoot,
    requestedStatus,
    runtimeDir: 'ai-rag-policy',
    displayName: 'AI/RAG policy smoke',
    command: 'npm run host:ai-rag-policy-smoke',
    strictCommand: 'npm run host:ai-rag-policy-smoke -- --required',
    markedFailedEvidence: 'AI/RAG policy evidence was marked failed by the release gate caller.',
    validate(report) {
      const evidence = asRecord(asRecord(report.domainEvidence)?.aiRagPolicy);
      const missingSignals = [
        evidence?.budgetDeniesMissingCredits === true
          ? undefined
          : 'budgetDeniesMissingCredits is missing',
        evidence?.successfulCostCommitted === true
          ? undefined
          : 'successfulCostCommitted is missing',
        evidence?.failedProviderReservationReleased === true
          ? undefined
          : 'failedProviderReservationReleased is missing',
        evidence?.anonymousRateLimitRequired === true
          ? undefined
          : 'anonymousRateLimitRequired is missing',
        evidence?.anonymousHighCostForbidden === true
          ? undefined
          : 'anonymousHighCostForbidden is missing',
      ].filter(Boolean);
      return {
        ok: missingSignals.length === 0,
        detail:
          missingSignals.length === 0
            ? 'budget guard, quota accounting, and anonymous policy evidence present'
            : missingSignals.join('; '),
      };
    },
  });
}

function resolveWorkerSoakCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  if (requestedStatus === 'failed') {
    return {
      status: 'failed',
      evidence: 'Worker soak was marked failed by the release gate caller.',
    };
  }

  const soak = readWorkerSoakReport(projectRoot);
  if (!soak.report) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${soak.error} Run npm run host:worker-soak. (${soak.path})`,
    };
  }

  if (requestedStatus === 'passed' && soak.report.required !== true) {
    return {
      status: 'failed',
      evidence: `Worker soak strict evidence must be generated with npm run host:worker-soak -- --required. (${soak.path})`,
    };
  }

  const enqueued = soak.report.enqueued ?? 0;
  const processed = soak.report.drain?.processed ?? 0;
  const failed = soak.report.drain?.failed ?? 0;
  const deadLettered = soak.report.drain?.deadLettered ?? 0;
  const passed =
    soak.report.ok === true && processed >= enqueued && failed === 0 && deadLettered === 0;
  if (passed) {
    return {
      status: 'passed',
      evidence: `Worker soak passed at ${soak.report.checkedAt ?? 'unknown time'} with ${processed}/${enqueued} records processed and ${soak.report.drain?.iterations ?? 0} iterations. (${soak.path})`,
    };
  }

  return {
    status: requestedStatus === 'passed' ? 'failed' : 'pending',
    evidence: `Worker soak did not pass. processed=${processed}/${enqueued}, failed=${failed}, deadLettered=${deadLettered}. (${soak.path})`,
  };
}

function resolveRuntimeStoresCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  if (requestedStatus === 'failed') {
    return {
      status: 'failed',
      evidence: 'Runtime store Postgres evidence was marked failed by the release gate caller.',
    };
  }

  const postgres = readRuntimeStorePostgresReport(projectRoot);
  if (!postgres.report) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${postgres.error} Run npm run host:postgres-local-smoke. (${postgres.path})`,
    };
  }

  if (requestedStatus === 'passed' && postgres.report.required !== true) {
    return {
      status: 'failed',
      evidence: `Runtime store strict evidence must be generated by npm run host:postgres-local-smoke. (${postgres.path})`,
    };
  }

  const failedChecks = (postgres.report.checks ?? [])
    .filter((check) => check.ok === false)
    .map((check) => check.id ?? 'unknown');
  if (postgres.report.ok === true) {
    return {
      status: 'passed',
      evidence: `Runtime store Postgres smoke passed at ${postgres.report.checkedAt ?? 'unknown time'} with ${postgres.report.profile ?? 'unknown'} profile. (${postgres.path})`,
    };
  }

  return {
    status: requestedStatus === 'passed' ? 'failed' : 'pending',
    evidence: `Runtime store Postgres smoke did not pass. Failed checks: ${failedChecks.join(', ') || 'unknown'}. (${postgres.path})`,
  };
}

function resolveCheckEvidence(
  projectRoot: string,
  checkId: string,
  requested: ReleaseCandidateCheckStatus | boolean | undefined
): ResolvedCheckEvidence {
  const requestedStatus = normalizeCheckStatus(requested);
  if (checkId === 'module-contract') {
    return resolveModuleReportsCheck(projectRoot, requestedStatus, 'Module contract');
  }
  if (checkId === 'host-product-smoke') {
    return resolveHostProductSmokeCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'dashboard-transition-smoke') {
    return resolveDashboardTransitionSmokeCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'web-shell') {
    return resolveWebShellCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'runtime-stores') {
    return resolveRuntimeStoresCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'production-adapters') {
    return resolveProductionAdaptersCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'security-operations') {
    return resolveSecurityOperationsCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'demo-products') {
    return resolveModuleReportsCheck(projectRoot, requestedStatus, 'Demo products');
  }
  if (checkId === 'provider-live-matrix') {
    return resolveProviderMatrixCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'worker-soak') {
    return resolveWorkerSoakCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'delivery-ledger') {
    return resolveDeliveryLedgerCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'browser-matrix') {
    return resolveBrowserMatrixCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'accessibility-smoke') {
    return resolveAccessibilitySmokeCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'module-quality') {
    return resolveModuleQualityCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'product-presentation-kernel') {
    return resolveProductPresentationCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'white-label-presentation') {
    return resolveWhiteLabelPresentationCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'data-safety-matrix') {
    return resolveDataSafetyCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'drift-check-matrix') {
    return resolveDriftCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'backup-restore-matrix') {
    return resolveBackupRestoreCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'postgres-physical-restore-matrix') {
    return resolvePostgresPhysicalRestoreCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'upgrade-migration-matrix') {
    return resolveUpgradeMigrationCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'chaos-matrix') {
    return resolveChaosCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'commercial-domain') {
    return resolveCommercialDomainCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'files-storage-domain') {
    return resolveFilesStorageDomainCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'provider-invocation-ledger') {
    return resolveProviderInvocationLedgerCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'ai-rag-policy') {
    return resolveAiRagPolicyCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'documentation') {
    return resolveDocumentationCheck(projectRoot, requestedStatus);
  }
  return {
    status: requestedStatus,
    evidence: requested !== undefined ? 'provided by release gate caller' : undefined,
  };
}

export function runReleaseCandidateGate(
  input: RunReleaseCandidateGateInput
): ReleaseCandidateGateResult {
  const projectRoot = path.resolve(input.projectRoot);
  const profile = input.profile ?? 'maintainer';
  const targets = input.targets ?? DEFAULT_RELEASE_CANDIDATE_SCAN_TARGETS;
  const { files, diagnostics } = collectReleaseCandidateScan(projectRoot, targets);
  const profileRequiredChecks = new Set(PROFILE_REQUIRED_CHECKS[profile]);
  const checks = REQUIRED_CHECKS.map((check) => {
    const evidence = resolveCheckEvidence(projectRoot, check.id, input.requiredChecks?.[check.id]);
    return {
      ...check,
      required: profileRequiredChecks.has(check.id),
      status: evidence.status,
      evidence: evidence.evidence,
    };
  });

  return {
    ok:
      diagnostics.every((item) => item.severity !== 'error') &&
      checks.every((check) => !check.required || check.status === 'passed'),
    checkedAt: (input.now ?? (() => new Date()))().toISOString(),
    profile,
    scannedFiles: files.length,
    diagnostics,
    checks,
  };
}

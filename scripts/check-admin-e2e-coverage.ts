/* eslint-disable no-console */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ADMIN_PAGES } from '../tests/e2e/admin/admin-page-catalog';
import { listAdminPageSourcePaths } from './admin-e2e/admin-page-utils';

interface SurfaceReport {
  pageId?: string;
  projectName?: string;
  viewport?: string;
  interactives?: unknown[];
  disclosureProbes?: unknown[];
  apiResponses?: unknown[];
  ariaSnapshot?: string;
  screenshotPath?: string;
}

const SURFACE_DIR = path.join(process.cwd(), 'test-results', 'admin-surface');

function readSurfaceReports(): SurfaceReport[] {
  if (!existsSync(SURFACE_DIR)) {
    return [];
  }

  return readdirSync(SURFACE_DIR)
    .filter((fileName) => fileName.endsWith('.json'))
    .map((fileName) => {
      const fullPath = path.join(SURFACE_DIR, fileName);
      return JSON.parse(readFileSync(fullPath, 'utf-8')) as SurfaceReport;
    });
}

function hasSurfaceReport(
  reports: readonly SurfaceReport[],
  pageId: string,
  viewport: 'desktop' | 'mobile'
): boolean {
  return reports.some((report) => report.pageId === pageId && report.viewport === viewport);
}

function main(): void {
  const errors: string[] = [];
  const sourcePaths = new Set(listAdminPageSourcePaths());
  const reports = readSurfaceReports();

  for (const page of ADMIN_PAGES) {
    if (!sourcePaths.has(page.sourcePath)) {
      errors.push(`Catalog page ${page.id} points to missing source path: ${page.sourcePath}`);
    }

    if (!hasSurfaceReport(reports, page.id, 'desktop')) {
      errors.push(`Missing desktop surface report for ${page.id}`);
    }

    if (page.tier === 'P0' && !hasSurfaceReport(reports, page.id, 'mobile')) {
      errors.push(`Missing mobile surface report for P0 page ${page.id}`);
    }
  }

  for (const report of reports) {
    const label = `${report.pageId ?? 'unknown'}:${report.projectName ?? report.viewport ?? 'unknown'}`;
    if (!Array.isArray(report.interactives)) {
      errors.push(`Surface report ${label} is missing interactives array`);
    }
    if (!Array.isArray(report.disclosureProbes)) {
      errors.push(`Surface report ${label} is missing disclosureProbes array`);
    }
    if (!Array.isArray(report.apiResponses)) {
      errors.push(`Surface report ${label} is missing apiResponses array`);
    }
    if (!report.ariaSnapshot || report.ariaSnapshot.trim().length === 0) {
      errors.push(`Surface report ${label} is missing ariaSnapshot evidence`);
    }
    if (!report.screenshotPath || !existsSync(report.screenshotPath)) {
      errors.push(`Surface report ${label} is missing screenshot evidence`);
    }
  }

  if (errors.length > 0) {
    console.error('Admin E2E coverage check failed:');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    console.error(`Run: npm run test:admin:surface`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `Admin E2E coverage check passed for ${ADMIN_PAGES.length} page(s), ${reports.length} surface report(s).`
  );
}

main();

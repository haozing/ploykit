/* eslint-disable no-console */

import { ADMIN_PAGES } from '../tests/e2e/admin/admin-page-catalog';
import { listAdminPageSourcePaths, sourcePathToRoutePattern } from './admin-e2e/admin-page-utils';

function assertUnique(values: readonly string[], label: string): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }

  return [...duplicates].map((value) => `Duplicate ${label}: ${value}`);
}

function diff(expected: readonly string[], actual: readonly string[]): string[] {
  const actualSet = new Set(actual);
  return expected.filter((value) => !actualSet.has(value));
}

function main(): void {
  const sourcePaths = listAdminPageSourcePaths();
  const catalogSourcePaths = ADMIN_PAGES.map((page) => page.sourcePath).sort();
  const catalogRoutePatterns = ADMIN_PAGES.map((page) => page.routePattern).sort();
  const discoveredRoutePatterns = sourcePaths.map(sourcePathToRoutePattern).sort();
  const errors = [
    ...assertUnique(
      ADMIN_PAGES.map((page) => page.id),
      'admin page id'
    ),
    ...assertUnique(catalogSourcePaths, 'admin page sourcePath'),
    ...assertUnique(catalogRoutePatterns, 'admin page routePattern'),
  ];

  for (const missing of diff(sourcePaths, catalogSourcePaths)) {
    errors.push(`Missing catalog entry for source path: ${missing}`);
  }

  for (const stale of diff(catalogSourcePaths, sourcePaths)) {
    errors.push(`Catalog entry points to missing source path: ${stale}`);
  }

  for (const missing of diff(discoveredRoutePatterns, catalogRoutePatterns)) {
    errors.push(`Missing catalog entry for route pattern: ${missing}`);
  }

  for (const stale of diff(catalogRoutePatterns, discoveredRoutePatterns)) {
    errors.push(`Catalog route pattern has no matching page: ${stale}`);
  }

  if (errors.length > 0) {
    console.error('Admin page catalog check failed:');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Admin page catalog covers ${sourcePaths.length} page(s).`);
}

main();
